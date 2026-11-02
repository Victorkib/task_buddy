'use server'

import { and, eq, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  canAccessClientManagement,
  resolveClientCapabilities,
} from '@/lib/auth/permissions'
import { isFamilyRelation, orientLink } from '@/lib/clients/family'
import {
  isClientKind,
  isClientLinkRelation,
  isClientStatus,
  parseTags,
  serializeTags,
} from '@/lib/clients/parse'
import { CLIENT_KIND_LABELS, type ClientKind, type ClientLinkRelation, type ClientRecord, type ClientStatus } from '@/lib/clients/types'
import { getDb } from '@/lib/db'
import {
  asKind,
  ensureProgrammeLeads,
  listAcademyLeadProgrammeIds,
  loadClientScope,
  programmeExists,
  toClientRecord,
} from '@/lib/db/clients'
import { getUserModuleGrant } from '@/lib/db/module-access'
import { getCurrentUser } from '@/lib/db/queries'
import { academyProgrammes, officeClientLinks, officeClients, users } from '@/lib/db/schema'

function refresh() {
  revalidatePath('/')
}

function field(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function cleanBlock(value: string, max: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function emailOrEmpty(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined
  return trimmed.slice(0, 200)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function clientsGate(options?: {
  curriculum?: boolean
  create?: boolean
  update?: boolean
  delete?: boolean
}) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { ok: false as const, error: 'Not signed in.' }
  const [leadProgrammeIds, grant] = await Promise.all([
    listAcademyLeadProgrammeIds(currentUser.id, currentUser.companyId),
    getUserModuleGrant(currentUser.companyId, currentUser.id, 'clients'),
  ])
  const academyLead = leadProgrammeIds.length > 0
  const accessCtx = { isAcademyLead: academyLead, grant }
  if (!canAccessClientManagement(currentUser, accessCtx)) {
    return { ok: false as const, error: 'You are not allowed to open client management.' }
  }
  const capabilities = resolveClientCapabilities(currentUser, accessCtx)
  if (options?.curriculum && !capabilities.canManageCurriculum) {
    return { ok: false as const, error: 'You are not allowed to change curriculum and programme leads.' }
  }
  if (options?.create && !capabilities.canCreate) {
    return { ok: false as const, error: 'You are not allowed to create client records.' }
  }
  if (options?.update && !capabilities.canUpdate) {
    return { ok: false as const, error: 'You are not allowed to edit client records.' }
  }
  if (options?.delete && !capabilities.canDelete) {
    return { ok: false as const, error: 'You are not allowed to remove client records.' }
  }
  return {
    ok: true as const,
    currentUser,
    academyLead,
    leadProgrammeIds,
    capabilities,
    fullAccess: capabilities.fullDirectory && !capabilities.academyScoped,
  }
}

type Gate = Extract<Awaited<ReturnType<typeof clientsGate>>, { ok: true }>

function defaultStatusForKind(kind: ClientKind): ClientStatus {
  if (kind === 'student') return 'enquiry'
  return 'active'
}

/** Whether this person may hold a record of this kind (and programme, for students). */
async function kindAllowed(gate: Gate, kind: ClientKind, programmeId: string | null) {
  if (programmeId) {
    const ok = await programmeExists(programmeId, gate.currentUser.companyId)
    if (!ok) return 'That programme is no longer available.'
  }
  if (kind === 'student' && !programmeId) return 'Assign the student to a programme.'
  if (!gate.fullAccess) {
    if ((kind === 'organization' || kind === 'individual') && !gate.capabilities.fullDirectory) {
      return 'You are not allowed to manage commercial clients. Ask leadership for directory access.'
    }
    if (gate.capabilities.academyScoped && kind === 'student' && programmeId && !gate.leadProgrammeIds.includes(programmeId)) {
      return 'You can only manage students on programmes you lead.'
    }
  }
  return null
}

function linkError(relation: ClientLinkRelation, a: { name: string; kind: ClientKind }, b: { name: string; kind: ClientKind }) {
  if (relation === 'guardian_of') {
    return `${a.name} (${CLIENT_KIND_LABELS[a.kind]}) and ${b.name} (${CLIENT_KIND_LABELS[b.kind]}) cannot be parent and child. A parent or guardian links to a student.`
  }
  if (relation === 'payer_for') {
    return `${a.name} and ${b.name} cannot be linked as fee payer and student. A fee payer links to a student.`
  }
  return `${a.name} cannot be linked to itself.`
}

function parsePendingLinks(raw: string) {
  if (!raw) return { links: [] as Array<{ otherId: string; relation: ClientLinkRelation }> }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'Check the linked people list.' as const }
  }
  if (!Array.isArray(parsed) || parsed.length > 30) return { error: 'Check the linked people list.' as const }
  const links: Array<{ otherId: string; relation: ClientLinkRelation }> = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const otherId = typeof row.otherId === 'string' && UUID.test(row.otherId) ? row.otherId : ''
    const relation = typeof row.relation === 'string' && isClientLinkRelation(row.relation) ? row.relation : null
    if (!otherId || !relation || seen.has(`${otherId}:${relation}`)) continue
    seen.add(`${otherId}:${relation}`)
    links.push({ otherId, relation })
  }
  return { links }
}

export async function saveClientRecord(formData: FormData) {
  const id = field(formData, 'id')
  const loaded = await clientsGate(id ? { update: true } : { create: true })
  if (!loaded.ok) return { error: loaded.error }
  const { currentUser, fullAccess, leadProgrammeIds, capabilities } = loaded

  const name = cleanBlock(field(formData, 'name'), 200)
  if (!name) return { error: 'Enter a name.' as const }
  const kindRaw = field(formData, 'kind')
  if (!isClientKind(kindRaw)) return { error: 'Choose a valid party type.' as const }
  const kind = kindRaw
  const statusRaw = field(formData, 'status') || defaultStatusForKind(kind)
  if (!isClientStatus(statusRaw)) return { error: 'Choose a valid status.' as const }
  const status = statusRaw
  const email = emailOrEmpty(field(formData, 'email'))
  if (email === undefined) return { error: 'Enter a real email, or leave it blank.' as const }

  const programmeId = field(formData, 'programmeId') || null
  const kindProblem = await kindAllowed(loaded, kind, kind === 'student' ? programmeId : null)
  if (kindProblem) return { error: kindProblem }

  const tags = parseTags(field(formData, 'tags'))
  // Two hats: tags carry secondary roles (e.g. consulting) without changing primary kind.
  const values = {
    name,
    email,
    phone: cleanBlock(field(formData, 'phone'), 40) || null,
    address: cleanBlock(field(formData, 'address'), 500) || null,
    pin: cleanBlock(field(formData, 'pin'), 40) || null,
    kind,
    status,
    tags: serializeTags(tags),
    specification: cleanBlock(field(formData, 'specification'), 2000) || null,
    notes: cleanBlock(field(formData, 'notes'), 2000) || null,
    source: cleanBlock(field(formData, 'source'), 120) || null,
    dateOfBirth: field(formData, 'dateOfBirth') || null,
    programmeId: kind === 'student' ? programmeId : null,
    selfPay: field(formData, 'selfPay') === 'yes',
    updatedAt: new Date(),
  }

  if (id) {
    const existing = await getDb().query.officeClients.findFirst({ where: eq(officeClients.id, id) })
    if (!existing || existing.companyId !== currentUser.companyId) {
      return { error: 'That record is no longer saved.' as const }
    }
    if (!fullAccess && capabilities.academyScoped) {
      if (existing.kind === 'student' && existing.programmeId && !leadProgrammeIds.includes(existing.programmeId)) {
        return { error: 'You can only edit students on programmes you lead.' as const }
      }
    }
    if (existing.kind !== kind) {
      // Changing type must not leave a parent/child link pointing the wrong way.
      const links = await getDb().query.officeClientLinks.findMany({
        where: and(
          eq(officeClientLinks.companyId, currentUser.companyId),
          or(eq(officeClientLinks.fromClientId, id), eq(officeClientLinks.toClientId, id)),
        ),
        with: { fromClient: true, toClient: true },
      })
      for (const link of links) {
        const relation = link.relation as ClientLinkRelation
        if (!isFamilyRelation(relation)) continue
        const mine = link.fromClientId === id ? 'from' : link.toClientId === id ? 'to' : null
        if (!mine) continue
        const other = mine === 'from' ? link.toClient : link.fromClient
        if (!other) continue
        const oriented = orientLink({ id, kind }, { id: other.id, kind: asKind(other.kind) }, relation)
        const stillRight = oriented && (mine === 'from' ? oriented.fromId === id : oriented.toId === id)
        if (!stillRight) {
          return {
            error: `Changing this record to ${CLIENT_KIND_LABELS[kind]} would break its link with ${other.name}. Remove that link first.`,
          }
        }
      }
    }
    // Links on a saved record are added and removed straight away from the Family panel.
    await getDb().update(officeClients).set(values).where(eq(officeClients.id, id))
    refresh()
    return { ok: true as const, id, links: [] as LinkRow[], notice: 'Record updated.' }
  }

  // A new record may carry links chosen before it was saved; check them all first.
  const pending = parsePendingLinks(field(formData, 'pendingLinksJson'))
  if ('error' in pending) return { error: pending.error }
  let planned: Array<{ fromId: string | null; toId: string | null; relation: ClientLinkRelation; otherId: string }> = []
  if (pending.links.length > 0) {
    const scope = await loadClientScope(currentUser)
    if (!scope) return { error: 'You are not allowed to open client management.' as const }
    planned = []
    for (const link of pending.links) {
      const other = scope.clientById.get(link.otherId)
      if (!other || !scope.visibleIds.has(other.id)) return { error: 'One of the linked people is no longer saved.' as const }
      const oriented = orientLink({ id: 'self', kind }, { id: other.id, kind: asKind(other.kind) }, link.relation)
      if (!oriented) return { error: linkError(link.relation, { name, kind }, { name: other.name, kind: asKind(other.kind) }) }
      planned.push({
        fromId: oriented.fromId === 'self' ? null : oriented.fromId,
        toId: oriented.toId === 'self' ? null : oriented.toId,
        relation: link.relation,
        otherId: other.id,
      })
    }
  }

  const [created] = await getDb()
    .insert(officeClients)
    .values({ companyId: currentUser.companyId, ...values })
    .returning({ id: officeClients.id })
  const clientId = created?.id ?? ''
  if (!clientId) return { error: 'The record could not be saved. Try again.' as const }

  let links: LinkRow[] = []
  if (planned.length > 0) {
    links = await getDb()
      .insert(officeClientLinks)
      .values(
        planned.map((link) => ({
          companyId: currentUser.companyId,
          fromClientId: link.fromId ?? clientId,
          toClientId: link.toId ?? clientId,
          relation: link.relation,
        })),
      )
      .onConflictDoNothing()
      .returning({
        id: officeClientLinks.id,
        fromId: officeClientLinks.fromClientId,
        toId: officeClientLinks.toClientId,
        relation: officeClientLinks.relation,
      })
  }

  refresh()
  return {
    ok: true as const,
    id: clientId,
    links,
    notice: planned.length
      ? `Record added with ${planned.length} link${planned.length === 1 ? '' : 's'}.`
      : 'Record added to the directory.',
  }
}

type LinkRow = { id: string; fromId: string; toId: string; relation: ClientLinkRelation }

/** Links two saved records from either side. Parents and payers are always stored as the "from" party. */
export async function linkClients(input: { anchorId: string; otherId: string; relation: string }) {
  const loaded = await clientsGate({ update: true })
  if (!loaded.ok) return { error: loaded.error }
  if (!isClientLinkRelation(input.relation)) return { error: 'Choose how these two are related.' }
  const relation = input.relation
  if (!UUID.test(input.anchorId) || !UUID.test(input.otherId)) return { error: 'Pick someone to link.' }
  if (input.anchorId === input.otherId) return { error: 'A record cannot be linked to itself.' }
  const scope = await loadClientScope(loaded.currentUser)
  if (!scope) return { error: 'You are not allowed to open client management.' }
  const anchor = scope.clientById.get(input.anchorId)
  const other = scope.clientById.get(input.otherId)
  if (!anchor || !other || !scope.visibleIds.has(anchor.id) || !scope.visibleIds.has(other.id)) {
    return { error: 'One of these records is no longer saved, or is outside what you can manage.' }
  }
  const a = { id: anchor.id, name: anchor.name, kind: asKind(anchor.kind) }
  const b = { id: other.id, name: other.name, kind: asKind(other.kind) }
  const oriented = orientLink(a, b, relation)
  if (!oriented) return { error: linkError(relation, a, b) }

  const [row] = await getDb()
    .insert(officeClientLinks)
    .values({
      companyId: loaded.currentUser.companyId,
      fromClientId: oriented.fromId,
      toClientId: oriented.toId,
      relation,
    })
    .onConflictDoNothing()
    .returning({
      id: officeClientLinks.id,
      fromId: officeClientLinks.fromClientId,
      toId: officeClientLinks.toClientId,
      relation: officeClientLinks.relation,
    })
  refresh()
  if (!row) return { ok: true as const, link: null, notice: `${other.name} was already linked.` }
  return { ok: true as const, link: row as LinkRow, notice: `Linked ${other.name}.` }
}

export async function unlinkClients(linkId: string) {
  const loaded = await clientsGate({ update: true })
  if (!loaded.ok) return { error: loaded.error }
  if (!UUID.test(linkId)) return { error: 'That link is no longer there.' }
  const link = await getDb().query.officeClientLinks.findFirst({ where: eq(officeClientLinks.id, linkId) })
  if (!link || link.companyId !== loaded.currentUser.companyId) return { error: 'That link is no longer there.' }
  const scope = await loadClientScope(loaded.currentUser)
  if (!scope || !scope.visibleIds.has(link.fromClientId) || !scope.visibleIds.has(link.toClientId)) {
    return { error: 'You can only remove links between records you manage.' }
  }
  await getDb().delete(officeClientLinks).where(eq(officeClientLinks.id, linkId))
  refresh()
  return { ok: true as const, notice: 'Link removed. Both records are still saved.' }
}

/**
 * Adds a parent, student, or sponsor from inside another record and links them in one step.
 * With no anchor (the record on screen is not saved yet) the person is created on their own,
 * and the link is made when that record is saved.
 */
export async function createLinkedClient(formData: FormData) {
  const anchorId = field(formData, 'anchorId')
  const loaded = await clientsGate(anchorId ? { create: true, update: true } : { create: true })
  if (!loaded.ok) return { error: loaded.error }
  const { currentUser } = loaded

  const relationRaw = field(formData, 'relation')
  if (!isClientLinkRelation(relationRaw)) return { error: 'Choose how this person is related.' }
  const relation = relationRaw
  const kindRaw = field(formData, 'kind')
  if (!isClientKind(kindRaw)) return { error: 'Choose a valid party type.' }
  const kind = kindRaw
  const name = cleanBlock(field(formData, 'name'), 200)
  if (!name) return { error: 'Enter a name.' }
  const email = emailOrEmpty(field(formData, 'email'))
  if (email === undefined) return { error: 'Enter a real email, or leave it blank.' }
  const programmeId = kind === 'student' ? field(formData, 'programmeId') || null : null
  const kindProblem = await kindAllowed(loaded, kind, programmeId)
  if (kindProblem) return { error: kindProblem }
  const dateOfBirth = kind === 'student' ? field(formData, 'dateOfBirth') || null : null
  if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return { error: 'Enter a real date of birth, or leave it blank.' }

  let anchor: { id: string; name: string; kind: ClientKind } | null = null
  let oriented: { fromId: string; toId: string } | null = null
  if (anchorId) {
    if (!UUID.test(anchorId)) return { error: 'Save the record you are on, then add people to it.' }
    const scope = await loadClientScope(currentUser)
    const row = scope?.clientById.get(anchorId)
    if (!scope || !row || !scope.visibleIds.has(anchorId)) return { error: 'That record is no longer saved.' }
    anchor = { id: row.id, name: row.name, kind: asKind(row.kind) }
    oriented = orientLink(anchor, { id: 'new', kind }, relation)
    if (!oriented) return { error: linkError(relation, anchor, { name, kind }) }
  } else {
    // Check the pairing now so the person is not created for a link that can never be made.
    const anchorKind = field(formData, 'anchorKind')
    if (isClientKind(anchorKind) && !orientLink({ id: 'self', kind: anchorKind }, { id: 'new', kind }, relation)) {
      return { error: linkError(relation, { name: field(formData, 'anchorName') || 'This record', kind: anchorKind }, { name, kind }) }
    }
  }

  const [created] = await getDb()
    .insert(officeClients)
    .values({
      companyId: currentUser.companyId,
      name,
      email,
      phone: cleanBlock(field(formData, 'phone'), 40) || null,
      kind,
      status: defaultStatusForKind(kind),
      tags: serializeTags([]),
      programmeId,
      dateOfBirth,
      selfPay: kind === 'student' && field(formData, 'selfPay') === 'yes',
      source: anchor ? `Added from ${anchor.name}` : null,
    })
    .returning()
  if (!created) return { error: 'The record could not be saved. Try again.' }

  let link: LinkRow | null = null
  if (anchor && oriented) {
    try {
      const [row] = await getDb()
        .insert(officeClientLinks)
        .values({
          companyId: currentUser.companyId,
          fromClientId: oriented.fromId === 'new' ? created.id : oriented.fromId,
          toClientId: oriented.toId === 'new' ? created.id : oriented.toId,
          relation,
        })
        .returning({
          id: officeClientLinks.id,
          fromId: officeClientLinks.fromClientId,
          toId: officeClientLinks.toClientId,
          relation: officeClientLinks.relation,
        })
      link = (row as LinkRow | undefined) ?? null
    } catch {
      // Never leave a half-made person behind if the link could not be saved.
      await getDb().delete(officeClients).where(eq(officeClients.id, created.id))
      return { error: 'The link could not be saved, so nothing was added. Try again.' }
    }
  }

  let programmeName: string | null = null
  if (programmeId) {
    const programme = await getDb().query.academyProgrammes.findFirst({ where: eq(academyProgrammes.id, programmeId) })
    programmeName = programme?.name ?? null
  }
  const record: ClientRecord = toClientRecord({ ...created, programme: programmeName ? { name: programmeName } : null }, [])

  refresh()
  return {
    ok: true as const,
    record,
    link,
    notice: anchor ? `${name} added and linked to ${anchor.name}.` : `${name} added. The link is made when you save this record.`,
  }
}

export async function deleteClientRecord(id: string) {
  const loaded = await clientsGate({ delete: true })
  if (!loaded.ok) return { error: loaded.error }
  const { currentUser, fullAccess, leadProgrammeIds, capabilities } = loaded
  const existing = await getDb().query.officeClients.findFirst({ where: eq(officeClients.id, id) })
  if (!existing || existing.companyId !== currentUser.companyId) {
    return { error: 'That record is no longer saved.' as const }
  }
  if (!fullAccess && capabilities.academyScoped) {
    if (existing.kind !== 'student' && existing.kind !== 'guardian' && !capabilities.fullDirectory) {
      return { error: 'You can only remove academy students or guardians.' as const }
    }
    if (existing.kind === 'student' && existing.programmeId && !leadProgrammeIds.includes(existing.programmeId)) {
      return { error: 'You can only remove students on programmes you lead.' as const }
    }
  }
  await getDb().delete(officeClients).where(eq(officeClients.id, id))
  refresh()
  return { ok: true as const, notice: 'Record removed. Past invoices keep the bill-to name they were saved with.' }
}

export async function saveAcademyProgramme(formData: FormData) {
  const loaded = await clientsGate({ curriculum: true })
  if (!loaded.ok) return { error: loaded.error }
  const { currentUser } = loaded
  const name = cleanBlock(field(formData, 'name'), 160)
  if (!name) return { error: 'Give the programme a name.' as const }
  const description = cleanBlock(field(formData, 'description'), 1000) || null
  const active = field(formData, 'active') !== 'no'
  const sortOrder = Number(field(formData, 'sortOrder') || '0')
  const leadIds = formData
    .getAll('leadId')
    .filter((value): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value))

  if (leadIds.length > 0) {
    const people = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, currentUser.companyId)))
    const allowed = new Set(people.map((row) => row.id))
    if (leadIds.some((id) => !allowed.has(id))) {
      return { error: 'One of the assigned leads is not in this workspace.' as const }
    }
  }

  const id = field(formData, 'id')
  let programmeId = id
  if (id) {
    const existing = await getDb().query.academyProgrammes.findFirst({ where: eq(academyProgrammes.id, id) })
    if (!existing || existing.companyId !== currentUser.companyId) {
      return { error: 'That programme is no longer there.' as const }
    }
    await getDb()
      .update(academyProgrammes)
      .set({
        name,
        description,
        active,
        sortOrder: Number.isFinite(sortOrder) ? Math.round(sortOrder) : 0,
        updatedAt: new Date(),
      })
      .where(eq(academyProgrammes.id, id))
  } else {
    const [created] = await getDb()
      .insert(academyProgrammes)
      .values({
        companyId: currentUser.companyId,
        name,
        description,
        active,
        sortOrder: Number.isFinite(sortOrder) ? Math.round(sortOrder) : 0,
      })
      .returning({ id: academyProgrammes.id })
    programmeId = created?.id ?? ''
  }

  if (programmeId) await ensureProgrammeLeads(programmeId, leadIds)
  refresh()
  return { ok: true as const, id: programmeId, notice: id ? 'Programme updated.' : 'Programme added.' }
}

export async function deleteAcademyProgramme(id: string) {
  const loaded = await clientsGate({ curriculum: true })
  if (!loaded.ok) return { error: loaded.error }
  const existing = await getDb().query.academyProgrammes.findFirst({ where: eq(academyProgrammes.id, id) })
  if (!existing || existing.companyId !== loaded.currentUser.companyId) {
    return { error: 'That programme is no longer there.' as const }
  }
  await getDb().delete(academyProgrammes).where(eq(academyProgrammes.id, id))
  refresh()
  return { ok: true as const, notice: 'Programme removed. Students on it keep their records and lose the programme link.' }
}
