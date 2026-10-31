import { and, eq, ilike } from 'drizzle-orm'
import { normalizeClientStatus, serializeTags } from '@/lib/clients/parse'
import type { ClientStatus } from '@/lib/clients/types'
import { getDb } from '@/lib/db'
import { academyProgrammes, officeClientLinks, officeClients } from '@/lib/db/schema'

export type IngestPerson = {
  externalId?: string | null
  name: string
  email?: string | null
  phone?: string | null
  age?: number | string | null
  grade?: string | null
  school?: string | null
  programme?: string | null
  courses?: string | null
  status?: string | null
  selfPay?: boolean | null
  specification?: string | null
  notes?: string | null
  tags?: string[] | null
}

export type IngestTraining = {
  frequency?: string | null
  startDate?: string | null
  endDate?: string | null
  mode?: string | null
  location?: string | null
  additionalNeeds?: string | null
}

export type StudentsIngestPayload = {
  externalId: string
  submittedAt?: string | null
  formEmail?: string | null
  completedBy?: 'parent' | 'student' | string | null
  consent?: boolean | null
  guardian?: IngestPerson | null
  learners: IngestPerson[]
  training?: IngestTraining | null
  source?: string | null
}

function clean(value: unknown, max: number) {
  if (value == null) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.slice(0, max)
}

function cleanEmail(value: unknown) {
  const text = clean(value, 200)
  if (!text) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null
  return text.toLowerCase()
}

function cleanPhone(value: unknown) {
  const text = clean(value, 40)
  if (!text) return null
  return text.replace(/\s+/g, '')
}

function normalizeExternalId(value: string) {
  return value.trim().slice(0, 190)
}

function buildLearnerSpec(person: IngestPerson, training?: IngestTraining | null) {
  const bits = [
    person.age != null && String(person.age).trim() ? `Age: ${String(person.age).trim()}` : null,
    clean(person.grade, 120) ? `Grade/level: ${clean(person.grade, 120)}` : null,
    clean(person.school, 200) ? `School: ${clean(person.school, 200)}` : null,
    clean(person.courses, 400) ? `Courses: ${clean(person.courses, 400)}` : null,
    clean(person.specification, 800),
    training?.frequency ? `Frequency: ${clean(training.frequency, 80)}` : null,
    training?.startDate ? `Start: ${clean(training.startDate, 40)}` : null,
    training?.endDate ? `End: ${clean(training.endDate, 40)}` : null,
    training?.mode ? `Mode: ${clean(training.mode, 80)}` : null,
    training?.location ? `Location: ${clean(training.location, 120)}` : null,
    training?.additionalNeeds ? `Needs: ${clean(training.additionalNeeds, 500)}` : null,
  ].filter(Boolean)
  return bits.join('\n') || null
}

async function ensureProgramme(companyId: string, name: string | null | undefined) {
  const programmeName = clean(name, 160)
  if (!programmeName) return null
  const existing = await getDb().query.academyProgrammes.findFirst({
    where: and(eq(academyProgrammes.companyId, companyId), ilike(academyProgrammes.name, programmeName)),
  })
  if (existing) return existing.id
  const [created] = await getDb()
    .insert(academyProgrammes)
    .values({
      companyId,
      name: programmeName,
      description: 'Created from Google Form / n8n ingest',
      active: true,
      sortOrder: 100,
    })
    .returning({ id: academyProgrammes.id })
  return created?.id ?? null
}

async function findByExternalId(companyId: string, externalId: string) {
  const [row] = await getDb()
    .select()
    .from(officeClients)
    .where(and(eq(officeClients.companyId, companyId), eq(officeClients.externalId, externalId)))
    .limit(1)
  return row ?? null
}

async function upsertParty(input: {
  companyId: string
  kind: 'student' | 'guardian'
  externalId: string
  name: string
  email: string | null
  phone: string | null
  // null keeps the stored status on re-submission so manual progress (e.g. enrolled) is not reset.
  status: ClientStatus | null
  defaultStatus: ClientStatus
  programmeId: string | null
  selfPay: boolean
  specification: string | null
  notes: string | null
  tags: string[]
  source: string
}) {
  const existing = await findByExternalId(input.companyId, input.externalId)
  const values = {
    name: input.name,
    email: input.email,
    phone: input.phone,
    kind: input.kind,
    status: input.status ?? existing?.status ?? input.defaultStatus,
    programmeId: input.kind === 'student' ? input.programmeId : null,
    selfPay: input.selfPay,
    specification: input.specification,
    notes: input.notes,
    tags: serializeTags(input.tags),
    source: input.source.slice(0, 120),
    externalId: input.externalId,
    updatedAt: new Date(),
  }
  if (existing) {
    await getDb().update(officeClients).set(values).where(eq(officeClients.id, existing.id))
    return { id: existing.id, created: false as const }
  }
  const [created] = await getDb()
    .insert(officeClients)
    .values({ companyId: input.companyId, ...values })
    .returning({ id: officeClients.id })
  return { id: created!.id, created: true as const }
}

async function ensureLink(companyId: string, fromId: string, toId: string, relation: 'guardian_of' | 'payer_for') {
  const [existing] = await getDb()
    .select({ id: officeClientLinks.id })
    .from(officeClientLinks)
    .where(
      and(
        eq(officeClientLinks.companyId, companyId),
        eq(officeClientLinks.fromClientId, fromId),
        eq(officeClientLinks.toClientId, toId),
        eq(officeClientLinks.relation, relation),
      ),
    )
    .limit(1)
  if (existing) return
  await getDb().insert(officeClientLinks).values({
    companyId,
    fromClientId: fromId,
    toClientId: toId,
    relation,
  })
}

function primaryProgrammeName(person: IngestPerson) {
  const fromProgramme = clean(person.programme, 160)
  if (fromProgramme) return fromProgramme.split(',')[0]?.trim() || fromProgramme
  const fromCourses = clean(person.courses, 400)
  if (fromCourses) return fromCourses.split(',')[0]?.trim() || fromCourses
  return null
}

export function parseStudentsIngestPayload(body: unknown): { error: string } | { payload: StudentsIngestPayload } {
  if (!body || typeof body !== 'object') return { error: 'Expected a JSON object.' }
  const raw = body as Record<string, unknown>
  const externalId = clean(raw.externalId, 190)
  if (!externalId) return { error: 'externalId is required (use sheet row id or timestamp key).' }

  const learnersRaw = Array.isArray(raw.learners) ? raw.learners : []
  if (learnersRaw.length === 0) return { error: 'Provide at least one learner in learners[].' }
  if (learnersRaw.length > 8) return { error: 'At most 8 learners per submission.' }

  const learners: IngestPerson[] = []
  for (const item of learnersRaw) {
    if (!item || typeof item !== 'object') return { error: 'Each learner must be an object.' }
    const row = item as Record<string, unknown>
    const name = clean(row.name, 200)
    if (!name) return { error: 'Each learner needs a name.' }
    learners.push({
      externalId: clean(row.externalId, 190),
      name,
      email: cleanEmail(row.email),
      phone: cleanPhone(row.phone),
      age: row.age as string | number | null,
      grade: clean(row.grade, 120),
      school: clean(row.school, 200),
      programme: clean(row.programme, 160),
      courses: clean(row.courses, 400),
      status: clean(row.status, 40),
      selfPay: row.selfPay === true,
      specification: clean(row.specification, 2000),
      notes: clean(row.notes, 2000),
      tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : null,
    })
  }

  let guardian: IngestPerson | null = null
  if (raw.guardian && typeof raw.guardian === 'object') {
    const g = raw.guardian as Record<string, unknown>
    const name = clean(g.name, 200)
    if (name) {
      guardian = {
        externalId: clean(g.externalId, 190),
        name,
        email: cleanEmail(g.email),
        phone: cleanPhone(g.phone),
        notes: clean(g.notes, 2000),
        tags: Array.isArray(g.tags) ? g.tags.filter((t): t is string => typeof t === 'string') : null,
      }
    }
  }

  const training =
    raw.training && typeof raw.training === 'object'
      ? {
          frequency: clean((raw.training as Record<string, unknown>).frequency, 80),
          startDate: clean((raw.training as Record<string, unknown>).startDate, 40),
          endDate: clean((raw.training as Record<string, unknown>).endDate, 40),
          mode: clean((raw.training as Record<string, unknown>).mode, 80),
          location: clean((raw.training as Record<string, unknown>).location, 120),
          additionalNeeds: clean((raw.training as Record<string, unknown>).additionalNeeds, 500),
        }
      : null

  return {
    payload: {
      externalId,
      submittedAt: clean(raw.submittedAt, 80),
      formEmail: cleanEmail(raw.formEmail),
      completedBy: clean(raw.completedBy, 40),
      consent: raw.consent === true || raw.consent === false ? raw.consent : null,
      guardian,
      learners,
      training,
      source: clean(raw.source, 80) || 'google_sheet',
    },
  }
}

export async function ingestStudentsRegistration(companyId: string, payload: StudentsIngestPayload) {
  const source = payload.source || 'google_sheet'
  const baseExternal = normalizeExternalId(payload.externalId)
  const results: Array<{
    learnerExternalId: string
    studentId: string
    guardianId: string | null
    programmeId: string | null
    created: boolean
    updated: boolean
  }> = []

  let guardianId: string | null = null
  if (payload.guardian?.name) {
    const guardianExternal = normalizeExternalId(
      payload.guardian.externalId || `${baseExternal}:guardian`,
    )
    const upserted = await upsertParty({
      companyId,
      kind: 'guardian',
      externalId: guardianExternal,
      name: payload.guardian.name,
      email: payload.guardian.email ?? payload.formEmail ?? null,
      phone: payload.guardian.phone ?? null,
      status: null,
      defaultStatus: 'active',
      programmeId: null,
      selfPay: false,
      specification: null,
      notes: [
        payload.completedBy ? `Registered as: ${payload.completedBy}` : null,
        payload.submittedAt ? `Submitted: ${payload.submittedAt}` : null,
        payload.guardian.notes,
      ]
        .filter(Boolean)
        .join('\n') || null,
      tags: [...(payload.guardian.tags ?? []), 'google-form', 'guardian'],
      source,
    })
    guardianId = upserted.id
  }

  for (let index = 0; index < payload.learners.length; index += 1) {
    const learner = payload.learners[index]!
    const learnerExternal = normalizeExternalId(
      learner.externalId || `${baseExternal}:learner-${index + 1}`,
    )
    const programmeName = primaryProgrammeName(learner)
    const programmeId = await ensureProgramme(companyId, programmeName)
    const status = normalizeClientStatus(learner.status)
    const selfPay = learner.selfPay === true || (!guardianId && payload.completedBy === 'student')

    const upserted = await upsertParty({
      companyId,
      kind: 'student',
      externalId: learnerExternal,
      name: learner.name,
      email: learner.email ?? (payload.completedBy === 'student' ? payload.formEmail ?? null : null),
      phone: learner.phone ?? null,
      status,
      defaultStatus: 'enquiry',
      programmeId,
      selfPay,
      specification: buildLearnerSpec(learner, payload.training),
      notes: [
        payload.submittedAt ? `Form submitted: ${payload.submittedAt}` : null,
        payload.formEmail ? `Form email: ${payload.formEmail}` : null,
        payload.consent === false ? 'Consent flag was false on ingest.' : null,
        learner.notes,
      ]
        .filter(Boolean)
        .join('\n') || null,
      tags: [
        ...(learner.tags ?? []),
        'google-form',
        'student',
        payload.completedBy === 'student' ? 'self-registered' : 'parent-registered',
      ],
      source,
    })

    if (guardianId) {
      await ensureLink(companyId, guardianId, upserted.id, 'guardian_of')
      await ensureLink(companyId, guardianId, upserted.id, 'payer_for')
    }

    results.push({
      learnerExternalId: learnerExternal,
      studentId: upserted.id,
      guardianId,
      programmeId,
      created: upserted.created,
      updated: !upserted.created,
    })
  }

  return {
    ok: true as const,
    externalId: baseExternal,
    guardianId,
    learners: results,
  }
}
