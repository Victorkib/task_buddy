'use client'

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { GraduationCap, Plus, Search, UserRound, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  billingPlan,
  canLinkTo,
  possibleDuplicates,
  relationsForKind,
  splitFamily,
  type FamilyMember,
} from '@/lib/clients/family'
import {
  CHILD_SIDE_LABELS,
  CLIENT_KIND_LABELS,
  CLIENT_KINDS,
  CLIENT_STATUS_LABELS,
  PARENT_SIDE_LABELS,
  type AcademyProgrammeRecord,
  type ClientDeskCapabilities,
  type ClientKind,
  type ClientLinkRelation,
  type ClientLinkView,
  type ClientRecord,
} from '@/lib/clients/types'

export type QuickAddInput = {
  kind: ClientKind
  name: string
  phone: string
  email: string
  programmeId: string
  dateOfBirth: string
  selfPay: boolean
}

type FamilySelf = { id: string; name: string; kind: ClientKind; links: ClientLinkView[] }

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Short wording for a relation, read from the record on screen. */
function tagLabel(selfIsStudent: boolean, relation: ClientLinkRelation) {
  if (relation === 'related_to') return 'Related'
  if (selfIsStudent) return CHILD_SIDE_LABELS[relation]
  return relation === 'guardian_of' ? 'Guardian' : 'Pays fees'
}

/** What the person on the other side of this relation is called. */
function targetNoun(selfKind: ClientKind, relation: ClientLinkRelation) {
  if (relation === 'related_to') return 'person'
  if (selfKind === 'student') return relation === 'payer_for' ? 'fee payer' : 'parent'
  return 'student'
}

function memberMeta(member: FamilyMember) {
  const client = member.client
  if (!client) return CLIENT_KIND_LABELS[member.otherKind]
  if (client.kind === 'student') {
    return [client.programmeName ?? 'No programme', CLIENT_STATUS_LABELS[client.status]].join(' · ')
  }
  const contact = [client.phone, client.email].filter(Boolean).join(' · ')
  return contact || CLIENT_KIND_LABELS[client.kind]
}

export function ClientFamilyPanel({
  self,
  saved,
  clients,
  clientsById,
  programmes,
  caps,
  canEdit,
  busy,
  onOpen,
  onLink,
  onUnlink,
  onCreateLinked,
}: {
  self: FamilySelf
  saved: boolean
  clients: ClientRecord[]
  clientsById: Map<string, ClientRecord>
  programmes: AcademyProgrammeRecord[]
  caps: ClientDeskCapabilities
  canEdit: boolean
  busy: boolean
  onOpen: (id: string) => void
  onLink: (otherId: string, relation: ClientLinkRelation) => void
  onUnlink: (member: FamilyMember, linkIds: string[]) => void
  onCreateLinked: (input: QuickAddInput, relation: ClientLinkRelation) => Promise<string | null>
}) {
  const relations = relationsForKind(self.kind)
  const [relation, setRelation] = useState<ClientLinkRelation>(relations[0])
  const [modal, setModal] = useState<{ name: string } | null>(null)
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const isStudent = self.kind === 'student'
  const activeRelation = relations.includes(relation) ? relation : relations[0]

  const family = useMemo(() => splitFamily(self, clientsById), [self, clientsById])
  const primary = isStudent ? family.parents : family.children
  const plan = useMemo(() => {
    if (!isStudent) return null
    const record = clientsById.get(self.id)
    // Unsaved students have no record yet; read the plan from what is on screen.
    const base: ClientRecord | null = record
      ? { ...record, links: self.links }
      : null
    return base ? billingPlan(base, clientsById) : null
  }, [isStudent, clientsById, self])

  const linkedKeys = useMemo(
    () => new Set(self.links.map((link) => `${link.otherId}:${link.relation}`)),
    [self.links],
  )
  const candidates = useMemo(
    () =>
      clients.filter(
        (client) =>
          client.id !== self.id &&
          canLinkTo(self.kind, client.kind, activeRelation) &&
          !linkedKeys.has(`${client.id}:${activeRelation}`),
      ),
    [clients, self.id, self.kind, activeRelation, linkedKeys],
  )

  const title = isStudent ? 'Parents & fee payers' : self.kind === 'organization' ? 'Sponsored students' : 'Children'
  const noun = targetNoun(self.kind, activeRelation)
  const primaryNoun = isStudent ? 'parent' : 'student'
  const subtitle = isStudent
    ? `Who looks after ${self.name || 'this student'} and who pays. Invoices go to a fee payer first, then a parent.`
    : self.kind === 'organization'
      ? `Students ${self.name || 'this organisation'} pays fees for.`
      : `Students ${self.name || 'this person'} is a parent, guardian, or fee payer for.`
  const canCreatePeople = canEdit && caps.canCreate

  function openModal(name = '') {
    setModal({ name })
  }

  return (
    <section className="clients-family" aria-label={title}>
      <header className="clients-family-head">
        <span className="clients-family-icon" aria-hidden="true">
          {isStudent ? <Users /> : <GraduationCap />}
        </span>
        <div>
          <strong>{title}</strong>
          <p>{subtitle}</p>
        </div>
      </header>

      {primary.length > 0 ? (
        <ul className="clients-family-list">
          {primary.map((member) => (
            <MemberRow
              key={member.otherId}
              member={member}
              selfIsStudent={isStudent}
              billed={Boolean(plan && !plan.selfBilled && plan.billTo.id === member.otherId)}
              canEdit={canEdit}
              busy={busy}
              onOpen={onOpen}
              onUnlink={onUnlink}
            />
          ))}
        </ul>
      ) : (
        <div className="clients-family-empty">
          <UserRound aria-hidden="true" />
          <div>
            <strong>{isStudent ? 'No parent or fee payer linked yet' : `No ${self.kind === 'organization' ? 'sponsored ' : ''}students linked yet`}</strong>
            <p>
              {isStudent
                ? `${self.name || 'This student'} is treated as self-sponsored, so invoices go to them directly until a parent or payer is linked.`
                : `Link a student who is already in the directory, or add a new one here.`}
            </p>
            {canEdit ? (
              <div className="clients-family-empty-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRelation(relations[0])
                    pickerRef.current?.focus()
                  }}
                >
                  <Search aria-hidden="true" /> Link existing {primaryNoun}
                </Button>
                {canCreatePeople ? (
                  <Button
                    type="button"
                    className="create-button"
                    disabled={busy}
                    onClick={() => {
                      setRelation(relations[0])
                      openModal()
                    }}
                  >
                    <Plus aria-hidden="true" /> Add new {primaryNoun}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {plan ? (
        <p className={`clients-billing-note${plan.selfBilled ? ' is-self' : ''}`}>
          <strong>Invoices go to:</strong> {plan.billTo.name}
          {plan.selfBilled ? ' (billed directly)' : ''}
        </p>
      ) : null}

      {family.others.length > 0 ? (
        <div className="clients-family-others">
          <span className="clients-family-label">Other links</span>
          <ul className="clients-family-list">
            {family.others.map((member) => (
              <MemberRow
                key={member.otherId}
                member={member}
                selfIsStudent={isStudent}
                billed={false}
                canEdit={canEdit}
                busy={busy}
                onOpen={onOpen}
                onUnlink={onUnlink}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {canEdit ? (
        <div className="clients-family-add">
          <div className="clients-segmented" role="radiogroup" aria-label="Relationship">
            {relations.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={activeRelation === value}
                className={activeRelation === value ? 'is-on' : ''}
                onClick={() => setRelation(value)}
              >
                {isStudent ? CHILD_SIDE_LABELS[value] : PARENT_SIDE_LABELS[value]}
              </button>
            ))}
          </div>
          <LinkPicker
            inputRef={pickerRef}
            noun={noun}
            candidates={candidates}
            disabled={busy}
            canCreate={canCreatePeople}
            onPick={(client) => onLink(client.id, activeRelation)}
            onCreate={(name) => openModal(name)}
          />
          {!saved ? (
            <p className="field-hint">Links you add now are saved together with this record.</p>
          ) : null}
        </div>
      ) : null}

      {modal ? (
        <QuickAddModal
          key={`${activeRelation}-${modal.name}`}
          selfKind={self.kind}
          selfName={self.name}
          relation={activeRelation}
          initialName={modal.name}
          saved={saved}
          clients={clients.filter((client) => client.id !== self.id)}
          programmes={programmes}
          caps={caps}
          onClose={() => setModal(null)}
          onPickExisting={(client) => {
            setModal(null)
            if (!linkedKeys.has(`${client.id}:${activeRelation}`)) onLink(client.id, activeRelation)
          }}
          onSubmit={async (input) => {
            const error = await onCreateLinked(input, activeRelation)
            if (!error) setModal(null)
            return error
          }}
        />
      ) : null}
    </section>
  )
}

function MemberRow({
  member,
  selfIsStudent,
  billed,
  canEdit,
  busy,
  onOpen,
  onUnlink,
}: {
  member: FamilyMember
  selfIsStudent: boolean
  billed: boolean
  canEdit: boolean
  busy: boolean
  onOpen: (id: string) => void
  onUnlink: (member: FamilyMember, linkIds: string[]) => void
}) {
  return (
    <li className="clients-family-member">
      <button
        type="button"
        className="clients-family-person"
        onClick={() => onOpen(member.otherId)}
        disabled={!member.client}
        title={member.client ? `Open ${member.otherName}` : undefined}
      >
        <span className={`clients-avatar kind-${member.otherKind}`} aria-hidden="true">
          {initials(member.otherName)}
        </span>
        <span>
          <strong>{member.otherName}</strong>
          <small>{memberMeta(member)}</small>
        </span>
      </button>
      <div className="clients-family-tags">
        {billed ? <span className="clients-family-tag is-billed">Billed for fees</span> : null}
        {member.links.map((link) => (
          <span key={link.id} className="clients-family-tag">
            {tagLabel(selfIsStudent, link.relation)}
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove ${tagLabel(selfIsStudent, link.relation).toLowerCase()} link with ${member.otherName}`}
                disabled={busy}
                onClick={() => onUnlink(member, [link.id])}
              >
                <X aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </li>
  )
}

function LinkPicker({
  inputRef,
  noun,
  candidates,
  disabled,
  canCreate,
  onPick,
  onCreate,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  noun: string
  candidates: ClientRecord[]
  disabled: boolean
  canCreate: boolean
  onPick: (client: ClientRecord) => void
  onCreate: (name: string) => void
}) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? candidates.filter((client) =>
          [client.name, client.email, client.phone, client.programmeName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : candidates
    return list.slice(0, 8)
  }, [candidates, query])

  const options = [
    ...matches.map((client) => ({ type: 'client' as const, client })),
    ...(canCreate ? [{ type: 'create' as const, client: null }] : []),
  ]
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0))

  function choose(index: number) {
    const option = options[index]
    if (!option) return
    if (option.type === 'client') onPick(option.client)
    else onCreate(query.trim())
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((current) => Math.min(current + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      if (!open || options.length === 0) return
      event.preventDefault()
      choose(activeIndex)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="clients-picker">
      <label className="clients-search clients-picker-input">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={`Search ${noun === 'person' ? 'people' : `${noun}s`} to link…`}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </label>
      {open ? (
        <ul id={listId} role="listbox" className="clients-picker-list">
          {matches.length === 0 ? (
            <li className="clients-picker-empty" role="presentation">
              {candidates.length === 0
                ? `No ${noun === 'person' ? 'people' : `${noun}s`} in the directory to link yet.`
                : `No ${noun === 'person' ? 'people' : `${noun}s`} match “${query.trim()}”.`}
            </li>
          ) : null}
          {options.map((option, index) => (
            <li
              key={option.type === 'client' ? option.client.id : '__create__'}
              role="option"
              aria-selected={index === activeIndex}
              className={`${index === activeIndex ? 'is-active' : ''}${option.type === 'create' ? ' is-create' : ''}`}
              // Keep focus in the input so blur does not close the list before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option.type === 'client' ? (
                <>
                  <span className={`clients-avatar kind-${option.client.kind}`} aria-hidden="true">
                    {initials(option.client.name)}
                  </span>
                  <span>
                    <strong>{option.client.name}</strong>
                    <small>
                      {CLIENT_KIND_LABELS[option.client.kind]}
                      {option.client.programmeName ? ` · ${option.client.programmeName}` : ''}
                      {option.client.phone ? ` · ${option.client.phone}` : ''}
                    </small>
                  </span>
                </>
              ) : (
                <>
                  <span className="clients-avatar is-create" aria-hidden="true">
                    <Plus />
                  </span>
                  <span>
                    <strong>{query.trim() ? `Add “${query.trim()}” as a new ${noun}` : `Add a new ${noun}`}</strong>
                    <small>Opens a short form and links them straight away</small>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function QuickAddModal({
  selfKind,
  selfName,
  relation,
  initialName,
  saved,
  clients,
  programmes,
  caps,
  onClose,
  onPickExisting,
  onSubmit,
}: {
  selfKind: ClientKind
  selfName: string
  relation: ClientLinkRelation
  initialName: string
  saved: boolean
  clients: ClientRecord[]
  programmes: AcademyProgrammeRecord[]
  caps: ClientDeskCapabilities
  onClose: () => void
  onPickExisting: (client: ClientRecord) => void
  onSubmit: (input: QuickAddInput) => Promise<string | null>
}) {
  const headingId = useId()
  const kinds = useMemo(
    () =>
      CLIENT_KINDS.filter(
        (kind) =>
          canLinkTo(selfKind, kind, relation) &&
          (caps.fullDirectory || kind === 'student' || kind === 'guardian'),
      ),
    [selfKind, relation, caps.fullDirectory],
  )
  const preferred: ClientKind = kinds.includes('student') ? 'student' : kinds.includes('guardian') ? 'guardian' : (kinds[0] ?? 'guardian')
  const activeProgrammes = programmes.filter((programme) => programme.active && !programme.id.startsWith('temp-'))
  const [input, setInput] = useState<QuickAddInput>({
    kind: preferred,
    name: initialName,
    phone: '',
    email: '',
    programmeId: activeProgrammes.length === 1 ? activeProgrammes[0].id : '',
    dateOfBirth: '',
    selfPay: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const noun = input.kind === 'student' ? 'student' : input.kind === 'organization' ? 'sponsor' : relation === 'payer_for' ? 'fee payer' : relation === 'related_to' ? 'person' : 'parent'

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const { name, phone, email } = input
  const duplicates = useMemo(
    () =>
      possibleDuplicates(
        clients.filter((client) => kinds.includes(client.kind)),
        { name, phone, email },
      ),
    [clients, kinds, name, phone, email],
  )

  const needsProgramme = input.kind === 'student'
  const ready = input.name.trim().length > 0 && (!needsProgramme || Boolean(input.programmeId)) && kinds.length > 0

  async function submit() {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      const problem = await onSubmit(input)
      if (problem) setError(problem)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="create-modal clients-quick-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id={headingId}>Add a new {noun}</h2>
            <p className="clients-quick-sub">
              {saved
                ? `They are saved and linked to ${selfName} straight away.`
                : `They are saved now and linked when you save ${selfName || 'this record'}.`}
            </p>
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>

        <form
          className="clients-quick-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {kinds.length > 1 ? (
            <label className="form-field">
              <span>Type</span>
              <select value={input.kind} onChange={(event) => setInput({ ...input, kind: event.target.value as ClientKind })}>
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {CLIENT_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kinds.length === 0 ? (
            <p className="form-error">You cannot add this kind of record. Ask leadership for directory access.</p>
          ) : null}
          <label className="form-field">
            <span>Name</span>
            <input
              autoFocus
              value={input.name}
              onChange={(event) => setInput({ ...input, name: event.target.value })}
              placeholder={input.kind === 'student' ? 'Student full name' : input.kind === 'organization' ? 'Organisation name' : 'Full name'}
              required
            />
          </label>
          <div className="clients-quick-row">
            <label className="form-field">
              <span>Phone</span>
              <input value={input.phone} inputMode="tel" onChange={(event) => setInput({ ...input, phone: event.target.value })} />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input type="email" value={input.email} onChange={(event) => setInput({ ...input, email: event.target.value })} />
            </label>
          </div>
          {needsProgramme ? (
            <>
              <div className="clients-quick-row">
                <label className="form-field">
                  <span>Programme</span>
                  <select
                    value={input.programmeId}
                    onChange={(event) => setInput({ ...input, programmeId: event.target.value })}
                    required
                  >
                    <option value="">Select programme</option>
                    {activeProgrammes.map((programme) => (
                      <option key={programme.id} value={programme.id}>
                        {programme.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Date of birth</span>
                  <input
                    type="date"
                    value={input.dateOfBirth}
                    onChange={(event) => setInput({ ...input, dateOfBirth: event.target.value })}
                  />
                </label>
              </div>
              {activeProgrammes.length === 0 ? (
                <p className="field-hint">No active programmes yet. Add one under Curriculum first, then add the student.</p>
              ) : null}
              <label className="clients-check">
                <input
                  type="checkbox"
                  checked={input.selfPay}
                  onChange={(event) => setInput({ ...input, selfPay: event.target.checked })}
                />
                <span>Student pays their own fees (self-pay)</span>
              </label>
            </>
          ) : null}

          {duplicates.length > 0 ? (
            <div className="clients-dup">
              <strong>Already in the directory?</strong>
              <ul>
                {duplicates.map((client) => (
                  <li key={client.id}>
                    <span>
                      {client.name} · {CLIENT_KIND_LABELS[client.kind]}
                      {client.phone ? ` · ${client.phone}` : ''}
                    </span>
                    <button type="button" className="text-back" onClick={() => onPickExisting(client)}>
                      Link this one instead
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          <div className="modal-actions">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="create-button" disabled={!ready || saving}>
              {saving ? 'Saving…' : saved ? `Add and link ${noun}` : `Add ${noun}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
