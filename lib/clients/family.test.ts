import {
  applyOverlay,
  billingPlan,
  canLinkTo,
  childrenOf,
  EMPTY_OVERLAY,
  orientLink,
  possibleDuplicates,
  splitFamily,
} from './family'
import type { ClientKind, ClientLinkRelation, ClientRecord } from './types'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

function person(id: string, name: string, kind: ClientKind, extra: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id,
    name,
    email: null,
    phone: null,
    address: null,
    pin: null,
    kind,
    status: kind === 'student' ? 'enquiry' : 'active',
    tags: [],
    specification: null,
    notes: null,
    source: null,
    dateOfBirth: null,
    programmeId: null,
    programmeName: null,
    selfPay: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    links: [],
    ...extra,
  }
}

/** Builds the two-sided views the server sends for a stored from -> to link. */
function link(all: ClientRecord[], id: string, fromId: string, toId: string, relation: ClientLinkRelation) {
  return applyOverlay(all, { ...EMPTY_OVERLAY, links: [{ id, fromId, toId, relation }] })
}

const hope = person('g1', 'Hope', 'guardian', { phone: '+254 712 345 678' })
const amani = person('s1', 'Amani', 'student', { programmeName: 'Youth Track' })
const brian = person('s2', 'Brian', 'student')
const acme = person('o1', 'ACME Ltd', 'organization')

// Orientation: the payer is always "from", whichever record the link is made on.
assert(orientLink(hope, amani, 'guardian_of')?.fromId === 'g1', 'parent first stays parent -> student')
assert(orientLink(amani, hope, 'guardian_of')?.fromId === 'g1', 'linking from the student flips to parent -> student')
assert(orientLink(acme, amani, 'payer_for')?.toId === 's1', 'an organisation can pay for a student')
assert(orientLink(acme, amani, 'guardian_of') === null, 'an organisation is not a guardian')
assert(orientLink(amani, brian, 'guardian_of') === null, 'two students cannot be parent and child')
assert(orientLink(hope, acme, 'payer_for') === null, 'fee links always end at a student')
assert(orientLink(hope, hope, 'related_to') === null, 'nothing links to itself')
assert(orientLink(hope, acme, 'related_to')?.fromId === 'g1', 'related links keep the order given')

// Pickers only offer the other side.
assert(canLinkTo('guardian', 'student', 'guardian_of'), 'a parent picks students')
assert(!canLinkTo('guardian', 'guardian', 'guardian_of'), 'a parent does not pick other parents as children')
assert(canLinkTo('student', 'guardian', 'guardian_of'), 'a student picks parents')
assert(!canLinkTo('student', 'organization', 'guardian_of'), 'a student does not pick an organisation as guardian')
assert(canLinkTo('student', 'organization', 'payer_for'), 'a student can pick an organisation as fee payer')

// Family reads the same from both records, even for a link saved the old, backwards way.
let all = link([hope, amani, brian, acme], 'l1', 'g1', 's1', 'guardian_of')
all = applyOverlay(all, { ...EMPTY_OVERLAY, links: [{ id: 'l2', fromId: 's2', toId: 'g1', relation: 'guardian_of' }] })
const byId = new Map(all.map((client) => [client.id, client]))
const hopeFamily = splitFamily(byId.get('g1')!, byId)
assert(hopeFamily.children.length === 2, 'the parent sees both children, including a backwards link')
assert(splitFamily(byId.get('s1')!, byId).parents[0]?.otherId === 'g1', 'the student sees the parent')
assert(splitFamily(byId.get('s2')!, byId).parents[0]?.otherId === 'g1', 'a backwards link still shows the parent')
assert(childrenOf(byId.get('g1')!, byId).map((child) => child.id).sort().join() === 's1,s2', 'children are listed for billing')

// Repeat links to one person merge into one row.
all = applyOverlay(all, { ...EMPTY_OVERLAY, links: [{ id: 'l3', fromId: 'g1', toId: 's1', relation: 'payer_for' }] })
const merged = new Map(all.map((client) => [client.id, client]))
const amaniParents = splitFamily(merged.get('s1')!, merged).parents
assert(amaniParents.length === 1 && amaniParents[0].links.length === 2, 'guardian and payer links show as one parent')

// Billing.
const planWithParent = billingPlan(merged.get('s1')!, merged)
assert(planWithParent.billTo.id === 'g1' && !planWithParent.selfBilled, 'a student with a parent bills the parent')
assert(planWithParent.options.some((option) => option.id === 's1'), 'the student can still be chosen as bill-to')
const lone = person('s9', 'Zawadi', 'student')
const lonePlan = billingPlan(lone, new Map([[lone.id, lone]]))
assert(lonePlan.billTo.id === 's9' && lonePlan.selfBilled, 'a student with nobody linked is billed directly')
const selfPay = { ...merged.get('s1')!, selfPay: true }
assert(billingPlan(selfPay, merged).billTo.id === 's1', 'self-pay bills the student even with a parent linked')
const sponsored = applyOverlay([acme, hope, amani], {
  ...EMPTY_OVERLAY,
  links: [
    { id: 'a', fromId: 'g1', toId: 's1', relation: 'guardian_of' },
    { id: 'b', fromId: 'o1', toId: 's1', relation: 'payer_for' },
  ],
})
const sponsoredById = new Map(sponsored.map((client) => [client.id, client]))
assert(billingPlan(sponsoredById.get('s1')!, sponsoredById).billTo.id === 'o1', 'a fee payer is billed before a guardian')

// Overlay removals and new people.
const removed = applyOverlay(all, { ...EMPTY_OVERLAY, removedLinkIds: ['l1'] })
assert(!removed.find((client) => client.id === 'g1')!.links.some((entry) => entry.id === 'l1'), 'an unlinked row disappears at once')
const added = applyOverlay([hope], { clients: [amani], links: [{ id: 'n1', fromId: 'g1', toId: 's1', relation: 'guardian_of' }], removedLinkIds: [] })
assert(added.length === 2 && added.find((client) => client.id === 'g1')!.links.length === 1, 'a child added in place shows linked')
assert(applyOverlay(all, EMPTY_OVERLAY) === all, 'an empty overlay changes nothing')

// Duplicate hints.
assert(possibleDuplicates([hope], { name: '', phone: '0712345678', email: '' })[0]?.id === 'g1', 'phone numbers match across formats')
assert(possibleDuplicates([hope], { name: 'ho', phone: '', email: '' }).length === 0, 'two letters are too few to suggest a match')

console.log('family tests passed')
