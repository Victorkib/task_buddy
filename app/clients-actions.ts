'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import {
  canAccessClientManagement,
  resolveClientCapabilities,
} from '@/lib/auth/permissions'
import {
  isClientKind,
  isClientLinkRelation,
  isClientStatus,
  parseTags,
  serializeTags,
} from '@/lib/clients/parse'
import type { ClientKind, ClientLinkRelation, ClientStatus } from '@/lib/clients/types'
import { getDb } from '@/lib/db'
import {
  clientsExist,
  ensureProgrammeLeads,
  listAcademyLeadProgrammeIds,
  programmeExists,
  replaceClientLinks,
} from '@/lib/db/clients'
import { getUserModuleGrant } from '@/lib/db/module-access'
import { getCurrentUser } from '@/lib/db/queries'
import { academyProgrammes, officeClients, users } from '@/lib/db/schema'

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

function defaultStatusForKind(kind: ClientKind): ClientStatus {
  if (kind === 'student') return 'enquiry'
  return 'active'
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
  if (programmeId) {
    const ok = await programmeExists(programmeId, currentUser.companyId)
    if (!ok) return { error: 'That programme is no longer available.' as const }
  }

  if (kind === 'student' && !programmeId) {
    return { error: 'Assign the student to a programme.' as const }
  }

  if (!fullAccess) {
    if ((kind === 'organization' || kind === 'individual') && !capabilities.fullDirectory) {
      return { error: 'You are not allowed to manage commercial clients. Ask leadership for directory access.' as const }
    }
    if (capabilities.academyScoped && kind === 'student' && programmeId && !leadProgrammeIds.includes(programmeId)) {
      return { error: 'You can only manage students on programmes you lead.' as const }
    }
  }

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

  let clientId = id
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
    await getDb().update(officeClients).set(values).where(eq(officeClients.id, id))
  } else {
    const [created] = await getDb()
      .insert(officeClients)
      .values({ companyId: currentUser.companyId, ...values })
      .returning({ id: officeClients.id })
    clientId = created?.id ?? ''
  }

  const linkRaw = field(formData, 'linksJson')
  if (linkRaw && clientId) {
    let parsed: unknown
    try {
      parsed = JSON.parse(linkRaw)
    } catch {
      return { error: 'Check the linked people list.' as const }
    }
    if (!Array.isArray(parsed)) return { error: 'Check the linked people list.' as const }
    const links: Array<{ toClientId: string; relation: ClientLinkRelation }> = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const toClientId = typeof row.toClientId === 'string' ? row.toClientId : ''
      const relation = typeof row.relation === 'string' && isClientLinkRelation(row.relation) ? row.relation : null
      if (!toClientId || !relation) continue
      links.push({ toClientId, relation })
    }
    const ok = await clientsExist(
      links.map((link) => link.toClientId),
      currentUser.companyId,
    )
    if (!ok) return { error: 'One of the linked people is no longer saved.' as const }
    await replaceClientLinks({
      companyId: currentUser.companyId,
      fromClientId: clientId,
      links,
    })
  }

  refresh()
  return { ok: true as const, id: clientId, notice: id ? 'Record updated.' : 'Record added to the directory.' }
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
