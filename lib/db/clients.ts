import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { parsePaymentSnapshot } from '@/lib/admin-office/invoices'
import { nairobiToday } from '@/lib/admin-office/leave'
import {
  canAccessClientManagement,
  canManageClientBilling,
  canRunAdminOffice,
  resolveClientCapabilities,
} from '@/lib/auth/permissions'
import { isFamilyRelation } from '@/lib/clients/family'
import { getUserModuleGrant } from '@/lib/db/module-access'
import { normalizeClientStatus, parseTags } from '@/lib/clients/parse'
import type {
  AcademyProgrammeRecord,
  ClientBilling,
  ClientDesk,
  ClientInvoiceStatus,
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
  officeInvoiceSettings,
  officeInvoices,
  officePaymentAccounts,
} from '@/lib/db/schema'
import { isMailConfigured } from '@/lib/mail/send'
import type { CurrentUser } from '@/lib/types'

export function asKind(value: string): ClientKind {
  if (value === 'organization' || value === 'student' || value === 'guardian') return value
  return 'individual'
}

function asStatus(value: string): ClientStatus {
  return normalizeClientStatus(value) ?? 'active'
}

export function asRelation(value: string): ClientLinkRelation {
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

type ClientRow = typeof officeClients.$inferSelect & { programme: { name: string } | null }

export type ClientScope = NonNullable<Awaited<ReturnType<typeof loadClientScope>>>

type ClientAccess = NonNullable<Awaited<ReturnType<typeof resolveClientAccess>>>

/** Whether this person may open Clients at all, and with what rights. */
async function resolveClientAccess(user: CurrentUser) {
  const [leadProgrammeIds, clientsGrant] = await Promise.all([
    listAcademyLeadProgrammeIds(user.id, user.companyId),
    getUserModuleGrant(user.companyId, user.id, 'clients'),
  ])
  const academyLead = leadProgrammeIds.length > 0
  const accessCtx = { isAcademyLead: academyLead, grant: clientsGrant }
  if (!canAccessClientManagement(user, accessCtx)) return null
  const capabilities = resolveClientCapabilities(user, accessCtx)
  return {
    capabilities,
    fullAccess: capabilities.fullDirectory && !capabilities.academyScoped,
    academyLead,
    leadProgrammeIds,
  }
}

/**
 * Everything a person may see in the Clients portal, worked out once so the desk and
 * every server action apply the same visibility rules.
 */
export async function loadClientScope(user: CurrentUser) {
  const access = await resolveClientAccess(user)
  return access ? buildClientScope(user, access) : null
}

async function buildClientScope(user: CurrentUser, access: ClientAccess) {
  const { capabilities, fullAccess, academyLead, leadProgrammeIds } = access

  const [clientRows, linkRows] = await Promise.all([
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

  const clientById = new Map<string, ClientRow>(clientRows.map((row) => [row.id, row]))
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

  const ledStudent = (id: string) => {
    const student = clientById.get(id)
    return Boolean(student && student.kind === 'student' && student.programmeId && leadProgrammeIds.includes(student.programmeId))
  }

  const visibleRows = clientRows.filter((row) => {
    if (fullAccess) return true
    if (capabilities.academyScoped) {
      if (row.kind === 'student') {
        return Boolean(row.programmeId && leadProgrammeIds.includes(row.programmeId))
      }
      if (row.kind === 'guardian') {
        // Kind decides who is the parent, whichever record the link was made from.
        const children = (linksByClient.get(row.id) ?? []).filter(
          (link) => isFamilyRelation(link.relation) && clientById.get(link.otherId)?.kind === 'student',
        )
        // A parent added before their child stays in view so the child can be linked next.
        return children.length === 0 || children.some((link) => ledStudent(link.otherId))
      }
      // Granted fullDirectory on top of academy lead → also see commercial parties.
      return capabilities.fullDirectory && (row.kind === 'organization' || row.kind === 'individual')
    }
    // Settings grant only (not academy-scoped): full directory of all kinds they can view.
    return capabilities.fullDirectory
  })

  const visibleIds = new Set(visibleRows.map((row) => row.id))

  return {
    capabilities,
    fullAccess,
    academyLead,
    leadProgrammeIds,
    clientById,
    linksByClient,
    visibleRows,
    visibleIds,
  }
}

export function toClientRecord(row: ClientRow, links: ClientLinkView[]): ClientRecord {
  return {
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
    links,
  }
}

/** Whether an invoice bills, or was raised for, someone this person can see. */
export function invoiceInvolves(
  invoice: { clientId: string | null; lines: { subjectClientId: string | null }[] },
  visibleIds: Set<string>,
) {
  if (invoice.clientId && visibleIds.has(invoice.clientId)) return true
  return invoice.lines.some((line) => line.subjectClientId != null && visibleIds.has(line.subjectClientId))
}

function asInvoiceStatus(value: string): ClientInvoiceStatus {
  return value === 'sent' || value === 'paid' || value === 'void' ? value : 'draft'
}

/** Runs alongside the directory load; `visible` resolves once it is known who this person can see. */
async function loadClientBilling(user: CurrentUser, visible: Promise<Set<string>>): Promise<ClientBilling> {
  const canIssue = canRunAdminOffice(user)
  const base: ClientBilling = {
    ready: true,
    setupMessage: null,
    today: nairobiToday(),
    canIssue,
    currentUserId: user.id,
    mailReady: canIssue && isMailConfigured(),
    invoiceSettings: { vatEnabled: true, vatRateBps: 1600, companyPin: null },
    paymentAccounts: [],
    invoices: [],
  }
  try {
    const db = getDb()
    const [settings, accountRows, invoiceRows] = await Promise.all([
      db.query.officeInvoiceSettings.findFirst({ where: eq(officeInvoiceSettings.companyId, user.companyId) }),
      db.query.officePaymentAccounts.findMany({
        where: eq(officePaymentAccounts.companyId, user.companyId),
        orderBy: [asc(officePaymentAccounts.sortOrder), asc(officePaymentAccounts.createdAt)],
      }),
      db.query.officeInvoices.findMany({
        where: eq(officeInvoices.companyId, user.companyId),
        with: { lines: true },
        orderBy: [desc(officeInvoices.createdAt)],
      }),
    ])
    const visibleIds = await visible
    return {
      ...base,
      invoiceSettings: {
        vatEnabled: settings?.vatEnabled ?? true,
        vatRateBps: settings?.vatRateBps ?? 1600,
        companyPin: settings?.companyPin ?? null,
      },
      paymentAccounts: accountRows.map((row) => ({
        id: row.id,
        label: row.label,
        kind: row.kind === 'bank' || row.kind === 'paybill' || row.kind === 'other' ? row.kind : 'other',
        details: row.details,
        active: row.active,
      })),
      invoices: invoiceRows
        .filter((row) => invoiceInvolves(row, visibleIds))
        .map((row) => ({
          id: row.id,
          documentNumber: row.documentNumber,
          status: asInvoiceStatus(row.status),
          issueDate: row.issueDate,
          dueDate: row.dueDate,
          clientId: row.clientId,
          clientName: row.clientName,
          clientEmail: row.clientEmail,
          clientPhone: row.clientPhone,
          clientAddress: row.clientAddress,
          clientPin: row.clientPin,
          vatEnabled: row.vatEnabled,
          vatRateBps: row.vatRateBps,
          companyPin: row.companyPin,
          paymentIds: parsePaymentSnapshot(row.paymentSnapshot).map((payment) => payment.id),
          notes: row.notes,
          createdById: row.createdById,
          lines: [...row.lines]
            .sort((a, b) => a.position - b.position)
            .map((line) => ({
              id: line.id,
              description: line.description,
              quantityHundredths: line.quantityHundredths,
              rateCents: line.rateCents,
              subjectClientId: line.subjectClientId,
            })),
        })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/does not exist|failed query/i.test(message)) {
      return {
        ...base,
        ready: false,
        setupMessage: 'Invoicing from Clients is waiting for a database update. Run pnpm db:migrate, then refresh.',
      }
    }
    throw error
  }
}

export async function getClientDesk(user: CurrentUser): Promise<ClientDesk | null> {
  const access = await resolveClientAccess(user)
  if (!access) return null
  const canInvoice = canRunAdminOffice(user) || access.capabilities.canCreate

  // Directory, programmes, and billing load together rather than one after another.
  const scopeLoad = buildClientScope(user, access)
  const [scope, programmeRows, billing] = await Promise.all([
    scopeLoad,
    getDb().query.academyProgrammes.findMany({
      where: eq(academyProgrammes.companyId, user.companyId),
      with: { leads: { with: { user: true } } },
      orderBy: [asc(academyProgrammes.sortOrder), asc(academyProgrammes.name)],
    }),
    canInvoice ? loadClientBilling(user, scopeLoad.then((loaded) => loaded.visibleIds)) : Promise.resolve(null),
  ])
  const { capabilities, fullAccess, leadProgrammeIds, linksByClient, visibleRows, visibleIds } = scope

  const studentCounts = new Map<string, number>()
  for (const row of scope.clientById.values()) {
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

  // Only links between people this viewer can see; hidden parties never show through a link.
  const clients: ClientRecord[] = visibleRows.map((row) =>
    toClientRecord(
      row,
      (linksByClient.get(row.id) ?? []).filter((link) => visibleIds.has(link.otherId)),
    ),
  )

  return {
    clients,
    programmes:
      fullAccess || capabilities.canManageCurriculum
        ? programmes
        : programmes.filter((p) => leadProgrammeIds.includes(p.id)),
    canManageCurriculum: capabilities.canManageCurriculum,
    canManageBilling: canManageClientBilling(user),
    academyProgrammeIds: leadProgrammeIds,
    capabilities: {
      canView: capabilities.canView,
      canCreate: capabilities.canCreate,
      canUpdate: capabilities.canUpdate,
      canDelete: capabilities.canDelete,
      canManageCurriculum: capabilities.canManageCurriculum,
      fullDirectory: capabilities.fullDirectory,
      academyScoped: capabilities.academyScoped,
    },
    billing,
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
