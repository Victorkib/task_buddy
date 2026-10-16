'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  ADMIN_OFFICE_DEPARTMENT_SLUG,
  canDecideAdminRequest,
  canRunAdminOffice,
  canSubmitAdminRequest,
  isAdmin,
  isManagement,
} from '@/lib/auth/permissions'
import { addCadence, addDaysIso, annualAvailableHundredths, isIsoDate, leaveSpanHundredths, nairobiToday, rangesOverlap } from '@/lib/admin-office/leave'
import { readExpenseWorkbook, writeExpenseWorkbook } from '@/lib/admin-office/expense-workbook'
import {
  cleanExpenseCategory,
  expenseFingerprint,
  isStandardExpenseCategory,
  parseAmountText,
  type ExpenseDraft,
} from '@/lib/admin-office/expenses'
import {
  amountWithinLimit,
  buildInvoiceHtml,
  formatMoney,
  invoicePlainText,
  invoiceTotals,
  lineAmountCents,
  parsePaymentSnapshot,
  outlookMailLink,
  outlookMessage,
  parseQuantity,
  parseVatRate,
  type PaymentKind,
} from '@/lib/admin-office/invoices'
import { buildOfferLetter, buildStaffLetter } from '@/lib/admin-office/letters'
import { embeddedLetterheadSrc } from '@/lib/admin-office/letterhead-embed'
import {
  CARRY_CAP_HUNDREDTHS,
  defaultEmployment,
  EMPLOYMENT_TYPE_LABELS,
  LEAVE_TYPE_LABELS,
  LETTER_TYPE_LABELS,
  requestNeedsMd,
} from '@/lib/admin-office/policy'
import type { AdminRequestKind, EmploymentType, LeaveType, OfficeLetterType } from '@/lib/admin-office/types'
import { getDb } from '@/lib/db'
import { nextOfficeNumber } from '@/lib/db/office'
import { getCurrentUser } from '@/lib/db/queries'
import {
  activityEvents,
  adminRequests,
  companies,
  departments,
  documentAcknowledgements,
  notifications,
  offerLetters,
  officeAssets,
  officeCompliance,
  officeDocuments,
  officeClients,
  officeExpenseCategories,
  officeExpenses,
  officeInvoiceLines,
  officeInvoiceSettings,
  officeInvoices,
  officePaymentAccounts,
  officeVendors,
  staffProfiles,
  tasks,
  users,
} from '@/lib/db/schema'
import { getPublicAppUrl, isMailConfigured, sendMail } from '@/lib/mail/send'
import { officeNoticeEmail } from '@/lib/mail/templates'

const KINDS = new Set<AdminRequestKind>(['leave', 'letter', 'print', 'imprest', 'purchase', 'equipment', 'training'])
const LEAVE_TYPES = new Set<LeaveType>(['annual', 'sick', 'compassionate', 'unpaid', 'study', 'half_day'])
const LETTER_TYPES = new Set<OfficeLetterType>(['employment_confirmation', 'introduction', 'bank', 'internship', 'custom'])
const EMPLOYMENT_TYPES = new Set<EmploymentType>(['permanent', 'contract', 'intern', 'attachee', 'volunteer', 'part_time'])
const OPEN = new Set(['submitted', 'in_review'])

function field(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function cleanBlock(value: string, max: number) {
  return value.replace(/\r\n/g, '\n').trim().slice(0, max)
}

function readInt(value: string, min: number, max: number) {
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  if (number < min || number > max) return null
  return number
}

function readHundredths(value: string, maxDays: number) {
  if (!value) return 0
  if (!/^\d+(\.\d)?$/.test(value)) return null
  const hundredths = Math.round(Number(value) * 100)
  if (hundredths < 0 || hundredths > maxDays * 100) return null
  return hundredths
}

function cleanUrl(value: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString().slice(0, 2000)
  } catch {
    return null
  }
}

function dateOrEmpty(value: string) {
  if (!value) return null
  return isIsoDate(value) ? value : undefined
}

async function actor() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' as const }
  return { currentUser }
}

function refresh() {
  revalidatePath('/')
}

async function logActivity(input: { companyId: string; actorId: string; entityId: string; action: string; summary: string }) {
  await getDb().insert(activityEvents).values({
    companyId: input.companyId,
    actorId: input.actorId,
    entityType: 'admin_request',
    entityId: input.entityId,
    action: input.action,
    summary: input.summary,
  })
}

async function notifyUsers(
  rows: Array<{ companyId: string; userId: string; title: string; body: string; entityId?: string | null; type?: 'approval_request' | 'approval_decision' | 'reminder' }>,
) {
  const unique = rows.filter((row, index) => rows.findIndex((item) => item.userId === row.userId && item.title === row.title) === index)
  if (unique.length === 0) return
  await getDb().insert(notifications).values(
    unique.map((row) => ({
      companyId: row.companyId,
      userId: row.userId,
      type: row.type ?? 'reminder',
      title: row.title,
      body: row.body,
      entityType: 'admin_request',
      entityId: row.entityId ?? null,
    })),
  )
}

async function tryEmail(to: string | null | undefined, mail: { subject: string; html: string; text: string }) {
  if (!to || !isMailConfigured()) return false
  try {
    await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text })
    return true
  } catch (error) {
    console.error('Admin office email failed', error)
    return false
  }
}

function officeHref(view: 'Admin office' | 'My office') {
  return `${getPublicAppUrl()}/?view=${encodeURIComponent(view)}`
}

async function managingDirectors(companyId: string) {
  const rows = await getDb().query.users.findMany({
    where: eq(users.companyId, companyId),
    with: { roles: { with: { role: true } } },
  })
  const directors = rows.filter(
    (row) => row.status === 'active' && row.roles.some((entry) => entry.role.key === 'managing_director'),
  )
  if (directors.length > 0) return directors
  return rows.filter((row) => row.status === 'active' && row.roles.some((entry) => entry.role.key === 'admin'))
}

export async function submitAdminRequest(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canSubmitAdminRequest(currentUser)) return { error: 'You are not allowed to send this request.' }

  const kind = field(formData, 'kind') as AdminRequestKind
  if (!KINDS.has(kind)) return { error: 'Choose what you are requesting.' }
  const description = cleanBlock(field(formData, 'description'), 2000)
  const attachmentRaw = field(formData, 'attachmentUrl')
  const attachmentUrl = attachmentRaw ? cleanUrl(attachmentRaw) : null
  if (attachmentRaw && !attachmentUrl) return { error: 'The file link is not valid.' }

  let title = cleanBlock(field(formData, 'title'), 180)
  let leaveType: LeaveType | null = null
  let startDate: string | null = null
  let endDate: string | null = null
  let daysHundredths = 0
  let amountKes = 0
  let copies = 1
  let letterType: OfficeLetterType | null = null
  let coverageUserId: string | null = null
  let generatedHtml: string | null = null
  let overlapNotice = ''

  if (kind === 'leave') {
    leaveType = field(formData, 'leaveType') as LeaveType
    if (!LEAVE_TYPES.has(leaveType)) return { error: 'Choose a leave type.' }
    const start = dateOrEmpty(field(formData, 'startDate'))
    const end = dateOrEmpty(field(formData, 'endDate'))
    if (start === undefined || end === undefined || !start || !end) return { error: 'Choose a start and end date.' }
    const span = leaveSpanHundredths(leaveType, start, end)
    if ('error' in span) return span
    startDate = start
    endDate = end
    daysHundredths = span.daysHundredths
    const profile = await ensureProfile(currentUser.id, currentUser.jobTitle, currentUser.department?.slug)
    if (leaveType === 'annual' || leaveType === 'half_day') {
      const available = annualAvailableHundredths(profile)
      if (daysHundredths > available) {
        return { error: `You have ${(available / 100).toFixed(1)} annual days left, which is less than this request.` }
      }
    }
    if (leaveType === 'sick') {
      const available = profile.sickEntitlementDays * 100 - profile.sickUsedHundredths
      if (daysHundredths > available) {
        return { error: `You have ${(Math.max(0, available) / 100).toFixed(1)} sick days left, which is less than this request.` }
      }
    }
    const clash = await getDb().query.adminRequests.findMany({
      where: and(eq(adminRequests.requestorId, currentUser.id), eq(adminRequests.kind, 'leave')),
    })
    const blocking = clash.find(
      (row) =>
        row.startDate &&
        row.endDate &&
        (row.status === 'submitted' || row.status === 'in_review' || row.status === 'approved') &&
        rangesOverlap(start, end, row.startDate, row.endDate),
    )
    if (blocking) return { error: 'You already have leave covering those dates.' }
    const others = await getDb().query.adminRequests.findMany({
      where: and(eq(adminRequests.companyId, currentUser.companyId), eq(adminRequests.kind, 'leave'), eq(adminRequests.status, 'approved')),
      with: { requestor: true },
    })
    const names = others
      .filter(
        (row) =>
          row.requestorId !== currentUser.id &&
          row.startDate &&
          row.endDate &&
          rangesOverlap(start, end, row.startDate, row.endDate),
      )
      .map((row) => `${row.requestor.firstName} ${row.requestor.lastName}`.trim())
    if (names.length > 0) overlapNotice = `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} also out then.`
    title = title || `${LEAVE_TYPE_LABELS[leaveType]} · ${start} to ${end}`
    const coverage = field(formData, 'coverageUserId')
    if (coverage) {
      if (coverage === currentUser.id) return { error: 'Pick someone else to cover you.' }
      const cover = await getDb().query.users.findFirst({ where: eq(users.id, coverage) })
      if (!cover || cover.companyId !== currentUser.companyId || cover.status !== 'active') {
        return { error: 'Choose an active colleague to cover you.' }
      }
      coverageUserId = cover.id
    }
  } else if (kind === 'letter') {
    letterType = field(formData, 'letterType') as OfficeLetterType
    if (!LETTER_TYPES.has(letterType)) return { error: 'Choose a letter type.' }
    title = title || LETTER_TYPE_LABELS[letterType]
    const profile = await ensureProfile(currentUser.id, currentUser.jobTitle, currentUser.department?.slug)
    generatedHtml = buildStaffLetter({
      companyName: await companyName(currentUser.companyId),
      letterType,
      documentNumber: null,
      employeeName: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
      jobTitle: currentUser.jobTitle,
      departmentName: currentUser.department?.name ?? null,
      startDate: profile.startDate,
      purpose: description || null,
      today: nairobiToday(),
      letterhead: embeddedLetterheadSrc(),
    })
  } else if (kind === 'imprest' || kind === 'purchase') {
    const amount = readInt(field(formData, 'amountKes').replace(/,/g, ''), 1, 50_000_000)
    if (amount == null) return { error: 'Enter the amount in Kenya shillings, without cents.' }
    amountKes = amount
    if (!title) return { error: 'Add a short title so the request is easy to recognise.' }
  } else if (kind === 'print') {
    const count = readInt(field(formData, 'copies') || '1', 1, 200)
    if (count == null) return { error: 'Copies must be between 1 and 200.' }
    copies = count
    title = title || 'Print job'
  } else if (!title) {
    return { error: 'Add a short title so the request is easy to recognise.' }
  }

  const [created] = await getDb()
    .insert(adminRequests)
    .values({
      companyId: currentUser.companyId,
      requestorId: currentUser.id,
      kind,
      title,
      description: description || null,
      leaveType,
      startDate,
      endDate,
      daysHundredths,
      amountKes,
      copies,
      confidential: field(formData, 'confidential') === 'on',
      letterType,
      generatedHtml,
      coverageUserId,
      attachmentUrl,
      attachmentPublicId: field(formData, 'attachmentPublicId') || null,
      attachmentName: field(formData, 'attachmentName').slice(0, 180) || null,
    })
    .returning()
  if (!created) return { error: 'The request could not be saved.' }

  await logActivity({
    companyId: currentUser.companyId,
    actorId: currentUser.id,
    entityId: created.id,
    action: 'submitted',
    summary: `submitted ${title}`,
  })

  const officePeople = await officeRecipients(currentUser.companyId, currentUser.id)
  await notifyUsers([
    ...officePeople.map((person) => ({
      companyId: currentUser.companyId,
      userId: person.id,
      title: 'Admin office request',
      body: `${currentUser.firstName} submitted “${title}”.`,
      entityId: created.id,
      type: 'approval_request' as const,
    })),
    ...(currentUser.managerId && currentUser.managerId !== currentUser.id
      ? [
          {
            companyId: currentUser.companyId,
            userId: currentUser.managerId,
            title: 'Someone on your team asked the admin office',
            body: `${currentUser.firstName} submitted “${title}”. The admin office will decide.`,
            entityId: created.id,
            type: 'reminder' as const,
          },
        ]
      : []),
  ])

  refresh()
  const needsMd = requestNeedsMd(created)
  const notice = [
    needsMd ? 'Sent. This one also needs the managing director because of the length or the amount.' : 'Sent to the admin office.',
    overlapNotice,
  ]
    .filter(Boolean)
    .join(' ')
  return { ok: true, notice }
}

export async function previewStaffLetter(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  const letterType = field(formData, 'letterType') as OfficeLetterType
  if (!LETTER_TYPES.has(letterType)) return { error: 'Choose a letter type.' }
  const profile = await ensureProfile(currentUser.id, currentUser.jobTitle, currentUser.department?.slug)
  const html = buildStaffLetter({
    companyName: await companyName(currentUser.companyId),
    letterType,
    documentNumber: null,
    employeeName: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
    jobTitle: currentUser.jobTitle,
    departmentName: currentUser.department?.name ?? null,
    startDate: profile.startDate,
    purpose: cleanBlock(field(formData, 'description'), 2000) || null,
    today: nairobiToday(),
    letterhead: embeddedLetterheadSrc(),
  })
  return { html }
}

export async function decideAdminRequest(requestId: string, decision: 'approve' | 'reject' | 'complete' | 'cancel', reason?: string) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  const request = await getDb().query.adminRequests.findFirst({
    where: eq(adminRequests.id, requestId),
    with: { requestor: { with: { department: true, staffProfile: true } }, coverageUser: true },
  })
  if (!request || request.companyId !== currentUser.companyId) return { error: 'Request not found.' }

  const note = cleanBlock(reason ?? '', 1000)
  if (decision === 'cancel') {
    const own = request.requestorId === currentUser.id
    if (!own && !canRunAdminOffice(currentUser)) return { error: 'You cannot cancel this request.' }
    if (!OPEN.has(request.status)) return { error: 'Only a request that is still waiting can be cancelled.' }
    await getDb()
      .update(adminRequests)
      .set({ status: 'cancelled', reviewerId: currentUser.id, decisionReason: note || null, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(adminRequests.id, request.id))
    await logActivity({
      companyId: currentUser.companyId,
      actorId: currentUser.id,
      entityId: request.id,
      action: 'cancelled',
      summary: `cancelled ${request.title}`,
    })
    refresh()
    return { ok: true, notice: 'Request cancelled.' }
  }

  if (!canDecideAdminRequest(currentUser, request.requestorId)) {
    return { error: 'Your own requests are decided by the managing director.' }
  }

  if (decision === 'reject') {
    if (!OPEN.has(request.status)) return { error: 'This request is no longer waiting.' }
    if (!note) return { error: 'Add a short reason so the person knows what to change.' }
    await getDb()
      .update(adminRequests)
      .set({ status: 'rejected', reviewerId: currentUser.id, decisionReason: note, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(adminRequests.id, request.id))
    await logActivity({
      companyId: currentUser.companyId,
      actorId: currentUser.id,
      entityId: request.id,
      action: 'rejected',
      summary: `rejected ${request.title}`,
    })
    await notifyUsers([
      {
        companyId: currentUser.companyId,
        userId: request.requestorId,
        title: 'Request not approved',
        body: `${request.title} was not approved. ${note}`,
        entityId: request.id,
        type: 'approval_decision',
      },
    ])
    await tryEmail(
      request.requestor.email,
      officeNoticeEmail({
        firstName: request.requestor.firstName,
        title: 'Request not approved',
        body: `${request.title} was not approved. ${note}`,
        href: officeHref('My office'),
        cta: 'Open My office',
      }),
    )
    refresh()
    return { ok: true, notice: 'Request rejected.' }
  }

  if (decision === 'complete') {
    if (request.status !== 'approved') return { error: 'Approve the request before marking it finished.' }
    if (!['print', 'imprest', 'purchase', 'equipment'].includes(request.kind)) {
      return { error: 'This request does not have a pickup or retirement step.' }
    }
    await getDb()
      .update(adminRequests)
      .set({ status: 'completed', reviewerId: currentUser.id, decisionReason: note || request.decisionReason, updatedAt: new Date() })
      .where(eq(adminRequests.id, request.id))
    const finished =
      request.kind === 'print'
        ? 'Your print job is ready for pickup.'
        : request.kind === 'imprest'
          ? 'Your imprest was marked retired.'
          : `${request.title} was marked finished.`
    await notifyUsers([
      {
        companyId: currentUser.companyId,
        userId: request.requestorId,
        title: request.kind === 'print' ? 'Print job ready' : 'Admin office update',
        body: finished,
        entityId: request.id,
        type: 'approval_decision',
      },
    ])
    if (request.kind === 'print') {
      await tryEmail(
        request.requestor.email,
        officeNoticeEmail({
          firstName: request.requestor.firstName,
          title: 'Print job ready',
          body: finished,
          href: officeHref('My office'),
          cta: 'Open My office',
        }),
      )
    }
    refresh()
    return { ok: true, notice: request.kind === 'print' ? 'Marked ready for pickup.' : 'Marked finished.' }
  }

  if (!OPEN.has(request.status)) return { error: 'This request is no longer waiting.' }
  if (requestNeedsMd(request) && !isManagement(currentUser)) {
    if (request.status === 'in_review') return { error: 'This is already with the managing director.' }
    await getDb()
      .update(adminRequests)
      .set({ status: 'in_review', reviewerId: currentUser.id, decisionReason: note || null, updatedAt: new Date() })
      .where(eq(adminRequests.id, request.id))
    const directors = await managingDirectors(currentUser.companyId)
    await notifyUsers(
      directors.map((person) => ({
        companyId: currentUser.companyId,
        userId: person.id,
        title: 'Admin office needs your sign-off',
        body: `${request.requestor.firstName} — ${request.title}. Long leave or spend of KES 10,000 and above.`,
        entityId: request.id,
        type: 'approval_request' as const,
      })),
    )
    for (const person of directors) {
      await tryEmail(
        person.email,
        officeNoticeEmail({
          firstName: person.firstName,
          title: 'Admin office needs your sign-off',
          body: `${request.requestor.firstName} ${request.requestor.lastName} — ${request.title}.`,
          href: officeHref('Admin office'),
          cta: 'Open Admin office',
        }),
      )
    }
    refresh()
    return { ok: true, notice: 'Sent to the managing director.' }
  }

  if (request.kind === 'leave' && request.leaveType && request.daysHundredths > 0) {
    const profile = await ensureProfile(request.requestorId, request.requestor.jobTitle, request.requestor.department?.slug)
    if (request.leaveType === 'annual' || request.leaveType === 'half_day') {
      const available = annualAvailableHundredths(profile)
      if (request.daysHundredths > available) return { error: 'The annual balance is no longer enough for this leave.' }
      await getDb()
        .update(staffProfiles)
        .set({
          annualUsedHundredths: sql`${staffProfiles.annualUsedHundredths} + ${request.daysHundredths}`,
          updatedAt: new Date(),
        })
        .where(eq(staffProfiles.userId, request.requestorId))
    } else if (request.leaveType === 'sick') {
      const available = profile.sickEntitlementDays * 100 - profile.sickUsedHundredths
      if (request.daysHundredths > available) return { error: 'The sick balance is no longer enough for this leave.' }
      await getDb()
        .update(staffProfiles)
        .set({
          sickUsedHundredths: sql`${staffProfiles.sickUsedHundredths} + ${request.daysHundredths}`,
          updatedAt: new Date(),
        })
        .where(eq(staffProfiles.userId, request.requestorId))
    } else if (request.leaveType === 'unpaid') {
      await getDb()
        .update(staffProfiles)
        .set({
          unpaidUsedHundredths: sql`${staffProfiles.unpaidUsedHundredths} + ${request.daysHundredths}`,
          updatedAt: new Date(),
        })
        .where(eq(staffProfiles.userId, request.requestorId))
    }
  }

  let documentNumber = request.documentNumber
  let generatedHtml = request.generatedHtml
  if (request.kind === 'letter' && request.letterType) {
    documentNumber = documentNumber ?? (await nextOfficeNumber('HR'))
    const profile = request.requestor.staffProfile
    generatedHtml = buildStaffLetter({
      companyName: await companyName(currentUser.companyId),
      letterType: request.letterType,
      documentNumber,
      employeeName: `${request.requestor.firstName} ${request.requestor.lastName}`.trim(),
      jobTitle: request.requestor.jobTitle,
      departmentName: request.requestor.department?.name ?? null,
      startDate: profile?.startDate ?? null,
      purpose: request.description,
      today: nairobiToday(),
      letterhead: embeddedLetterheadSrc(),
    })
  }

  let coverageTaskId = request.coverageTaskId
  if (request.kind === 'leave' && request.coverageUserId && !coverageTaskId) {
    const due = request.startDate ?? addDaysIso(nairobiToday(), 1)
    const [task] = await getDb()
      .insert(tasks)
      .values({
        companyId: currentUser.companyId,
        departmentId: request.coverageUser?.departmentId ?? request.requestor.departmentId,
        assigneeId: request.coverageUserId,
        createdById: currentUser.id,
        title: `Cover ${request.requestor.firstName} · ${request.startDate ?? ''} to ${request.endDate ?? ''}`.trim(),
        description: request.description || 'Cover while this colleague is away.',
        category: 'administrative',
        priority: 'medium',
        status: 'not_started',
        dueDate: due,
      })
      .returning()
    coverageTaskId = task?.id ?? null
    if (request.coverageUser) {
      await notifyUsers([
        {
          companyId: currentUser.companyId,
          userId: request.coverageUser.id,
          title: 'You are covering leave',
          body: `${request.requestor.firstName} is away ${request.startDate ?? ''} to ${request.endDate ?? ''}. A coverage task is on your list.`,
          entityId: request.id,
          type: 'reminder',
        },
      ])
    }
  }

  if (request.kind === 'equipment' || request.kind === 'training' || request.kind === 'purchase') {
    const due = addDaysIso(nairobiToday(), request.kind === 'purchase' ? 7 : 14)
    await getDb().insert(tasks).values({
      companyId: currentUser.companyId,
      departmentId: request.kind === 'purchase' ? currentUser.departmentId : request.requestor.departmentId,
      assigneeId: request.kind === 'purchase' ? currentUser.id : request.requestorId,
      createdById: currentUser.id,
      title: request.kind === 'purchase' ? `Procure: ${request.title}` : request.kind === 'equipment' ? `Collect: ${request.title}` : `Attend: ${request.title}`,
      description: request.description,
      category: request.kind === 'purchase' ? 'finance' : 'administrative',
      priority: 'medium',
      dueDate: due,
    })
  }

  await getDb()
    .update(adminRequests)
    .set({
      status: 'approved',
      reviewerId: currentUser.id,
      decisionReason: note || null,
      decidedAt: new Date(),
      updatedAt: new Date(),
      documentNumber,
      generatedHtml,
      coverageTaskId,
    })
    .where(eq(adminRequests.id, request.id))

  await logActivity({
    companyId: currentUser.companyId,
    actorId: currentUser.id,
    entityId: request.id,
    action: 'approved',
    summary: `approved ${request.title}`,
  })
  await notifyUsers([
    {
      companyId: currentUser.companyId,
      userId: request.requestorId,
      title: 'Request approved',
      body: request.kind === 'letter' ? `${request.title} is ready to print from My office.` : `${request.title} was approved.`,
      entityId: request.id,
      type: 'approval_decision',
    },
  ])
  await tryEmail(
    request.requestor.email,
    officeNoticeEmail({
      firstName: request.requestor.firstName,
      title: 'Request approved',
      body: request.kind === 'letter' ? `${request.title} is ready to print from My office.` : `${request.title} was approved.`,
      href: officeHref('My office'),
      cta: 'Open My office',
    }),
  )
  refresh()
  return { ok: true, notice: 'Approved.' }
}

export async function updateStaffProfile(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  const userId = field(formData, 'userId')
  if (!userId) return { error: 'Choose a person.' }
  const target = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
    with: { department: true, roles: { with: { role: true } } },
  })
  if (!target || target.companyId !== currentUser.companyId) return { error: 'Person not found.' }
  const self = target.id === currentUser.id
  const office = canRunAdminOffice(currentUser)
  if (!self && !office) return { error: 'You cannot edit this record.' }
  if (isAdmin(target) && !isAdmin(currentUser)) return { error: 'Workspace admin records stay with the workspace admin.' }

  await ensureProfile(target.id, target.jobTitle, target.department?.slug)
  if (!office) {
    await getDb()
      .update(staffProfiles)
      .set({
        emergencyName: cleanBlock(field(formData, 'emergencyName'), 120) || null,
        emergencyPhone: cleanBlock(field(formData, 'emergencyPhone'), 40) || null,
        updatedAt: new Date(),
      })
      .where(eq(staffProfiles.userId, target.id))
    refresh()
    return { ok: true, notice: 'Emergency contact saved.' }
  }

  const employmentType = field(formData, 'employmentType') as EmploymentType
  if (!EMPLOYMENT_TYPES.has(employmentType)) return { error: 'Choose an employment type.' }
  const startDate = dateOrEmpty(field(formData, 'startDate'))
  const endDate = dateOrEmpty(field(formData, 'endDate'))
  const probationEndDate = dateOrEmpty(field(formData, 'probationEndDate'))
  if (startDate === undefined || endDate === undefined || probationEndDate === undefined) return { error: 'Use real dates, or leave the date blank.' }
  if (startDate && endDate && endDate < startDate) return { error: 'The contract end is before the start date.' }
  const annual = readInt(field(formData, 'annualEntitlementDays'), 0, 40)
  const sick = readInt(field(formData, 'sickEntitlementDays'), 0, 30)
  const carry = readHundredths(field(formData, 'carryOverDays'), 10)
  if (annual == null || sick == null || carry == null) return { error: 'Leave numbers must be within the allowed range. Carry-over is capped at 10 days.' }
  if (carry > CARRY_CAP_HUNDREDTHS) return { error: 'Carry-over is capped at 10 days.' }

  await getDb()
    .update(staffProfiles)
    .set({
      employmentType,
      startDate,
      endDate,
      probationEndDate,
      annualEntitlementDays: annual,
      sickEntitlementDays: sick,
      carryOverHundredths: carry,
      emergencyName: cleanBlock(field(formData, 'emergencyName'), 120) || null,
      emergencyPhone: cleanBlock(field(formData, 'emergencyPhone'), 40) || null,
      notes: cleanBlock(field(formData, 'notes'), 2000) || null,
      updatedAt: new Date(),
    })
    .where(eq(staffProfiles.userId, target.id))
  refresh()
  return { ok: true, notice: `${target.firstName}'s staff record was saved. ${EMPLOYMENT_TYPE_LABELS[employmentType]}.` }
}

export async function saveOffer(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can draft offers.' }
  const candidateName = cleanBlock(field(formData, 'candidateName'), 120)
  const jobTitle = cleanBlock(field(formData, 'jobTitle'), 120)
  if (!candidateName || !jobTitle) return { error: 'The candidate needs a name and a job title.' }
  const email = field(formData, 'candidateEmail')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'The candidate email does not look right.' }
  const startDate = dateOrEmpty(field(formData, 'startDate'))
  if (startDate === undefined) return { error: 'Use a real start date, or leave it blank.' }
  const probationMonths = readInt(field(formData, 'probationMonths') || '3', 0, 12)
  if (probationMonths == null) return { error: 'Probation must be between 0 and 12 months.' }
  const departmentId = field(formData, 'departmentId')
  let departmentName: string | null = null
  if (departmentId) {
    const department = await getDb().query.departments.findFirst({ where: eq(departments.id, departmentId) })
    if (!department || department.companyId !== currentUser.companyId) return { error: 'Choose a department in this company.' }
    departmentName = department.name
  }
  const salaryText = cleanBlock(field(formData, 'salaryText'), 180)
  const notes = cleanBlock(field(formData, 'notes'), 2000)
  const bodyHtml = buildOfferLetter({
    companyName: await companyName(currentUser.companyId),
    documentNumber: null,
    candidateName,
    jobTitle,
    departmentName,
    salaryText: salaryText || null,
    startDate,
    probationMonths,
    notes: notes || null,
    today: nairobiToday(),
    letterhead: embeddedLetterheadSrc(),
  })
  const [created] = await getDb()
    .insert(offerLetters)
    .values({
      companyId: currentUser.companyId,
      createdById: currentUser.id,
      departmentId: departmentId || null,
      candidateName,
      candidateEmail: email || null,
      jobTitle,
      salaryText: salaryText || null,
      startDate,
      probationMonths,
      notes: notes || null,
      bodyHtml,
      status: 'draft',
    })
    .returning()
  if (!created) return { error: 'The offer could not be saved.' }
  refresh()
  return { ok: true, notice: 'Offer draft saved. Send it to the managing director when the wording is right.' }
}

export async function decideOffer(offerId: string, decision: 'send' | 'issue' | 'accept' | 'decline' | 'withdraw') {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can update offers.' }
  const offer = await getDb().query.offerLetters.findFirst({
    where: eq(offerLetters.id, offerId),
    with: { department: true },
  })
  if (!offer || offer.companyId !== currentUser.companyId) return { error: 'Offer not found.' }

  if (decision === 'send') {
    if (offer.status !== 'draft') return { error: 'Only a draft can be sent to the managing director.' }
    await getDb().update(offerLetters).set({ status: 'awaiting_md', updatedAt: new Date() }).where(eq(offerLetters.id, offer.id))
    const directors = await managingDirectors(currentUser.companyId)
    await notifyUsers(
      directors.map((person) => ({
        companyId: currentUser.companyId,
        userId: person.id,
        title: 'Offer waiting for you',
        body: `${offer.candidateName} · ${offer.jobTitle}`,
        entityId: offer.id,
        type: 'approval_request' as const,
      })),
    )
    refresh()
    return { ok: true, notice: 'Sent to the managing director.' }
  }

  if (decision === 'issue') {
    if (!isManagement(currentUser)) return { error: 'The managing director issues offers.' }
    if (offer.status !== 'draft' && offer.status !== 'awaiting_md') return { error: 'This offer can no longer be issued.' }
    const documentNumber = offer.documentNumber ?? (await nextOfficeNumber('OFR'))
    const bodyHtml = buildOfferLetter({
      companyName: await companyName(currentUser.companyId),
      documentNumber,
      candidateName: offer.candidateName,
      jobTitle: offer.jobTitle,
      departmentName: offer.department?.name ?? null,
      salaryText: offer.salaryText,
      startDate: offer.startDate,
      probationMonths: offer.probationMonths,
      notes: offer.notes,
      today: nairobiToday(),
      letterhead: embeddedLetterheadSrc(),
    })
    await getDb()
      .update(offerLetters)
      .set({ status: 'issued', documentNumber, bodyHtml, approvedById: currentUser.id, updatedAt: new Date() })
      .where(eq(offerLetters.id, offer.id))
    const mailed = await tryEmail(offer.candidateEmail, {
      subject: `Offer of employment — ${offer.jobTitle}`,
      html: bodyHtml,
      text: `Dear ${offer.candidateName}, your offer for ${offer.jobTitle} is attached in this email as a printable letter.`,
    })
    refresh()
    return {
      ok: true,
      notice: mailed
        ? 'Offer issued and emailed to the candidate.'
        : 'Offer issued. Email is not configured, so print the letter and send it.',
    }
  }

  const next =
    decision === 'accept' ? 'accepted' : decision === 'decline' ? 'declined' : decision === 'withdraw' ? 'withdrawn' : null
  if (!next) return { error: 'That offer update is not available.' }
  if (offer.status !== 'issued' && decision !== 'withdraw') return { error: 'Issue the offer before recording the reply.' }
  if (decision === 'withdraw' && (offer.status === 'accepted' || offer.status === 'declined')) {
    return { error: 'This offer already has a final reply.' }
  }
  await getDb().update(offerLetters).set({ status: next, updatedAt: new Date() }).where(eq(offerLetters.id, offer.id))
  refresh()
  return { ok: true, notice: 'Offer updated.' }
}

export async function saveDocument(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can file documents.' }
  const title = cleanBlock(field(formData, 'title'), 180)
  if (!title) return { error: 'The document needs a title.' }
  const status = field(formData, 'status')
  if (!['draft', 'review', 'published', 'superseded', 'archived'].includes(status)) return { error: 'Choose a document status.' }
  const effectiveDate = dateOrEmpty(field(formData, 'effectiveDate'))
  const reviewDate = dateOrEmpty(field(formData, 'reviewDate'))
  if (effectiveDate === undefined || reviewDate === undefined) return { error: 'Use real dates, or leave them blank.' }
  const fileRaw = field(formData, 'fileUrl')
  const fileUrl = fileRaw ? cleanUrl(fileRaw) : null
  if (fileRaw && !fileUrl) return { error: 'The file link is not valid.' }
  const documentNumber = status === 'published' ? await nextOfficeNumber('DOC') : null
  await getDb().insert(officeDocuments).values({
    companyId: currentUser.companyId,
    ownerId: currentUser.id,
    title,
    category: cleanBlock(field(formData, 'category'), 40) || 'policy',
    status: status as 'draft' | 'review' | 'published' | 'superseded' | 'archived',
    body: cleanBlock(field(formData, 'body'), 8000) || null,
    fileUrl,
    documentNumber,
    effectiveDate,
    reviewDate,
  })
  refresh()
  return { ok: true, notice: status === 'published' ? 'Published. People can acknowledge it from My office.' : 'Document saved.' }
}

export async function acknowledgeDocument(documentId: string) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  const document = await getDb().query.officeDocuments.findFirst({ where: eq(officeDocuments.id, documentId) })
  if (!document || document.companyId !== currentUser.companyId || document.status !== 'published') {
    return { error: 'That document is not available to acknowledge.' }
  }
  await getDb()
    .insert(documentAcknowledgements)
    .values({ documentId: document.id, userId: currentUser.id })
    .onConflictDoNothing()
  refresh()
  return { ok: true, notice: 'Acknowledged.' }
}

export async function saveVendor(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can keep the vendor register.' }
  const name = cleanBlock(field(formData, 'name'), 160)
  if (!name) return { error: 'The vendor needs a name.' }
  const renewalDate = dateOrEmpty(field(formData, 'renewalDate'))
  if (renewalDate === undefined) return { error: 'Use a real renewal date, or leave it blank.' }
  const amount = readInt(field(formData, 'amountKes').replace(/,/g, '') || '0', 0, 50_000_000)
  if (amount == null) return { error: 'Enter the amount in Kenya shillings, or leave it at 0.' }
  const ownerId = field(formData, 'ownerId')
  if (ownerId) {
    const owner = await getDb().query.users.findFirst({ where: eq(users.id, ownerId) })
    if (!owner || owner.companyId !== currentUser.companyId) return { error: 'Choose an owner in this company.' }
  }
  await getDb().insert(officeVendors).values({
    companyId: currentUser.companyId,
    ownerId: ownerId || null,
    name,
    category: cleanBlock(field(formData, 'category'), 40) || 'software',
    renewalDate,
    amountKes: amount,
    notes: cleanBlock(field(formData, 'notes'), 1000) || null,
  })
  refresh()
  return { ok: true, notice: 'Vendor saved. Renewals inside 45 days show on Admin today.' }
}

export async function saveAsset(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can keep the asset register.' }
  const name = cleanBlock(field(formData, 'name'), 160)
  if (!name) return { error: 'The asset needs a name.' }
  const assignedUserId = field(formData, 'assignedUserId')
  let status = field(formData, 'status') || 'in_stock'
  if (!['in_stock', 'assigned', 'repair', 'retired'].includes(status)) return { error: 'Choose an asset status.' }
  if (assignedUserId) {
    const assignee = await getDb().query.users.findFirst({ where: eq(users.id, assignedUserId) })
    if (!assignee || assignee.companyId !== currentUser.companyId) return { error: 'Choose a person in this company.' }
    if (status === 'in_stock') status = 'assigned'
  }
  await getDb().insert(officeAssets).values({
    companyId: currentUser.companyId,
    assignedUserId: assignedUserId || null,
    name,
    assetTag: cleanBlock(field(formData, 'assetTag'), 40) || null,
    status: status as 'in_stock' | 'assigned' | 'repair' | 'retired',
    notes: cleanBlock(field(formData, 'notes'), 1000) || null,
  })
  refresh()
  return { ok: true, notice: 'Asset saved.' }
}

export async function saveCompliance(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can add compliance reminders.' }
  const title = cleanBlock(field(formData, 'title'), 180)
  if (!title) return { error: 'The reminder needs a title.' }
  const dueDate = dateOrEmpty(field(formData, 'dueDate'))
  if (dueDate === undefined) return { error: 'Use a real due date, or leave it blank.' }
  const cadence = field(formData, 'cadence') || 'once'
  if (!['once', 'monthly', 'quarterly', 'annual'].includes(cadence)) return { error: 'Choose how often this repeats.' }
  await getDb().insert(officeCompliance).values({
    companyId: currentUser.companyId,
    ownerId: currentUser.id,
    title,
    category: cleanBlock(field(formData, 'category'), 40) || 'statutory',
    dueDate,
    cadence,
    notes: cleanBlock(field(formData, 'notes'), 1000) || null,
    status: 'upcoming',
  })
  refresh()
  return { ok: true, notice: 'Reminder added.' }
}

export async function completeCompliance(itemId: string) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can close reminders.' }
  const item = await getDb().query.officeCompliance.findFirst({ where: eq(officeCompliance.id, itemId) })
  if (!item || item.companyId !== currentUser.companyId) return { error: 'Reminder not found.' }
  if (item.cadence === 'once' || !item.dueDate) {
    await getDb()
      .update(officeCompliance)
      .set({ status: 'done', updatedAt: new Date() })
      .where(eq(officeCompliance.id, item.id))
    refresh()
    return { ok: true, notice: 'Marked done.' }
  }
  await getDb()
    .update(officeCompliance)
    .set({ dueDate: addCadence(item.dueDate, item.cadence), status: 'upcoming', updatedAt: new Date() })
    .where(eq(officeCompliance.id, item.id))
  refresh()
  return { ok: true, notice: `Done. The next ${item.cadence} date is on the calendar.` }
}

async function companyName(companyId: string) {
  const company = await getDb().query.companies.findFirst({ where: eq(companies.id, companyId) })
  return company?.name ?? 'Globecon Convergence Solutions'
}

async function ensureProfile(userId: string, jobTitle: string, departmentSlug?: string | null) {
  const existing = await getDb().query.staffProfiles.findFirst({ where: eq(staffProfiles.userId, userId) })
  if (existing) return existing
  const defaults = defaultEmployment({ jobTitle, departmentSlug })
  const [created] = await getDb()
    .insert(staffProfiles)
    .values({
      userId,
      employmentType: defaults.employmentType,
      annualEntitlementDays: defaults.annual,
      sickEntitlementDays: defaults.sick,
      leaveYear: Number(nairobiToday().slice(0, 4)),
    })
    .onConflictDoNothing()
    .returning()
  if (created) return created
  const again = await getDb().query.staffProfiles.findFirst({ where: eq(staffProfiles.userId, userId) })
  if (!again) throw new Error('Staff profile could not be created.')
  return again
}

async function officeRecipients(companyId: string, exceptUserId: string) {
  const rows = await getDb().query.users.findMany({
    where: eq(users.companyId, companyId),
    with: { department: true, roles: { with: { role: true } } },
  })
  const operators = rows.filter(
    (row) =>
      row.id !== exceptUserId &&
      row.status === 'active' &&
      row.department?.slug === ADMIN_OFFICE_DEPARTMENT_SLUG &&
      row.roles.some((entry) => entry.role.key === 'department_head' || entry.role.key === 'manager'),
  )
  if (operators.length > 0) return operators
  return rows.filter((row) => row.id !== exceptUserId && row.status === 'active' && canRunAdminOffice(row))
}

function expenseFromForm(formData: FormData) {
  const spentOn = dateOrEmpty(field(formData, 'spentOn'))
  if (spentOn === undefined) return { error: 'Use a real date, or leave it blank.' as const }
  const description = cleanBlock(field(formData, 'description'), 500)
  const paidTo = cleanBlock(field(formData, 'paidTo'), 200)
  if (!description && !paidTo) return { error: 'Add a description or who was paid.' as const }
  const amountText = field(formData, 'amount')
  const amountCents = amountText ? parseAmountText(amountText) : null
  if (amountText && amountCents == null) return { error: 'Enter the amount in shillings, such as 1500 or 10027.11.' as const }
  const draft: ExpenseDraft = {
    spentOn,
    voucherNo: cleanBlock(field(formData, 'voucherNo'), 40),
    description,
    paidTo,
    category: cleanExpenseCategory(field(formData, 'category')),
    amountCents,
    paymentMethod: cleanBlock(field(formData, 'paymentMethod'), 40),
    receiptNo: cleanBlock(field(formData, 'receiptNo'), 80),
    approvedBy: cleanBlock(field(formData, 'approvedBy'), 80),
    remarks: cleanBlock(field(formData, 'remarks'), 500),
  }
  return { draft }
}

function expenseValues(companyId: string, createdById: string, draft: ExpenseDraft) {
  return {
    companyId,
    createdById,
    spentOn: draft.spentOn,
    voucherNo: draft.voucherNo || null,
    description: draft.description,
    paidTo: draft.paidTo || null,
    category: draft.category || null,
    amountCents: draft.amountCents,
    paymentMethod: draft.paymentMethod || null,
    receiptNo: draft.receiptNo || null,
    approvedBy: draft.approvedBy || null,
    remarks: draft.remarks || null,
    updatedAt: new Date(),
  }
}

export async function saveExpense(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can record expenses.' }
  const parsed = expenseFromForm(formData)
  if ('error' in parsed) return parsed
  const id = field(formData, 'id')
  if (id) {
    const existing = await getDb().query.officeExpenses.findFirst({ where: eq(officeExpenses.id, id) })
    if (!existing || existing.companyId !== currentUser.companyId) return { error: 'That expense is no longer in the book.' }
    await getDb().update(officeExpenses).set(expenseValues(currentUser.companyId, currentUser.id, parsed.draft)).where(eq(officeExpenses.id, id))
    refresh()
    return { ok: true as const, notice: 'Expense updated.' }
  }
  await getDb().insert(officeExpenses).values(expenseValues(currentUser.companyId, currentUser.id, parsed.draft))
  refresh()
  return { ok: true as const, notice: 'Expense recorded.' }
}

export async function deleteExpense(id: string) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can remove expenses.' }
  const existing = await getDb().query.officeExpenses.findFirst({ where: eq(officeExpenses.id, id) })
  if (!existing || existing.companyId !== currentUser.companyId) return { error: 'That expense is no longer in the book.' }
  await getDb().delete(officeExpenses).where(eq(officeExpenses.id, id))
  refresh()
  return { ok: true as const, notice: 'Expense removed.' }
}

export async function importExpenses(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can import expenses.' }
  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Choose an Excel workbook (.xlsx).' }
  const name = file.name.toLowerCase()
  if (!name.endsWith('.xlsx')) return { error: 'Use an Excel workbook (.xlsx), the same kind as the petty cash book.' }
  if (file.size > 5_000_000) return { error: 'That workbook is larger than 5 MB.' }
  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = await readExpenseWorkbook(buffer)
  if ('error' in parsed) return parsed
  const replace = field(formData, 'replace') === 'yes'
  const existing = await getDb().select().from(officeExpenses).where(eq(officeExpenses.companyId, currentUser.companyId))
  const existingKeys = new Set(existing.map((row) => expenseFingerprint({
    spentOn: row.spentOn,
    paidTo: row.paidTo ?? '',
    description: row.description,
    amountCents: row.amountCents,
    receiptNo: row.receiptNo ?? '',
  })))
  const seen = new Set<string>()
  const fresh: ExpenseDraft[] = []
  let skipped = 0
  for (const row of parsed.rows) {
    const key = expenseFingerprint(row)
    if (seen.has(key) || (!replace && existingKeys.has(key))) {
      skipped += 1
      continue
    }
    seen.add(key)
    fresh.push(row)
  }
  if (fresh.length === 0) {
    return { ok: true as const, notice: skipped > 0 ? `Nothing new to add. ${skipped} row${skipped === 1 ? '' : 's'} already in the book.` : 'The workbook had no new expenses.' }
  }
  await getDb().insert(officeExpenses).values(fresh.map((row) => expenseValues(currentUser.companyId, currentUser.id, row)))
  if (replace && existing.length > 0) {
    await getDb().delete(officeExpenses).where(inArray(officeExpenses.id, existing.map((row) => row.id)))
  }
  refresh()
  const missing = fresh.filter((row) => row.amountCents == null).length
  const missingNote = missing > 0 ? ` ${missing} still need an amount.` : ''
  const skippedNote = skipped > 0 ? ` ${skipped} matching row${skipped === 1 ? '' : 's'} left as they were.` : ''
  return {
    ok: true as const,
    notice: replace
      ? `Replaced the book with ${fresh.length} expense${fresh.length === 1 ? '' : 's'}.${missingNote}`
      : `Added ${fresh.length} expense${fresh.length === 1 ? '' : 's'}.${skippedNote}${missingNote}`,
  }
}

export async function exportExpenses() {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can export expenses.' }
  const rows = await getDb().select().from(officeExpenses).where(eq(officeExpenses.companyId, currentUser.companyId))
  const ordered = [...rows].sort((a, b) => (a.spentOn ?? '').localeCompare(b.spentOn ?? ''))
  const file = await writeExpenseWorkbook(ordered.map((row) => ({
    spentOn: row.spentOn,
    voucherNo: row.voucherNo ?? '',
    description: row.description,
    paidTo: row.paidTo ?? '',
    category: row.category ?? '',
    amountCents: row.amountCents,
    paymentMethod: row.paymentMethod ?? '',
    receiptNo: row.receiptNo ?? '',
    approvedBy: row.approvedBy ?? '',
    remarks: row.remarks ?? '',
  })))
  return { ok: true as const, filename: 'expenses-petty-cash.xlsx', base64: file.toString('base64') }
}

export async function saveExpenseCategory(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can add expense categories.' }
  const name = cleanExpenseCategory(field(formData, 'name'))
  if (!name) return { error: 'Give the category a name.' as const }
  if (isStandardExpenseCategory(name)) {
    return { ok: true as const, notice: `${name} is already one of the standard categories.`, name }
  }
  const existing = await getDb().query.officeExpenseCategories.findFirst({
    where: and(eq(officeExpenseCategories.companyId, currentUser.companyId), eq(officeExpenseCategories.name, name)),
  })
  if (existing) return { ok: true as const, notice: `${name} is already on the list.`, name }
  await getDb().insert(officeExpenseCategories).values({ companyId: currentUser.companyId, name })
  refresh()
  return { ok: true as const, notice: `Added category “${name}”.`, name }
}

export async function deleteExpenseCategory(name: string) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can remove expense categories.' }
  const cleaned = cleanExpenseCategory(name)
  if (!cleaned) return { error: 'That category is not on the list.' as const }
  if (isStandardExpenseCategory(cleaned)) return { error: 'The standard categories stay on the list.' as const }
  await getDb()
    .delete(officeExpenseCategories)
    .where(and(eq(officeExpenseCategories.companyId, currentUser.companyId), eq(officeExpenseCategories.name, cleaned)))
  refresh()
  return { ok: true as const, notice: `Removed “${cleaned}” from the category list. Expenses that already use it keep that label until you move them.` }
}

export async function reassignExpenseCategories(formData: FormData) {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  const { currentUser } = loaded
  if (!canRunAdminOffice(currentUser)) return { error: 'Only the admin office can change expense categories.' }
  const target = cleanExpenseCategory(field(formData, 'toCategory'))
  if (!target) return { error: 'Choose the category to move these expenses into.' as const }
  const mode = field(formData, 'mode')
  const db = getDb()
  let ids: string[] = []

  if (mode === 'from') {
    const fromCategory = field(formData, 'fromCategory')
    const rows = await db.select({ id: officeExpenses.id, category: officeExpenses.category }).from(officeExpenses).where(eq(officeExpenses.companyId, currentUser.companyId))
    ids = rows
      .filter((row) => (fromCategory === '__none__' ? !row.category : (row.category ?? '') === fromCategory))
      .map((row) => row.id)
  } else {
    ids = formData.getAll('expenseId').filter((value): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value))
    if (ids.length === 0) return { error: 'Tick the expenses you want to move, or choose “everything in a category”.' as const }
    const owned = await db
      .select({ id: officeExpenses.id })
      .from(officeExpenses)
      .where(and(eq(officeExpenses.companyId, currentUser.companyId), inArray(officeExpenses.id, ids)))
    if (owned.length !== new Set(ids).size) return { error: 'One of those expenses is no longer in the book. Refresh and try again.' }
    ids = owned.map((row) => row.id)
  }

  if (ids.length === 0) return { error: 'No expenses matched that selection.' as const }
  if (!isStandardExpenseCategory(target)) {
    const custom = await db.query.officeExpenseCategories.findFirst({
      where: and(eq(officeExpenseCategories.companyId, currentUser.companyId), eq(officeExpenseCategories.name, target)),
    })
    if (!custom) {
      await db.insert(officeExpenseCategories).values({ companyId: currentUser.companyId, name: target })
    }
  }
  await db
    .update(officeExpenses)
    .set({ category: target, updatedAt: new Date() })
    .where(and(eq(officeExpenses.companyId, currentUser.companyId), inArray(officeExpenses.id, ids)))
  refresh()
  return {
    ok: true as const,
    notice: `Moved ${ids.length} expense${ids.length === 1 ? '' : 's'} to “${target}”.`,
    count: ids.length,
  }
}

const PAYMENT_KINDS = new Set<PaymentKind>(['bank', 'paybill', 'other'])
const INVOICE_STATUSES = new Set(['draft', 'sent', 'paid', 'void'])

function emailOrEmpty(value: string) {
  if (!value) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 200) return undefined
  return value
}

async function officeGate() {
  const loaded = await actor()
  if ('error' in loaded) return loaded
  if (!canRunAdminOffice(loaded.currentUser)) return { error: 'Only the admin office can work with invoices.' as const }
  return loaded
}

function invoiceFile(invoice: {
  documentNumber: string | null
  issueDate: string
  dueDate: string | null
  clientName: string
  clientEmail: string | null
  clientAddress: string | null
  clientPin: string | null
  companyPin: string | null
  vatEnabled: boolean
  vatRateBps: number
  notes: string | null
  paymentSnapshot: string
  lines: { description: string; quantityHundredths: number; rateCents: number }[]
}) {
  const payments = parsePaymentSnapshot(invoice.paymentSnapshot)
  const lines = [...invoice.lines]
  const shared = {
    documentNumber: invoice.documentNumber ?? 'Invoice',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    clientName: invoice.clientName,
    companyPin: invoice.companyPin,
    vatEnabled: invoice.vatEnabled,
    vatRateBps: invoice.vatRateBps,
    lines,
    payments: Array.isArray(payments) ? payments : [],
    notes: invoice.notes,
  }
  const html = buildInvoiceHtml({
    ...shared,
    clientEmail: invoice.clientEmail,
    clientAddress: invoice.clientAddress,
    clientPin: invoice.clientPin,
    letterhead: embeddedLetterheadSrc(),
  })
  const filename = `${(invoice.documentNumber ?? 'invoice').replace(/[^\w.-]+/g, '-')}.html`
  return { html, filename, text: invoicePlainText(shared), subject: `Invoice ${shared.documentNumber} from Globecon Convergence Solutions` }
}

export async function saveInvoiceSettings(formData: FormData) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const vatEnabled = field(formData, 'vatEnabled') === 'yes'
  const rate = parseVatRate(field(formData, 'vatRate'))
  if (rate == null) return { error: 'Enter a VAT rate from 0 to 100, such as 16 or 8.' as const }
  const companyPin = cleanBlock(field(formData, 'companyPin'), 40)
  await getDb()
    .insert(officeInvoiceSettings)
    .values({
      companyId: loaded.currentUser.companyId,
      vatEnabled,
      vatRateBps: rate,
      companyPin: companyPin || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: officeInvoiceSettings.companyId,
      set: { vatEnabled, vatRateBps: rate, companyPin: companyPin || null, updatedAt: new Date() },
    })
  refresh()
  return { ok: true as const, notice: 'VAT rate and company PIN saved. New invoices start from these. Invoices already saved keep their own copy.' }
}

export async function savePaymentAccount(formData: FormData) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const label = cleanBlock(field(formData, 'label'), 80)
  const details = cleanBlock(field(formData, 'details'), 1000)
  const kind = field(formData, 'kind')
  if (!label) return { error: 'Give this way of paying a name, such as KCB account or Paybill.' as const }
  if (!details) return { error: 'Write the account or paybill details that should appear on the invoice.' as const }
  if (!PAYMENT_KINDS.has(kind as PaymentKind)) return { error: 'Choose bank, paybill, or other.' as const }
  const active = field(formData, 'active') !== 'no'
  const id = field(formData, 'id')
  if (id) {
    const existing = await getDb().query.officePaymentAccounts.findFirst({ where: eq(officePaymentAccounts.id, id) })
    if (!existing || existing.companyId !== loaded.currentUser.companyId) return { error: 'That payment detail is no longer there.' }
    await getDb()
      .update(officePaymentAccounts)
      .set({ label, details, kind, active, updatedAt: new Date() })
      .where(eq(officePaymentAccounts.id, id))
    refresh()
    return { ok: true as const, notice: 'Payment details updated. Open an invoice and save it again if that invoice should use the new wording.' }
  }
  const existing = await getDb().select({ id: officePaymentAccounts.id }).from(officePaymentAccounts).where(eq(officePaymentAccounts.companyId, loaded.currentUser.companyId))
  await getDb().insert(officePaymentAccounts).values({
    companyId: loaded.currentUser.companyId,
    label,
    details,
    kind,
    active,
    sortOrder: existing.length,
  })
  refresh()
  return { ok: true as const, notice: 'Payment details added. Tick them on the invoices that should show them.' }
}

export async function deletePaymentAccount(id: string) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const existing = await getDb().query.officePaymentAccounts.findFirst({ where: eq(officePaymentAccounts.id, id) })
  if (!existing || existing.companyId !== loaded.currentUser.companyId) return { error: 'That payment detail is no longer there.' }
  await getDb().delete(officePaymentAccounts).where(eq(officePaymentAccounts.id, id))
  refresh()
  return { ok: true as const, notice: 'Payment details removed. Invoices already saved still show the wording they were saved with.' }
}

export async function saveClient(formData: FormData) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const name = cleanBlock(field(formData, 'name'), 200)
  if (!name) return { error: 'Enter the client name.' as const }
  const email = emailOrEmpty(field(formData, 'email'))
  if (email === undefined) return { error: 'Enter a real email address, or leave it blank.' as const }
  const values = {
    name,
    email,
    phone: cleanBlock(field(formData, 'phone'), 40) || null,
    address: cleanBlock(field(formData, 'address'), 500) || null,
    pin: cleanBlock(field(formData, 'pin'), 40) || null,
    updatedAt: new Date(),
  }
  const id = field(formData, 'id')
  if (id) {
    const existing = await getDb().query.officeClients.findFirst({ where: eq(officeClients.id, id) })
    if (!existing || existing.companyId !== loaded.currentUser.companyId) return { error: 'That client is no longer saved.' }
    await getDb().update(officeClients).set(values).where(eq(officeClients.id, id))
    refresh()
    return { ok: true as const, notice: 'Client updated.' }
  }
  await getDb().insert(officeClients).values({ companyId: loaded.currentUser.companyId, ...values })
  refresh()
  return { ok: true as const, notice: 'Client saved. You can pick them on the next invoice.' }
}

export async function deleteClient(id: string) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const existing = await getDb().query.officeClients.findFirst({ where: eq(officeClients.id, id) })
  if (!existing || existing.companyId !== loaded.currentUser.companyId) return { error: 'That client is no longer saved.' }
  await getDb().delete(officeClients).where(eq(officeClients.id, id))
  refresh()
  return { ok: true as const, notice: 'Client removed. Invoices already written keep the name that was on them.' }
}

function invoiceLinesFromForm(formData: FormData) {
  const raw = field(formData, 'lines')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'Add at least one line to the invoice.' as const }
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 40) return { error: 'Add between 1 and 40 lines.' as const }
  const lines: { description: string; quantityHundredths: number; rateCents: number }[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return { error: 'Check the invoice lines.' as const }
    const row = item as Record<string, unknown>
    const description = typeof row.description === 'string' ? cleanBlock(row.description, 300) : ''
    const quantity = typeof row.quantity === 'string' ? parseQuantity(row.quantity) : null
    const rate = typeof row.rate === 'string' ? parseAmountText(row.rate) : null
    if (!description) return { error: 'Each line needs a description.' as const }
    if (quantity == null) return { error: 'Enter a quantity such as 1 or 1.5.' as const }
    if (rate == null) return { error: 'Enter each rate in shillings, such as 25000.' as const }
    if (!amountWithinLimit(lineAmountCents(quantity, rate))) return { error: 'One of the line amounts is too large.' as const }
    lines.push({ description, quantityHundredths: quantity, rateCents: rate })
  }
  return { lines }
}

export async function saveInvoice(formData: FormData) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const clientName = cleanBlock(field(formData, 'clientName'), 200)
  if (!clientName) return { error: 'Enter who the invoice is for.' as const }
  const clientEmail = emailOrEmpty(field(formData, 'clientEmail'))
  if (clientEmail === undefined) return { error: 'Enter a real client email, or leave it blank until you are ready to send.' as const }
  const issueDate = dateOrEmpty(field(formData, 'issueDate'))
  if (!issueDate) return { error: 'Enter the invoice date.' as const }
  const dueDate = dateOrEmpty(field(formData, 'dueDate'))
  if (dueDate === undefined) return { error: 'Enter a real due date, or leave it blank.' as const }
  const vatEnabled = field(formData, 'vatEnabled') === 'yes'
  const vatRateBps = parseVatRate(field(formData, 'vatRate') || '0')
  if (vatRateBps == null) return { error: 'Enter the VAT rate for this invoice, such as 16. You can change it later.' as const }
  const parsedLines = invoiceLinesFromForm(formData)
  if ('error' in parsedLines) return parsedLines
  const totals = invoiceTotals(parsedLines.lines, vatEnabled, vatRateBps)
  if (!amountWithinLimit(totals.totalCents)) return { error: 'The invoice total is too large.' as const }
  const paymentIds = formData.getAll('paymentId').filter((value): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value))
  const accounts = paymentIds.length
    ? await getDb().select().from(officePaymentAccounts).where(and(eq(officePaymentAccounts.companyId, loaded.currentUser.companyId), inArray(officePaymentAccounts.id, paymentIds)))
    : []
  const payments = paymentIds.flatMap((id) => {
    const account = accounts.find((row) => row.id === id)
    if (!account) return []
    const kind: PaymentKind = account.kind === 'bank' || account.kind === 'paybill' || account.kind === 'other' ? account.kind : 'other'
    return [{ id: account.id, label: account.label, kind, details: account.details }]
  })
  const billTo = {
    clientName,
    clientEmail,
    clientPhone: cleanBlock(field(formData, 'clientPhone'), 40) || null,
    clientAddress: cleanBlock(field(formData, 'clientAddress'), 500) || null,
    clientPin: cleanBlock(field(formData, 'clientPin'), 40) || null,
  }
  let clientId = field(formData, 'clientId')
  if (clientId) {
    const client = await getDb().query.officeClients.findFirst({ where: eq(officeClients.id, clientId) })
    if (!client || client.companyId !== loaded.currentUser.companyId) return { error: 'That client is no longer saved. Pick them again or save a new one.' }
    if (field(formData, 'updateClient') === 'yes') {
      await getDb()
        .update(officeClients)
        .set({
          name: billTo.clientName,
          email: billTo.clientEmail,
          phone: billTo.clientPhone,
          address: billTo.clientAddress,
          pin: billTo.clientPin,
          updatedAt: new Date(),
        })
        .where(eq(officeClients.id, clientId))
    }
  } else {
    const [created] = await getDb()
      .insert(officeClients)
      .values({
        companyId: loaded.currentUser.companyId,
        name: billTo.clientName,
        email: billTo.clientEmail,
        phone: billTo.clientPhone,
        address: billTo.clientAddress,
        pin: billTo.clientPin,
      })
      .returning({ id: officeClients.id })
    clientId = created?.id ?? ''
  }
  const snapshot = {
    clientId: clientId || null,
    ...billTo,
    issueDate,
    dueDate,
    vatEnabled,
    vatRateBps,
    companyPin: cleanBlock(field(formData, 'companyPin'), 40) || null,
    paymentSnapshot: JSON.stringify(payments),
    notes: cleanBlock(field(formData, 'notes'), 1000) || null,
    updatedAt: new Date(),
  }
  const id = field(formData, 'id')
  let invoiceId = id
  if (id) {
    const existing = await getDb().query.officeInvoices.findFirst({ where: eq(officeInvoices.id, id), with: { lines: true } })
    if (!existing || existing.companyId !== loaded.currentUser.companyId) return { error: 'That invoice is no longer there.' }
    if (existing.status === 'void') return { error: 'A void invoice stays as it was. Start a new invoice instead.' }
    await getDb().update(officeInvoices).set(snapshot).where(eq(officeInvoices.id, id))
    const previous = existing.lines.map((line) => line.id)
    await getDb().insert(officeInvoiceLines).values(
      parsedLines.lines.map((line, position) => ({ invoiceId: id, position, ...line })),
    )
    if (previous.length > 0) await getDb().delete(officeInvoiceLines).where(inArray(officeInvoiceLines.id, previous))
  } else {
    const documentNumber = await nextOfficeNumber('INV')
    const [created] = await getDb()
      .insert(officeInvoices)
      .values({
        companyId: loaded.currentUser.companyId,
        createdById: loaded.currentUser.id,
        documentNumber,
        status: 'draft',
        ...snapshot,
      })
      .returning({ id: officeInvoices.id })
    invoiceId = created?.id ?? ''
    if (invoiceId) {
      await getDb().insert(officeInvoiceLines).values(
        parsedLines.lines.map((line, position) => ({ invoiceId, position, ...line })),
      )
    }
  }
  refresh()
  return {
    ok: true as const,
    id: invoiceId,
    clientId: snapshot.clientId,
    notice: 'Invoice saved. The VAT rate, PIN, and payment details on it stay as they are now, even if you change the settings later.',
  }
}

export async function setInvoiceStatus(id: string, status: string) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  if (!INVOICE_STATUSES.has(status)) return { error: 'Choose draft, sent, paid, or void.' }
  const existing = await getDb().query.officeInvoices.findFirst({ where: eq(officeInvoices.id, id) })
  if (!existing || existing.companyId !== loaded.currentUser.companyId) return { error: 'That invoice is no longer there.' }
  await getDb().update(officeInvoices).set({ status, updatedAt: new Date() }).where(eq(officeInvoices.id, id))
  refresh()
  const labels: Record<string, string> = { draft: 'Marked as a draft.', sent: 'Marked as sent.', paid: 'Marked as paid.', void: 'Invoice voided.' }
  return { ok: true as const, notice: labels[status] ?? 'Invoice updated.' }
}

export async function deleteInvoice(id: string) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const existing = await getDb().query.officeInvoices.findFirst({ where: eq(officeInvoices.id, id) })
  if (!existing || existing.companyId !== loaded.currentUser.companyId) return { error: 'That invoice is no longer there.' }
  if (existing.status !== 'draft') return { error: 'Only a draft can be deleted. Void a sent invoice instead, so the number stays on record.' }
  await getDb().delete(officeInvoices).where(eq(officeInvoices.id, id))
  refresh()
  return { ok: true as const, notice: 'Draft deleted.' }
}

async function savedInvoice(id: string, companyId: string, purpose: 'read' | 'send') {
  const invoice = await getDb().query.officeInvoices.findFirst({ where: eq(officeInvoices.id, id), with: { lines: true } })
  if (!invoice || invoice.companyId !== companyId) return { error: 'That invoice is no longer there.' as const }
  if (purpose === 'send' && invoice.status === 'void') return { error: 'A void invoice is not sent.' as const }
  if (invoice.lines.length === 0) return { error: 'Add a line and save the invoice first.' as const }
  return { invoice }
}

export async function previewInvoice(id: string) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const found = await savedInvoice(id, loaded.currentUser.companyId, 'read')
  if ('error' in found) return found
  const file = invoiceFile(found.invoice)
  return { ok: true as const, html: file.html, filename: file.filename }
}

export async function emailInvoice(id: string) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  if (!isMailConfigured()) return { error: 'The shared Task Buddy mailbox is not set up on this workspace yet. Use Open in Outlook instead.' }
  const found = await savedInvoice(id, loaded.currentUser.companyId, 'send')
  if ('error' in found) return found
  if (!found.invoice.clientEmail) return { error: 'Add the client email on this invoice and save it, then send.' }
  const file = invoiceFile(found.invoice)
  const totals = invoiceTotals(found.invoice.lines, found.invoice.vatEnabled, found.invoice.vatRateBps)
  try {
    await sendMail({
      to: found.invoice.clientEmail,
      subject: file.subject,
      text: file.text,
      html: `<p>Please find invoice ${found.invoice.documentNumber ?? ''} attached.</p><p>Total: ${formatMoney(totals.totalCents)}</p>${found.invoice.dueDate ? `<p>Due ${found.invoice.dueDate}</p>` : ''}<p>This email was sent from the Task Buddy mailbox.</p>`,
      attachments: [{ filename: file.filename, content: file.html, contentType: 'text/html' }],
    })
  } catch {
    return { error: 'Task Buddy could not send that email. Nothing was marked as sent. You can open it in Outlook instead.' }
  }
  if (found.invoice.status === 'draft') {
    await getDb().update(officeInvoices).set({ status: 'sent', updatedAt: new Date() }).where(eq(officeInvoices.id, id))
  }
  refresh()
  return {
    ok: true as const,
    notice: `Sent from the Task Buddy mailbox to ${found.invoice.clientEmail}. The invoice was attached. You did not need Outlook open.`,
  }
}

export async function outlookInvoice(id: string) {
  const loaded = await officeGate()
  if ('error' in loaded) return loaded
  const found = await savedInvoice(id, loaded.currentUser.companyId, 'send')
  if ('error' in found) return found
  if (!found.invoice.clientEmail) return { error: 'Add the client email on this invoice and save it, then open Outlook.' }
  const file = invoiceFile(found.invoice)
  const text = file.text.replace('The invoice is attached.', 'The invoice file is attached. Please check it and press Send.')
  const mailtoText = file.text.replace('The invoice is attached.', 'Download the invoice and attach it before you press Send.')
  const eml = outlookMessage({
    to: found.invoice.clientEmail,
    subject: file.subject,
    text,
    filename: file.filename,
    html: file.html,
  })
  return {
    ok: true as const,
    filename: file.filename.replace(/\.html$/, '.eml'),
    base64: Buffer.from(eml, 'utf8').toString('base64'),
    mailto: outlookMailLink({ to: found.invoice.clientEmail, subject: file.subject, body: mailtoText }),
    notice: 'Outlook file ready.',
  }
}
