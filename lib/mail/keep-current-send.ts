import { eq, notInArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { keepCurrentSends, notificationPreferences, responsibilities, tasks, users } from '@/lib/db/schema'
import { keepCurrentEmail, keepCurrentMailUnavailableMessage } from '@/lib/mail/keep-current'
import { getPublicAppUrl, isMailConfigured, sendMail } from '@/lib/mail/send'
import {
  buildWorkSnapshot,
  formatWeekLabel,
  nairobiWeekEnd,
  nairobiWeekStart,
  nairobiYmd,
  recipientDecision,
  type QueueResponsibility,
  type QueueTask,
} from '@/lib/work/queue'

export type KeepCurrentSendResult = {
  ok: boolean
  sent: number
  skipped: number
  alreadySent: number
  failed: number
  weekLabel: string
  resendAvailable: boolean
  detail: string
  error?: string
}

function emptyResult(weekLabel: string, error?: string): KeepCurrentSendResult {
  return {
    ok: !error,
    sent: 0,
    skipped: 0,
    alreadySent: 0,
    failed: 0,
    weekLabel,
    resendAvailable: false,
    detail: error ?? '',
    error,
  }
}

export async function sendKeepCurrentBatch(input: { resend: boolean }): Promise<KeepCurrentSendResult> {
  const weekKey = nairobiWeekStart()
  const weekLabel = formatWeekLabel(weekKey)
  if (!isMailConfigured()) {
    return emptyResult(weekLabel, keepCurrentMailUnavailableMessage())
  }

  try {
    const db = getDb()
    const today = nairobiYmd()
    const weekEnd = nairobiWeekEnd()
    const [people, openTasks, activeResponsibilities, sentRows] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          status: users.status,
          weeklyKeepCurrent: notificationPreferences.weeklyKeepCurrent,
        })
        .from(users)
        .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
        .where(eq(users.status, 'active')),
      db.query.tasks.findMany({
        where: notInArray(tasks.status, ['completed', 'cancelled']),
        with: { department: true, project: true, helpers: true },
      }),
      db.query.responsibilities.findMany({
        where: eq(responsibilities.status, 'active'),
        with: { department: true, assignees: true },
      }),
      db
        .select({ userId: keepCurrentSends.userId })
        .from(keepCurrentSends)
        .where(eq(keepCurrentSends.weekKey, weekKey)),
    ])

    const alreadySentIds = new Set(sentRows.map((row) => row.userId))
    const base = getPublicAppUrl()
    const tasksUrl = `${base}/?view=${encodeURIComponent('My tasks')}`
    const responsibilitiesUrl = `${base}/?view=${encodeURIComponent('Responsibilities')}`
    const profileUrl = `${base}/profile`

    let sent = 0
    let optedOut = 0
    let empty = 0
    let alreadySent = 0
    let failed = 0

    for (const person of people) {
      const personTasks: QueueTask[] = openTasks
        .filter((task) => task.assigneeId === person.id || task.helpers.some((helper) => helper.userId === person.id))
        .map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          dueDate: task.dueDate,
          role: task.assigneeId === person.id ? 'assignee' : 'helper',
          departmentName: task.department?.name ?? null,
          projectTitle: task.project?.title ?? null,
        }))
      const personResponsibilities: QueueResponsibility[] = activeResponsibilities
        .filter(
          (item) =>
            item.ownerId === person.id || item.assignees.some((assignee) => assignee.userId === person.id),
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          status: item.status,
          role: item.ownerId === person.id ? 'owner' : 'supporting',
          departmentName: item.department?.name ?? null,
        }))

      const decision = recipientDecision(
        {
          status: person.status,
          weeklyKeepCurrent: person.weeklyKeepCurrent,
          openTaskCount: personTasks.length,
          activeResponsibilityCount: personResponsibilities.length,
          alreadySent: alreadySentIds.has(person.id),
        },
        input.resend,
      )

      if (decision === 'opted_out') {
        optedOut += 1
        continue
      }
      if (decision === 'empty') {
        empty += 1
        continue
      }
      if (decision === 'already_sent') {
        alreadySent += 1
        continue
      }
      if (decision !== 'send') continue

      const snapshot = buildWorkSnapshot(
        { responsibilities: personResponsibilities, tasks: personTasks, today, weekEnd },
        {},
      )
      const message = keepCurrentEmail({
        firstName: person.firstName,
        snapshot,
        tasksUrl,
        responsibilitiesUrl,
        profileUrl,
        today,
        weekEnd,
      })

      try {
        await sendMail({ to: person.email, subject: message.subject, html: message.html, text: message.text })
        await db
          .insert(keepCurrentSends)
          .values({ userId: person.id, weekKey })
          .onConflictDoUpdate({
            target: [keepCurrentSends.userId, keepCurrentSends.weekKey],
            set: { sentAt: new Date() },
          })
        sent += 1
      } catch {
        failed += 1
      }
    }

    const skipped = optedOut + empty + alreadySent
    const parts = [
      `${optedOut} turned the weekly check-in off`,
      `${empty} have nothing open`,
      `${alreadySent} already received this week's check-in`,
    ]
    const detail = `Sent ${sent}. Skipped ${skipped}: ${parts.join(', ')}.${failed ? ` ${failed} could not be delivered.` : ''}`

    return {
      ok: failed === 0,
      sent,
      skipped,
      alreadySent,
      failed,
      weekLabel,
      resendAvailable: alreadySent > 0 && !input.resend,
      detail,
      error: failed > 0 && sent === 0 ? 'The check-in could not be delivered.' : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The check-in could not be sent.'
    return emptyResult(weekLabel, message)
  }
}
