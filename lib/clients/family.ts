import type { ClientKind, ClientLinkRelation, ClientLinkView, ClientRecord } from '@/lib/clients/types'

export type FamilyRelation = Extract<ClientLinkRelation, 'guardian_of' | 'payer_for'>

export type FamilyMember = {
  otherId: string
  otherName: string
  otherKind: ClientKind
  client: ClientRecord | null
  links: { id: string; relation: ClientLinkRelation }[]
}

export type FamilySplit = {
  parents: FamilyMember[]
  children: FamilyMember[]
  others: FamilyMember[]
}

export function isFamilyRelation(relation: ClientLinkRelation): relation is FamilyRelation {
  return relation === 'guardian_of' || relation === 'payer_for'
}

/** Kinds that may sit on the parent / payer side of a family link. */
export function canBeParentSide(kind: ClientKind, relation: ClientLinkRelation) {
  if (relation === 'guardian_of') return kind === 'guardian' || kind === 'individual'
  if (relation === 'payer_for') return kind === 'guardian' || kind === 'individual' || kind === 'organization'
  return true
}

/**
 * Stored links always run payer -> student for guardian_of / payer_for, whichever record
 * the link was made from. Returns null when the pair cannot hold that relation.
 */
export function orientLink(
  a: { id: string; kind: ClientKind },
  b: { id: string; kind: ClientKind },
  relation: ClientLinkRelation,
): { fromId: string; toId: string } | null {
  if (a.id === b.id) return null
  if (!isFamilyRelation(relation)) return { fromId: a.id, toId: b.id }
  if (b.kind === 'student' && a.kind !== 'student' && canBeParentSide(a.kind, relation)) return { fromId: a.id, toId: b.id }
  if (a.kind === 'student' && b.kind !== 'student' && canBeParentSide(b.kind, relation)) return { fromId: b.id, toId: a.id }
  return null
}

/** Relations offered on a record of this kind, in the order they should appear. */
export function relationsForKind(kind: ClientKind): ClientLinkRelation[] {
  if (kind === 'organization') return ['payer_for', 'related_to']
  return ['guardian_of', 'payer_for', 'related_to']
}

/** Whether `candidate` may be linked to a record of `anchorKind` with this relation. */
export function canLinkTo(anchorKind: ClientKind, candidateKind: ClientKind, relation: ClientLinkRelation) {
  if (!isFamilyRelation(relation)) return true
  if (anchorKind === 'student') return candidateKind !== 'student' && canBeParentSide(candidateKind, relation)
  return candidateKind === 'student' && canBeParentSide(anchorKind, relation)
}

function familyRole(selfKind: ClientKind, link: Pick<ClientLinkView, 'relation' | 'otherKind'>) {
  if (!isFamilyRelation(link.relation)) return 'other' as const
  if (selfKind === 'student' && link.otherKind !== 'student') return 'parent' as const
  if (selfKind !== 'student' && link.otherKind === 'student') return 'child' as const
  return 'other' as const
}

/** Groups a record's links into parents, children, and other links, merging repeat links to one person. */
export function splitFamily(
  self: { kind: ClientKind; links: ClientLinkView[] },
  clientsById: Map<string, ClientRecord>,
): FamilySplit {
  const buckets: Record<'parent' | 'child' | 'other', Map<string, FamilyMember>> = {
    parent: new Map(),
    child: new Map(),
    other: new Map(),
  }
  for (const link of self.links) {
    const client = clientsById.get(link.otherId) ?? null
    const otherKind = client?.kind ?? link.otherKind
    const role = familyRole(self.kind, { relation: link.relation, otherKind })
    const bucket = buckets[role]
    const existing = bucket.get(link.otherId)
    if (existing) {
      if (!existing.links.some((entry) => entry.id === link.id)) existing.links.push({ id: link.id, relation: link.relation })
      continue
    }
    bucket.set(link.otherId, {
      otherId: link.otherId,
      otherName: client?.name ?? link.otherName,
      otherKind,
      client,
      links: [{ id: link.id, relation: link.relation }],
    })
  }
  const byName = (a: FamilyMember, b: FamilyMember) => a.otherName.localeCompare(b.otherName)
  return {
    parents: [...buckets.parent.values()].sort(byName),
    children: [...buckets.child.values()].sort(byName),
    others: [...buckets.other.values()].sort(byName),
  }
}

export type BillingPlan = {
  billTo: ClientRecord
  /** Everyone who could reasonably receive this bill, default first. */
  options: ClientRecord[]
  reason: string
  selfBilled: boolean
}

/**
 * Who pays for a record. Students bill a linked fee payer first, then a guardian.
 * With self-pay on, or nobody linked, the student is billed directly.
 */
export function billingPlan(record: ClientRecord, clientsById: Map<string, ClientRecord>): BillingPlan {
  if (record.kind !== 'student') {
    return { billTo: record, options: [record], reason: `Billed to ${record.name}.`, selfBilled: true }
  }
  const { parents } = splitFamily(record, clientsById)
  const payers = parents
    .filter((member) => member.client)
    .sort((a, b) => rank(a) - rank(b))
    .map((member) => member.client as ClientRecord)
  if (record.selfPay) {
    return {
      billTo: record,
      options: [record, ...payers],
      reason: `Self-pay is on, so ${record.name} is billed directly.`,
      selfBilled: true,
    }
  }
  if (payers.length === 0) {
    return {
      billTo: record,
      options: [record],
      reason: `No parent or fee payer is linked, so ${record.name} is billed directly as a self-sponsored student.`,
      selfBilled: true,
    }
  }
  const [first] = payers
  return {
    billTo: first,
    options: [...payers, record],
    reason: `Billing ${first.name} for ${record.name}.`,
    selfBilled: false,
  }
}

function rank(member: FamilyMember) {
  return member.links.some((link) => link.relation === 'payer_for') ? 0 : 1
}

/** Students a payer is responsible for (guardian_of or payer_for). */
export function childrenOf(record: ClientRecord, clientsById: Map<string, ClientRecord>) {
  if (record.kind === 'student') return []
  return splitFamily(record, clientsById)
    .children.map((member) => member.client)
    .filter((client): client is ClientRecord => Boolean(client))
}

export type OverlayLink = { id: string; fromId: string; toId: string; relation: ClientLinkRelation }

export type ClientOverlay = {
  clients: ClientRecord[]
  links: OverlayLink[]
  removedLinkIds: string[]
}

export const EMPTY_OVERLAY: ClientOverlay = { clients: [], links: [], removedLinkIds: [] }

/**
 * Lays changes the server already accepted over the last loaded directory, so the screen
 * updates at once and stays right until the refreshed data arrives.
 */
export function applyOverlay(base: ClientRecord[], overlay: ClientOverlay): ClientRecord[] {
  if (overlay.clients.length === 0 && overlay.links.length === 0 && overlay.removedLinkIds.length === 0) return base
  const baseIds = new Set(base.map((client) => client.id))
  const merged = [...base, ...overlay.clients.filter((client) => !baseIds.has(client.id))]
  const byId = new Map(merged.map((client) => [client.id, client]))
  const removed = new Set(overlay.removedLinkIds)
  return merged
    .map((client) => {
      const known = new Set(client.links.map((link) => link.id))
      const extra: ClientLinkView[] = []
      for (const link of overlay.links) {
        if (known.has(link.id)) continue
        if (link.fromId !== client.id && link.toId !== client.id) continue
        const direction = link.fromId === client.id ? 'from' : 'to'
        const other = byId.get(direction === 'from' ? link.toId : link.fromId)
        if (!other) continue
        extra.push({
          id: link.id,
          relation: link.relation,
          otherId: other.id,
          otherName: other.name,
          otherKind: other.kind,
          direction,
        })
      }
      const links = [...client.links.filter((link) => !removed.has(link.id)), ...extra]
      if (extra.length === 0 && links.length === client.links.length) return client
      return { ...client, links }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Digits only, last nine, so 0712… and +254712… match. */
export function phoneKey(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : ''
}

/** Records that look like the person being typed, to avoid entering a parent twice. */
export function possibleDuplicates(
  clients: ClientRecord[],
  input: { name: string; phone: string; email: string },
  limit = 3,
) {
  const name = input.name.trim().toLowerCase()
  const phone = phoneKey(input.phone)
  const email = input.email.trim().toLowerCase()
  if (name.length < 3 && !phone && !email) return []
  return clients
    .filter((client) => {
      if (email && client.email && client.email.toLowerCase() === email) return true
      if (phone && phoneKey(client.phone) === phone) return true
      if (name.length >= 3 && client.name.toLowerCase().includes(name)) return true
      return false
    })
    .slice(0, limit)
}
