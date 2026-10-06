'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import {
  ADMIN_OFFICE_DEPARTMENT_SLUG,
  canDecideAdminRequest,
  canRunAdminOffice,
  canSubmitAdminRequest,
  isAdmin,
  isManagement,
} from '@/lib/auth/permissions'
import { addCadence, addDaysIso, annualAvailableHundredths, isIsoDate, leaveSpanHundredths, nairobiToday, rangesOverlap } from '@/lib/admin-office/leave'
import { buildOfferLetter, buildStaffLetter } from '@/lib/admin-office/letters'
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
      assetBase: getPublicAppUrl(),
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
    assetBase: getPublicAppUrl(),
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
      assetBase: getPublicAppUrl(),
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
    assetBase: getPublicAppUrl(),
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
      assetBase: getPublicAppUrl(),
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
