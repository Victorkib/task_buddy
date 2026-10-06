import { asc, eq, sql } from 'drizzle-orm'
import { canRunAdminOffice } from '@/lib/auth/permissions'
import {
  addDaysIso,
  annualAvailableHundredths,
  complianceState,
  nairobiToday,
  proratedAnnualHundredths,
  rangesOverlap,
  rollLeaveYear,
  yearHolidays,
} from '@/lib/admin-office/leave'
import { defaultEmployment, requestNeedsMd, statutoryReminders } from '@/lib/admin-office/policy'
import type {
  AdminRequestKind,
  AdminRequestStatus,
  EmploymentType,
  LeaveType,
  OfficeDesk,
  OfficeLetterType,
  OfficePerson,
  OfficeRequest,
} from '@/lib/admin-office/types'
import { getDb } from '@/lib/db'
import {
  adminRequests,
  departments,
  documentAcknowledgements,
  offerLetters,
  officeAssets,
  officeCompliance,
  officeDocuments,
  officeSequences,
  officeVendors,
  staffProfiles,
  users,
} from '@/lib/db/schema'

type OfficeViewer = {
  id: string
  companyId: string
  departmentId?: string | null
  department?: { id?: string; slug?: string; name?: string } | null
  roles?: { role: { key: string } }[]
  firstName: string
  lastName: string
  email: string
  jobTitle: string
}

function personName(first: string, last: string) {
  return `${first} ${last}`.trim()
}

function unavailableDesk(user: OfficeViewer, message: string): OfficeDesk {
  return {
    ready: false,
    setupMessage: message,
    today: nairobiToday(),
    pendingCount: 0,
    minePending: 0,
    me: null,
    people: [],
    requests: [],
    offers: [],
    documents: [],
    vendors: [],
    assets: [],
    compliance: [],
    holidays: [],
    alerts: [],
    outNow: [],
    departments: [],
    coverOptions: [],
    imprestOutstandingKes: 0,
    leaveLiabilityHundredths: 0,
  }
}

async function ensureOfficeRecords(companyId: string, year: number) {
  const db = getDb()
  const [userRows, profileRows, departmentRows, complianceCount] = await Promise.all([
    db
      .select({
        id: users.id,
        companyId: users.companyId,
        departmentId: users.departmentId,
        jobTitle: users.jobTitle,
      })
      .from(users)
      .where(eq(users.companyId, companyId)),
    db.select().from(staffProfiles),
    db.select({ id: departments.id, slug: departments.slug }).from(departments).where(eq(departments.companyId, companyId)),
    db.select({ id: officeCompliance.id }).from(officeCompliance).where(eq(officeCompliance.companyId, companyId)),
  ])

  const slugByDepartment = new Map(departmentRows.map((row) => [row.id, row.slug]))
  const profileByUser = new Map(profileRows.map((row) => [row.userId, row]))
  const missing = userRows.filter((row) => !profileByUser.has(row.id))
  if (missing.length > 0) {
    await db
      .insert(staffProfiles)
      .values(
        missing.map((row) => {
          const defaults = defaultEmployment({
            departmentSlug: row.departmentId ? slugByDepartment.get(row.departmentId) : null,
            jobTitle: row.jobTitle,
          })
          return {
            userId: row.id,
            employmentType: defaults.employmentType,
            annualEntitlementDays: defaults.annual,
            sickEntitlementDays: defaults.sick,
            leaveYear: year,
          }
        }),
      )
      .onConflictDoNothing()
  }

  const freshProfiles = missing.length > 0 ? await db.select().from(staffProfiles) : profileRows
  for (const profile of freshProfiles) {
    if (!userRows.some((row) => row.id === profile.userId)) continue
    if (profile.leaveYear >= year) continue
    const rolled = rollLeaveYear(
      {
        ...profile,
        startDate: profile.startDate,
      },
      year,
    )
    if (rolled.leaveYear === profile.leaveYear) continue
    await db
      .update(staffProfiles)
      .set({
        leaveYear: rolled.leaveYear,
        carryOverHundredths: rolled.carryOverHundredths,
        annualUsedHundredths: 0,
        sickUsedHundredths: 0,
        unpaidUsedHundredths: 0,
        updatedAt: new Date(),
      })
      .where(eq(staffProfiles.userId, profile.userId))
  }

  if (complianceCount.length === 0) {
    const today = nairobiToday()
    await db.insert(officeCompliance).values(
      statutoryReminders(today).map((item) => ({
        companyId,
        title: item.title,
        category: item.category,
        dueDate: item.dueDate,
        cadence: item.cadence,
        notes: item.notes,
        status: 'upcoming' as const,
      })),
    )
  }
}

export async function nextOfficeNumber(prefix: 'HR' | 'OFR' | 'DOC') {
  const year = Number(nairobiToday().slice(0, 4))
  const key = `GCS-${prefix}-${year}`
  const [row] = await getDb()
    .insert(officeSequences)
    .values({ key, lastValue: 1 })
    .onConflictDoUpdate({
      target: officeSequences.key,
      set: { lastValue: sql`${officeSequences.lastValue} + 1` },
    })
    .returning()
  return `${key}-${String(row?.lastValue ?? 1).padStart(4, '0')}`
}

function toPerson(
  row: {
    id: string
    firstName: string
    lastName: string
    email: string
    jobTitle: string
    departmentId: string | null
    status: string
    department: { name: string } | null
    manager: { firstName: string; lastName: string } | null
    staffProfile: {
      employmentType: EmploymentType
      startDate: string | null
      endDate: string | null
      probationEndDate: string | null
      annualEntitlementDays: number
      sickEntitlementDays: number
      annualUsedHundredths: number
      sickUsedHundredths: number
      carryOverHundredths: number
      leaveYear: number
      emergencyName: string | null
      emergencyPhone: string | null
      notes: string | null
    } | null
  },
  year: number,
  includeNotes: boolean,
): OfficePerson {
  const profile = row.staffProfile
  const employmentType = profile?.employmentType ?? 'permanent'
  const annualPolicyDays = profile?.annualEntitlementDays ?? 21
  const sickPolicyDays = profile?.sickEntitlementDays ?? 7
  const startDate = profile?.startDate ?? null
  const usedAnnual = profile?.annualUsedHundredths ?? 0
  const usedSick = profile?.sickUsedHundredths ?? 0
  const carry = profile?.carryOverHundredths ?? 0
  const leaveYear = profile?.leaveYear ?? year
  return {
    id: row.id,
    name: personName(row.firstName, row.lastName),
    email: row.email,
    jobTitle: row.jobTitle,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    managerName: row.manager ? personName(row.manager.firstName, row.manager.lastName) : null,
    status: row.status,
    employmentType,
    startDate,
    endDate: profile?.endDate ?? null,
    probationEndDate: profile?.probationEndDate ?? null,
    annualPolicyDays,
    sickPolicyDays,
    thisYearAnnualHundredths: proratedAnnualHundredths(annualPolicyDays, startDate, leaveYear),
    annualAvailableHundredths: annualAvailableHundredths({
      annualEntitlementDays: annualPolicyDays,
      carryOverHundredths: carry,
      annualUsedHundredths: usedAnnual,
      startDate,
      leaveYear,
    }),
    sickAvailableHundredths: sickPolicyDays * 100 - usedSick,
    annualUsedHundredths: usedAnnual,
    sickUsedHundredths: usedSick,
    carryOverHundredths: carry,
    emergencyName: profile?.emergencyName ?? null,
    emergencyPhone: profile?.emergencyPhone ?? null,
    notes: includeNotes ? profile?.notes ?? null : null,
    missingStartDate: !startDate && row.status === 'active',
  }
}

export async function getOfficeDesk(user: OfficeViewer): Promise<OfficeDesk> {
  try {
    return await loadOfficeDesk(user)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/does not exist|failed query/i.test(message)) {
      return unavailableDesk(
        user,
        'Admin Office is waiting for a database update. Run pnpm db:migrate, then refresh.',
      )
    }
    throw error
  }
}

async function loadOfficeDesk(user: OfficeViewer): Promise<OfficeDesk> {
  const today = nairobiToday()
  const year = Number(today.slice(0, 4))
  const runsOffice = canRunAdminOffice(user)
  await ensureOfficeRecords(user.companyId, year)
  const db = getDb()

  const [peopleRows, requestRows, offerRows, documentRows, ackRows, vendorRows, assetRows, complianceRows, departmentRows] =
    await Promise.all([
      db.query.users.findMany({
        where: eq(users.companyId, user.companyId),
        with: { department: true, manager: true, staffProfile: true },
        orderBy: [asc(users.firstName), asc(users.lastName)],
      }),
      db.query.adminRequests.findMany({
        where: eq(adminRequests.companyId, user.companyId),
        with: {
          requestor: { with: { department: true } },
          reviewer: true,
          coverageUser: true,
        },
        orderBy: [asc(adminRequests.createdAt)],
      }),
      runsOffice
        ? db.query.offerLetters.findMany({
            where: eq(offerLetters.companyId, user.companyId),
            with: { department: true },
            orderBy: [asc(offerLetters.createdAt)],
          })
        : Promise.resolve([]),
      db.query.officeDocuments.findMany({
        where: eq(officeDocuments.companyId, user.companyId),
        orderBy: [asc(officeDocuments.title)],
      }),
      db.select().from(documentAcknowledgements),
      runsOffice
        ? db.query.officeVendors.findMany({
            where: eq(officeVendors.companyId, user.companyId),
            with: { owner: true },
            orderBy: [asc(officeVendors.name)],
          })
        : Promise.resolve([]),
      runsOffice
        ? db.query.officeAssets.findMany({
            where: eq(officeAssets.companyId, user.companyId),
            with: { assignedUser: true },
            orderBy: [asc(officeAssets.name)],
          })
        : Promise.resolve([]),
      runsOffice
        ? db.query.officeCompliance.findMany({
            where: eq(officeCompliance.companyId, user.companyId),
            with: { owner: true },
            orderBy: [asc(officeCompliance.dueDate)],
          })
        : Promise.resolve([]),
      db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.companyId, user.companyId)),
    ])

  const people = peopleRows.map((row) => toPerson(row, year, runsOffice))
  const me = people.find((person) => person.id === user.id) ?? null
  const visiblePeople = runsOffice ? people : people.filter((person) => person.id === user.id)
  const activeStaff = people.filter((person) => person.status === 'active')

  const approvedLeave = requestRows.filter(
    (row) => row.kind === 'leave' && row.status === 'approved' && row.startDate && row.endDate,
  )

  const requests: OfficeRequest[] = requestRows
    .filter((row) => runsOffice || row.requestorId === user.id)
    .map((row) => {
      const conflicts =
        row.kind === 'leave' && row.startDate && row.endDate && (row.status === 'submitted' || row.status === 'in_review')
          ? approvedLeave
              .filter(
                (other) =>
                  other.requestorId !== row.requestorId &&
                  other.startDate &&
                  other.endDate &&
                  rangesOverlap(row.startDate!, row.endDate!, other.startDate, other.endDate),
              )
              .map((other) => personName(other.requestor.firstName, other.requestor.lastName))
          : []
      return {
        id: row.id,
        requestorId: row.requestorId,
        requestorName: personName(row.requestor.firstName, row.requestor.lastName),
        departmentName: row.requestor.department?.name ?? null,
        reviewerName: row.reviewer ? personName(row.reviewer.firstName, row.reviewer.lastName) : null,
        kind: row.kind as AdminRequestKind,
        status: row.status as AdminRequestStatus,
        title: row.title,
        description: row.description,
        leaveType: (row.leaveType as LeaveType | null) ?? null,
        startDate: row.startDate,
        endDate: row.endDate,
        daysHundredths: row.daysHundredths,
        amountKes: row.amountKes,
        copies: row.copies,
        confidential: row.confidential,
        letterType: (row.letterType as OfficeLetterType | null) ?? null,
        documentNumber: row.documentNumber,
        generatedHtml: row.generatedHtml,
        coverageName: row.coverageUser ? personName(row.coverageUser.firstName, row.coverageUser.lastName) : null,
        attachmentUrl: row.attachmentUrl,
        attachmentName: row.attachmentName,
        decisionReason: row.decisionReason,
        createdAt: row.createdAt.toISOString(),
        conflicts,
        certificateMissing: row.leaveType === 'sick' && row.daysHundredths > 200 && !row.attachmentUrl,
        needsMd: requestNeedsMd(row),
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const openStatuses = new Set(['submitted', 'in_review'])
  const horizon = addDaysIso(today, 45)
  const soon = addDaysIso(today, 60)
  const week = addDaysIso(today, 7)
  const probationHorizon = addDaysIso(today, 30)
  const renewalHorizon = addDaysIso(today, 45)

  const outNow = approvedLeave
    .filter((row) => row.endDate && row.startDate && row.endDate >= today && row.startDate <= horizon)
    .map((row) => ({
      requestId: row.id,
      userId: row.requestorId,
      name: personName(row.requestor.firstName, row.requestor.lastName),
      departmentName: row.requestor.department?.name ?? null,
      leaveType: (row.leaveType as LeaveType | null) ?? null,
      startDate: row.startDate!,
      endDate: row.endDate!,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))

  const documents = documentRows
    .filter((row) => runsOffice || row.status === 'published')
    .map((row) => {
      const acks = ackRows.filter((ack) => ack.documentId === row.id)
      return {
        id: row.id,
        title: row.title,
        category: row.category,
        status: row.status,
        body: row.body,
        fileUrl: row.fileUrl,
        documentNumber: row.documentNumber,
        effectiveDate: row.effectiveDate,
        reviewDate: row.reviewDate,
        ackCount: acks.length,
        acknowledged: acks.some((ack) => ack.userId === user.id),
        staffCount: activeStaff.length,
      }
    })

  const compliance = complianceRows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    dueDate: row.dueDate,
    cadence: row.cadence,
    status: complianceState(row.dueDate, row.status, today),
    notes: row.notes,
    ownerName: row.owner ? personName(row.owner.firstName, row.owner.lastName) : null,
  }))

  const vendors = vendorRows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    renewalDate: row.renewalDate,
    amountKes: row.amountKes,
    status: row.status,
    notes: row.notes,
    ownerName: row.owner ? personName(row.owner.firstName, row.owner.lastName) : null,
  }))

  const alerts = []
  const queue = requests.filter((row) => openStatuses.has(row.status))
  if (runsOffice && queue.length > 0) {
    alerts.push({
      id: 'queue',
      tone: 'attention' as const,
      title: `${queue.length} request${queue.length === 1 ? '' : 's'} waiting`,
      detail: 'Leave, letters, imprest, and print jobs that still need a decision.',
      desk: 'inbox',
    })
  }
  const withMd = queue.filter((row) => row.status === 'in_review')
  if (runsOffice && withMd.length > 0) {
    alerts.push({
      id: 'md',
      tone: 'attention' as const,
      title: `${withMd.length} with the managing director`,
      detail: 'Long leave, or spend of KES 10,000 and above.',
      desk: 'inbox',
    })
  }
  const missingStarts = visiblePeople.filter((person) => person.missingStartDate)
  if (runsOffice && missingStarts.length > 0) {
    alerts.push({
      id: 'starts',
      tone: 'calm' as const,
      title: `${missingStarts.length} people have no start date`,
      detail: 'Leave for this year stays at the full entitlement until a start date is saved.',
      desk: 'people',
    })
  }
  const ending = visiblePeople.filter((person) => person.endDate && person.endDate <= soon && person.status === 'active')
  if (runsOffice && ending.length > 0) {
    alerts.push({
      id: 'contracts',
      tone: 'attention' as const,
      title: `${ending.length} contract${ending.length === 1 ? '' : 's'} ending within 60 days`,
      detail: ending.map((person) => `${person.name} · ${person.endDate}`).join(', '),
      desk: 'people',
    })
  }
  const probation = visiblePeople.filter(
    (person) => person.probationEndDate && person.probationEndDate >= today && person.probationEndDate <= probationHorizon && person.status === 'active',
  )
  if (runsOffice && probation.length > 0) {
    alerts.push({
      id: 'probation',
      tone: 'calm' as const,
      title: `${probation.length} probation date${probation.length === 1 ? '' : 's'} this month`,
      detail: probation.map((person) => `${person.name} · ${person.probationEndDate}`).join(', '),
      desk: 'people',
    })
  }
  const renewing = vendors.filter((row) => row.status === 'active' && row.renewalDate && row.renewalDate <= renewalHorizon)
  if (renewing.length > 0) {
    alerts.push({
      id: 'vendors',
      tone: 'attention' as const,
      title: `${renewing.length} vendor renewal${renewing.length === 1 ? '' : 's'} in 45 days`,
      detail: renewing.map((row) => row.name).join(', '),
      desk: 'finance',
    })
  }
  const dueCompliance = compliance.filter((row) => row.status === 'due' || row.status === 'overdue')
  if (dueCompliance.length > 0) {
    alerts.push({
      id: 'compliance',
      tone: 'attention' as const,
      title: `${dueCompliance.length} statutory reminder${dueCompliance.length === 1 ? '' : 's'} due`,
      detail: dueCompliance.map((row) => row.title).join(', '),
      desk: 'compliance',
    })
  }
  const reviews = documents.filter((row) => row.reviewDate && row.reviewDate <= addDaysIso(today, 30) && row.status === 'published')
  if (runsOffice && reviews.length > 0) {
    alerts.push({
      id: 'reviews',
      tone: 'calm' as const,
      title: `${reviews.length} polic${reviews.length === 1 ? 'y' : 'ies'} due for review`,
      detail: reviews.map((row) => row.title).join(', '),
      desk: 'documents',
    })
  }
  const waitingOffers = offerRows.filter((row) => row.status === 'awaiting_md' || row.status === 'draft')
  if (runsOffice && waitingOffers.length > 0) {
    alerts.push({
      id: 'offers',
      tone: 'calm' as const,
      title: `${waitingOffers.length} offer${waitingOffers.length === 1 ? '' : 's'} not yet issued`,
      detail: 'Drafts stay here until the managing director issues them.',
      desk: 'offers',
    })
  }
  const outThisWeek = outNow.filter((row) => row.startDate <= week)
  if (outThisWeek.length > 0) {
    alerts.push({
      id: 'out',
      tone: 'calm' as const,
      title: `${outThisWeek.length} out this week`,
      detail: outThisWeek.map((row) => row.name).join(', '),
      desk: 'calendar',
    })
  }
  const unreadPolicies = documents.filter((row) => row.status === 'published' && !row.acknowledged)
  if (!runsOffice && unreadPolicies.length > 0) {
    alerts.push({
      id: 'acks',
      tone: 'attention' as const,
      title: `${unreadPolicies.length} polic${unreadPolicies.length === 1 ? 'y' : 'ies'} to acknowledge`,
      detail: unreadPolicies.map((row) => row.title).join(', '),
      desk: 'policies',
    })
  }

  const imprestOutstandingKes = requestRows
    .filter((row) => row.kind === 'imprest' && row.status === 'approved')
    .reduce((sum, row) => sum + row.amountKes, 0)

  const leaveLiabilityHundredths = activeStaff.reduce((sum, person) => sum + Math.max(0, person.annualAvailableHundredths), 0)

  return {
    ready: true,
    setupMessage: null,
    today,
    pendingCount: runsOffice ? queue.length : requests.filter((row) => row.requestorId === user.id && openStatuses.has(row.status)).length,
    minePending: requests.filter((row) => row.requestorId === user.id && openStatuses.has(row.status)).length,
    me,
    people: visiblePeople,
    requests,
    offers: offerRows.map((row) => ({
      id: row.id,
      candidateName: row.candidateName,
      candidateEmail: row.candidateEmail,
      jobTitle: row.jobTitle,
      salaryText: row.salaryText,
      startDate: row.startDate,
      probationMonths: row.probationMonths,
      status: row.status,
      documentNumber: row.documentNumber,
      bodyHtml: row.bodyHtml,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    })),
    documents,
    vendors,
    assets: assetRows.map((row) => ({
      id: row.id,
      name: row.name,
      assetTag: row.assetTag,
      status: row.status,
      notes: row.notes,
      assignedUserId: row.assignedUserId,
      assignedName: row.assignedUser ? personName(row.assignedUser.firstName, row.assignedUser.lastName) : null,
    })),
    compliance,
    holidays: yearHolidays(year),
    alerts,
    outNow,
    departments: departmentRows.sort((a, b) => a.name.localeCompare(b.name)),
    coverOptions: people
      .filter((person) => person.status === 'active')
      .map((person) => ({ id: person.id, name: person.name })),
    imprestOutstandingKes,
    leaveLiabilityHundredths,
  }
}
