import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  canAccessClientManagement,
  canManageClientBilling,
  canManageCurriculum,
  isManagement,
} from '@/lib/auth/permissions'
import { parseTags } from '@/lib/clients/parse'
import type {
  AcademyProgrammeRecord,
  ClientDesk,
  ClientKind,
  ClientLinkRelation,
  ClientLinkView,
  ClientRecord,
  ClientStatus,
} from '@/lib/clients/types'
import { getDb } from '@/lib/db'
import {
  academyProgrammeLeads,
  academyProgrammes,
  officeClientLinks,
  officeClients,
} from '@/lib/db/schema'
import type { CurrentUser } from '@/lib/types'

function asKind(value: string): ClientKind {
  if (value === 'organization' || value === 'student' || value === 'guardian') return value
  return 'individual'
}

function asStatus(value: string): ClientStatus {
  if (
    value === 'enquiry' ||
    value === 'registered' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'archived'
  ) {
    return value
  }
  return 'active'
}

function asRelation(value: string): ClientLinkRelation {
  if (value === 'payer_for' || value === 'related_to') return value
  return 'guardian_of'
}

export async function listAcademyLeadProgrammeIds(userId: string, companyId: string) {
  const rows = await getDb()
    .select({
      programmeId: academyProgrammeLeads.programmeId,
      companyId: academyProgrammes.companyId,
    })
    .from(academyProgrammeLeads)
    .innerJoin(academyProgrammes, eq(academyProgrammeLeads.programmeId, academyProgrammes.id))
    .where(and(eq(academyProgrammeLeads.userId, userId), eq(academyProgrammes.companyId, companyId)))
  return rows.map((row) => row.programmeId)
}

export async function isAcademyProgrammeLead(user: CurrentUser) {
  const ids = await listAcademyLeadProgrammeIds(user.id, user.companyId)
  return ids.length > 0
}

export async function getClientDesk(user: CurrentUser): Promise<ClientDesk | null> {
  const leadProgrammeIds = await listAcademyLeadProgrammeIds(user.id, user.companyId)
  const academyLead = leadProgrammeIds.length > 0
  if (!canAccessClientManagement(user, academyLead)) return null

  const fullAccess = canManageClientBilling(user) || isManagement(user)

  const [programmeRows, clientRows, linkRows] = await Promise.all([
    getDb().query.academyProgrammes.findMany({
      where: eq(academyProgrammes.companyId, user.companyId),
      with: { leads: { with: { user: true } } },
      orderBy: [asc(academyProgrammes.sortOrder), asc(academyProgrammes.name)],
    }),
    getDb().query.officeClients.findMany({
      where: eq(officeClients.companyId, user.companyId),
      with: { programme: true },
      orderBy: [asc(officeClients.name)],
    }),
    getDb().query.officeClientLinks.findMany({
      where: eq(officeClientLinks.companyId, user.companyId),
      with: { fromClient: true, toClient: true },
    }),
  ])

  const clientById = new Map(clientRows.map((row) => [row.id, row]))
  const linksByClient = new Map<string, ClientLinkView[]>()

  for (const link of linkRows) {
    const relation = asRelation(link.relation)
    const fromView: ClientLinkView = {
      id: link.id,
      relation,
      otherId: link.toClientId,
      otherName: link.toClient?.name ?? 'Linked party',
      otherKind: asKind(link.toClient?.kind ?? 'individual'),
      direction: 'from',
    }
    const toView: ClientLinkView = {
      id: link.id,
      relation,
      otherId: link.fromClientId,
      otherName: link.fromClient?.name ?? 'Linked party',
      otherKind: asKind(link.fromClient?.kind ?? 'individual'),
      direction: 'to',
    }
    const fromList = linksByClient.get(link.fromClientId) ?? []
    fromList.push(fromView)
    linksByClient.set(link.fromClientId, fromList)
    const toList = linksByClient.get(link.toClientId) ?? []
    toList.push(toView)
    linksByClient.set(link.toClientId, toList)
  }

  const studentCounts = new Map<string, number>()
  for (const row of clientRows) {
    if (row.kind !== 'student' || !row.programmeId) continue
    studentCounts.set(row.programmeId, (studentCounts.get(row.programmeId) ?? 0) + 1)
  }

  const programmes: AcademyProgrammeRecord[] = programmeRows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    sortOrder: row.sortOrder,
    leadIds: row.leads.map((entry) => entry.userId),
    leadNames: row.leads.map((entry) => `${entry.user.firstName} ${entry.user.lastName}`),
    studentCount: studentCounts.get(row.id) ?? 0,
  }))

  const visibleClients = clientRows.filter((row) => {
    if (fullAccess) return true
    if (row.kind === 'student') {
      return Boolean(row.programmeId && leadProgrammeIds.includes(row.programmeId))
    }
    if (row.kind === 'guardian') {
      const links = linksByClient.get(row.id) ?? []
      return links.some((link) => {
        if (link.direction !== 'from') return false
        if (link.relation !== 'guardian_of' && link.relation !== 'payer_for') return false
        const student = clientById.get(link.otherId)
        return Boolean(student?.programmeId && leadProgrammeIds.includes(student.programmeId))
      })
    }
    // Academy leads do not see commercial org/individual directory by default.
    return false
  })

  const clients: ClientRecord[] = visibleClients.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    pin: row.pin,
    kind: asKind(row.kind),
    status: asStatus(row.status),
    tags: parseTags(row.tags),
    specification: row.specification,
    notes: row.notes,
    source: row.source,
    dateOfBirth: row.dateOfBirth,
    programmeId: row.programmeId,
    programmeName: row.programme?.name ?? null,
    selfPay: row.selfPay,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    links: linksByClient.get(row.id) ?? [],
  }))

  return {
    clients,
    programmes: fullAccess || canManageCurriculum(user) ? programmes : programmes.filter((p) => leadProgrammeIds.includes(p.id)),
    canManageCurriculum: canManageCurriculum(user),
    canManageBilling: canManageClientBilling(user),
    academyProgrammeIds: leadProgrammeIds,
  }
}

/** Prefer guardian/payer for students unless self-pay is enabled. */
export function resolveBillingParty(
  client: ClientRecord,
  all: ClientRecord[],
): { billTo: ClientRecord; note: string | null } {
  if (client.kind !== 'student' || client.selfPay) {
    return { billTo: client, note: null }
  }
  const payerLink = client.links.find(
    (link) =>
      link.direction === 'to' &&
      (link.relation === 'payer_for' || link.relation === 'guardian_of'),
  )
  const guardianLink = client.links.find(
    (link) => link.direction === 'to' && link.relation === 'guardian_of',
  )
  const chosen = payerLink ?? guardianLink
  if (!chosen) {
    return {
      billTo: client,
      note: 'No guardian or payer is linked yet. Link one, or mark this student as self-pay.',
    }
  }
  const party = all.find((entry) => entry.id === chosen.otherId)
  if (!party) {
    return { billTo: client, note: 'Linked payer could not be loaded.' }
  }
  return {
    billTo: party,
    note: `Billing ${party.name} for student ${client.name}.`,
  }
}

export async function getBillableClientsForInvoices(companyId: string) {
  const rows = await getDb().query.officeClients.findMany({
    where: eq(officeClients.companyId, companyId),
    orderBy: [asc(officeClients.name)],
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    pin: row.pin,
    kind: asKind(row.kind),
    status: asStatus(row.status),
    selfPay: row.selfPay,
  }))
}

export async function ensureProgrammeLeads(programmeId: string, leadIds: string[]) {
  const unique = [...new Set(leadIds.filter(Boolean))]
  await getDb().delete(academyProgrammeLeads).where(eq(academyProgrammeLeads.programmeId, programmeId))
  if (unique.length === 0) return
  await getDb().insert(academyProgrammeLeads).values(
    unique.map((userId) => ({
      programmeId,
      userId,
    })),
  )
}

export async function replaceClientLinks(input: {
  companyId: string
  fromClientId: string
  links: Array<{ toClientId: string; relation: ClientLinkRelation }>
}) {
  await getDb()
    .delete(officeClientLinks)
    .where(
      and(
        eq(officeClientLinks.companyId, input.companyId),
        eq(officeClientLinks.fromClientId, input.fromClientId),
      ),
    )
  const unique = new Map<string, { toClientId: string; relation: ClientLinkRelation }>()
  for (const link of input.links) {
    if (!link.toClientId || link.toClientId === input.fromClientId) continue
    unique.set(`${link.toClientId}:${link.relation}`, link)
  }
  const values = [...unique.values()]
  if (values.length === 0) return
  await getDb().insert(officeClientLinks).values(
    values.map((link) => ({
      companyId: input.companyId,
      fromClientId: input.fromClientId,
      toClientId: link.toClientId,
      relation: link.relation,
    })),
  )
}

export async function programmeExists(programmeId: string, companyId: string) {
  const [row] = await getDb()
    .select({ id: academyProgrammes.id })
    .from(academyProgrammes)
    .where(and(eq(academyProgrammes.id, programmeId), eq(academyProgrammes.companyId, companyId)))
    .limit(1)
  return Boolean(row)
}

export async function clientsExist(ids: string[], companyId: string) {
  if (ids.length === 0) return true
  const rows = await getDb()
    .select({ id: officeClients.id })
    .from(officeClients)
    .where(and(eq(officeClients.companyId, companyId), inArray(officeClients.id, ids)))
  return rows.length === ids.length
}
