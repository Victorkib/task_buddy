import { COMPANY_LEGAL_NAME, PRODUCT_NAME } from '@/lib/branding'
import { TASK_STATUS_LABELS } from '@/lib/constants'
import { mailDocument } from '@/lib/mail/templates'
import {
  dateOnly,
  formatQueueDate,
  formatWeekLabel,
  nairobiWeekStart,
  oneLine,
  type QueueResponsibility,
  type QueueTask,
  type WorkSnapshot,
} from '@/lib/work/queue'

export function keepCurrentMailUnavailableMessage() {
  return 'Email is not configured on this workspace. Add GMAIL_USER and GMAIL_APP_PASSWORD before sending the check-in.'
}

export function keepCurrentSubject(now = new Date()) {
  return `Your Task Buddy check-in — week of ${formatWeekLabel(nairobiWeekStart(now))}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function overdueLine(count: number) {
  if (count <= 0) return ''
  if (count === 1) return 'One item is past its date. A short update in Task Buddy is enough.'
  return `${count} items are past their dates. A short update on each is enough.`
}

function moreLine(count: number, noun: string) {
  if (count <= 0) return ''
  const label = count === 1 ? noun : `${noun}s`
  return `${count} more ${label} ${count === 1 ? 'is' : 'are'} in ${PRODUCT_NAME}.`
}

function taskStatusLabel(status: string) {
  if (status in TASK_STATUS_LABELS) return TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS]
  return status.replaceAll('_', ' ')
}

function taskBandLabel(task: QueueTask, today: string, weekEnd: string) {
  const due = dateOnly(task.dueDate)
  if (due && due < today) return 'Past due'
  if (due && due <= weekEnd) return 'This week'
  if (task.status === 'in_progress') return 'In progress'
  if (task.status === 'waiting' || task.status === 'blocked' || task.status === 'pending_approval') return 'Waiting'
  return 'Open'
}

function duePhrase(task: QueueTask, today: string) {
  const due = dateOnly(task.dueDate)
  if (!due) return 'No due date'
  const pretty = formatQueueDate(due)
  if (due < today) return `Was due ${pretty}`
  if (due === today) return `Due today, ${pretty}`
  return `Due ${pretty}`
}

function responsibilityCard(item: QueueResponsibility) {
  const summary = oneLine(item.description) || 'No description yet.'
  const place = item.departmentName?.trim() || 'No department'
  const role = item.role === 'owner' ? 'Owner' : 'Supporting'
  return `
    <div style="margin:0 0 10px;padding:14px 16px;border-radius:12px;background:#f7fafc;border:1px solid #d5dee9;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d6b4f;">${role}</div>
      <div style="margin-top:4px;font-size:16px;font-weight:700;color:#0f2748;">${escapeHtml(item.title)}</div>
      <div style="margin-top:4px;font-size:13px;color:#5c6b80;">${escapeHtml(place)} · Active</div>
      <div style="margin-top:8px;font-size:14px;line-height:1.5;color:#1a2740;">${escapeHtml(summary)}</div>
    </div>`
}

function taskCard(task: QueueTask, today: string, weekEnd: string) {
  const summary = oneLine(task.description) || 'No description yet.'
  const role = task.role === 'assignee' ? 'Leading' : 'Helping'
  const place = [task.departmentName, task.projectTitle].filter(Boolean).join(' · ') || 'No department'
  const band = taskBandLabel(task, today, weekEnd)
  return `
    <div style="margin:0 0 10px;padding:14px 16px;border-radius:12px;background:#f7fafc;border:1px solid #d5dee9;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d6b4f;">${escapeHtml(band)} · ${role}</div>
      <div style="margin-top:4px;font-size:16px;font-weight:700;color:#0f2748;">${escapeHtml(task.title)}</div>
      <div style="margin-top:4px;font-size:13px;color:#5c6b80;">${escapeHtml(taskStatusLabel(task.status))} · ${escapeHtml(duePhrase(task, today))}</div>
      <div style="margin-top:4px;font-size:13px;color:#5c6b80;">${escapeHtml(place)}</div>
      <div style="margin-top:8px;font-size:14px;line-height:1.5;color:#1a2740;">${escapeHtml(summary)}</div>
    </div>`
}

export function keepCurrentEmail(input: {
  firstName: string
  snapshot: WorkSnapshot
  tasksUrl: string
  responsibilitiesUrl: string
  profileUrl: string
  today: string
  weekEnd: string
  now?: Date
}) {
  const weekLabel = formatWeekLabel(nairobiWeekStart(input.now ?? new Date()))
  const subject = `Your Task Buddy check-in — week of ${weekLabel}`
  const calm = overdueLine(input.snapshot.overdueCount)
  const responsibilityMore = moreLine(input.snapshot.responsibilityOverflow, 'responsibility')
  const taskMore = moreLine(input.snapshot.taskOverflow, 'task')
  const responsibilityBlocks =
    input.snapshot.responsibilities.length > 0
      ? input.snapshot.responsibilities.map((item) => responsibilityCard(item)).join('')
      : `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#5c6b80;">No active responsibilities on your name.</p>`
  const taskBlocks =
    input.snapshot.tasks.length > 0
      ? input.snapshot.tasks.map((task) => taskCard(task, input.today, input.weekEnd)).join('')
      : `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#5c6b80;">No open tasks on your name.</p>`

  const text = [
    `Hi ${input.firstName},`,
    '',
    `Here is what ${PRODUCT_NAME} already has for you in the week of ${weekLabel}. Please update anything that has changed, add what is missing, or remove what is no longer yours.`,
    calm,
    '',
    `Responsibilities (${input.snapshot.responsibilityTotal})`,
    ...input.snapshot.responsibilities.map((item) => {
      const role = item.role === 'owner' ? 'Owner' : 'Supporting'
      const summary = oneLine(item.description) || 'No description yet.'
      return `- ${item.title} (${role}${item.departmentName ? `, ${item.departmentName}` : ''}) — ${summary}`
    }),
    responsibilityMore,
    '',
    `Open tasks (${input.snapshot.taskTotal})`,
    ...input.snapshot.tasks.map((task) => {
      const role = task.role === 'assignee' ? 'Leading' : 'Helping'
      const summary = oneLine(task.description) || 'No description yet.'
      return `- ${task.title} (${role}, ${taskStatusLabel(task.status)}, ${duePhrase(task, input.today)}) — ${summary}`
    }),
    taskMore,
    '',
    `Open my tasks: ${input.tasksUrl}`,
    `Review responsibilities: ${input.responsibilitiesUrl}`,
    '',
    `To turn this weekly check-in off, open your profile in ${PRODUCT_NAME}, choose Alert preferences, and uncheck Weekly keep-current email.`,
    input.profileUrl,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const html = mailDocument({
    title: `Week of ${weekLabel}`,
    preheader: `A short ${PRODUCT_NAME} check-in: what you already have, and a request to keep it current.`,
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(input.firstName)},</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
        Here is what <strong>${escapeHtml(PRODUCT_NAME)}</strong> already has for you this week at
        ${escapeHtml(COMPANY_LEGAL_NAME)}. Please update anything that has changed, add what is missing,
        or remove what is no longer yours.
      </p>
      ${
        calm
          ? `<p style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#f8f1e3;border:1px solid #ead9b8;font-size:14px;line-height:1.5;color:#5c4a32;">${escapeHtml(calm)}</p>`
          : ''
      }
      <div style="margin:8px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7a90;">
        Responsibilities · ${input.snapshot.responsibilityTotal}
      </div>
      ${responsibilityBlocks}
      ${responsibilityMore ? `<p style="margin:0 0 16px;font-size:13px;color:#5c6b80;">${escapeHtml(responsibilityMore)}</p>` : ''}
      <div style="margin:8px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7a90;">
        Open tasks · ${input.snapshot.taskTotal}
      </div>
      ${taskBlocks}
      ${taskMore ? `<p style="margin:0 0 16px;font-size:13px;color:#5c6b80;">${escapeHtml(taskMore)}</p>` : ''}
      <a href="${escapeHtml(input.tasksUrl)}" style="display:inline-block;margin-top:8px;padding:12px 20px;background:#1d6b4f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Open my tasks</a>
      <p style="margin:16px 0 0;font-size:14px;line-height:1.5;">
        <a href="${escapeHtml(input.responsibilitiesUrl)}" style="color:#0f2748;font-weight:700;">Review responsibilities</a>
      </p>
    `,
    footerHtml: `To turn this weekly check-in off, open your profile in ${escapeHtml(PRODUCT_NAME)}, choose Alert preferences, and uncheck Weekly keep-current email. <a href="${escapeHtml(input.profileUrl)}" style="color:#0f2748;">Open profile</a>.`,
  })

  return { subject, html, text }
}
