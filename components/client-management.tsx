'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { GraduationCap, Link2, Plus, Search, Users } from 'lucide-react'
import { deleteAcademyProgramme, deleteClientRecord, saveAcademyProgramme, saveClientRecord } from '@/app/clients-actions'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/user-avatar'
import {
  CLIENT_KIND_LABELS,
  CLIENT_LINK_LABELS,
  CLIENT_STATUS_LABELS,
  type AcademyProgrammeRecord,
  type ClientDesk,
  type ClientKind,
  type ClientLinkRelation,
  type ClientRecord,
  type ClientStatus,
} from '@/lib/clients/types'
import type { Person } from '@/lib/types'

const NEW_PROGRAMME_VALUE = '__new__'

type Focus = 'directory' | 'students' | 'guardians' | 'curriculum'

type DraftLink = { toClientId: string; relation: ClientLinkRelation }

type Draft = {
  id: string
  name: string
  email: string
  phone: string
  address: string
  pin: string
  kind: ClientKind
  status: ClientStatus
  tags: string
  specification: string
  notes: string
  source: string
  dateOfBirth: string
  programmeId: string
  selfPay: boolean
  links: DraftLink[]
}

type ProgrammeDraft = {
  id: string
  name: string
  description: string
  active: boolean
  sortOrder: string
  leadIds: string[]
}

function blankDraft(kind: ClientKind = 'individual'): Draft {
  return {
    id: '',
    name: '',
    email: '',
    phone: '',
    address: '',
    pin: '',
    kind,
    status: kind === 'student' ? 'enquiry' : 'active',
    tags: '',
    specification: '',
    notes: '',
    source: '',
    dateOfBirth: '',
    programmeId: '',
    selfPay: false,
    links: [],
  }
}

function fromRecord(client: ClientRecord): Draft {
  return {
    id: client.id,
    name: client.name,
    email: client.email ?? '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    pin: client.pin ?? '',
    kind: client.kind,
    status: client.status,
    tags: client.tags.join(', '),
    specification: client.specification ?? '',
    notes: client.notes ?? '',
    source: client.source ?? '',
    dateOfBirth: client.dateOfBirth ? String(client.dateOfBirth).slice(0, 10) : '',
    programmeId: client.programmeId ?? '',
    selfPay: client.selfPay,
    links: client.links
      .filter((link) => link.direction === 'from')
      .map((link) => ({ toClientId: link.otherId, relation: link.relation })),
  }
}

function blankProgramme(): ProgrammeDraft {
  return { id: '', name: '', description: '', active: true, sortOrder: '0', leadIds: [] }
}

export function ClientManagement({
  desk,
  people,
  onRefresh,
}: {
  desk: ClientDesk
  people: Person[]
  onRefresh?: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [focus, setFocus] = useState<Focus>(desk.capabilities.fullDirectory ? 'directory' : 'students')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(blankDraft(desk.capabilities.fullDirectory ? 'organization' : 'student'))
  const [programmeDraft, setProgrammeDraft] = useState<ProgrammeDraft>(blankProgramme())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [linkTargetId, setLinkTargetId] = useState('')
  const [linkRelation, setLinkRelation] = useState<ClientLinkRelation>('guardian_of')
  const [programmes, setProgrammes] = useState<AcademyProgrammeRecord[]>(desk.programmes)
  const [programmeChoice, setProgrammeChoice] = useState('')
  const [customProgrammeName, setCustomProgrammeName] = useState('')
  const [programmeBusy, setProgrammeBusy] = useState(false)
  const caps = desk.capabilities
  const canMutate = draft.id ? caps.canUpdate : caps.canCreate
  const showDirectory = caps.fullDirectory || desk.canManageBilling
  const creatingProgramme = programmeChoice === NEW_PROGRAMME_VALUE

  useEffect(() => {
    setProgrammes(desk.programmes)
  }, [desk.programmes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return desk.clients.filter((client) => {
      if (focus === 'students' && client.kind !== 'student') return false
      if (focus === 'guardians' && client.kind !== 'guardian') return false
      if (focus === 'directory' && !desk.capabilities.fullDirectory && client.kind !== 'student' && client.kind !== 'guardian') {
        return false
      }
      if (statusFilter !== 'all' && client.status !== statusFilter) return false
      if (!q) return true
      const hay = [
        client.name,
        client.email,
        client.phone,
        client.specification,
        client.programmeName,
        ...client.tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [desk.clients, desk.capabilities.fullDirectory, focus, query, statusFilter])

  useEffect(() => {
    if (selectedId && !desk.clients.some((client) => client.id === selectedId)) {
      setSelectedId(null)
    }
  }, [desk.clients, selectedId])

  function selectClient(client: ClientRecord) {
    setSelectedId(client.id)
    setDraft(fromRecord(client))
    setProgrammeChoice(client.programmeId ?? '')
    setCustomProgrammeName('')
    setError(null)
    setNotice(null)
    if (client.kind === 'student') setFocus('students')
    if (client.kind === 'guardian') setFocus('guardians')
  }

  function startCreate(kind: ClientKind) {
    setSelectedId(null)
    setDraft(blankDraft(kind))
    setProgrammeChoice('')
    setCustomProgrammeName('')
    setError(null)
    setNotice(null)
    if (kind === 'student') setFocus('students')
    else if (kind === 'guardian') setFocus('guardians')
    else setFocus('directory')
  }

  function onProgrammeSelectChange(value: string) {
    setProgrammeChoice(value)
    if (value === NEW_PROGRAMME_VALUE) {
      setDraft((current) => ({ ...current, programmeId: '' }))
      return
    }
    setCustomProgrammeName('')
    setDraft((current) => ({ ...current, programmeId: value }))
  }

  async function createProgrammeInline(rawName?: string) {
    const name = (rawName ?? customProgrammeName).trim()
    if (!name || !caps.canManageCurriculum || programmeBusy) return null
    const tempId = `temp-${crypto.randomUUID()}`
    const optimistic: AcademyProgrammeRecord = {
      id: tempId,
      name,
      description: null,
      active: true,
      sortOrder: programmes.length,
      leadIds: [],
      leadNames: [],
      studentCount: 0,
    }
    setProgrammes((current) => [...current, optimistic])
    setDraft((current) => ({ ...current, programmeId: tempId }))
    setProgrammeChoice(tempId)
    setCustomProgrammeName('')
    setProgrammeBusy(true)
    setError(null)
    try {
      const data = new FormData()
      data.set('name', name)
      data.set('description', '')
      data.set('active', 'yes')
      data.set('sortOrder', String(programmes.length))
      const result = await saveAcademyProgramme(data)
      if ('error' in result && result.error) {
        setProgrammes((current) => current.filter((entry) => entry.id !== tempId))
        setDraft((current) => ({ ...current, programmeId: '' }))
        setProgrammeChoice(NEW_PROGRAMME_VALUE)
        setCustomProgrammeName(name)
        setError(result.error)
        return null
      }
      if ('ok' in result && result.ok && result.id) {
        setProgrammes((current) =>
          current.map((entry) => (entry.id === tempId ? { ...entry, id: result.id } : entry)),
        )
        setDraft((current) => ({ ...current, programmeId: result.id }))
        setProgrammeChoice(result.id)
        setNotice(result.notice)
        onRefresh?.()
        return result.id
      }
      return null
    } finally {
      setProgrammeBusy(false)
    }
  }

  function runSave() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      let programmeId = draft.programmeId
      if (draft.kind === 'student' && creatingProgramme && customProgrammeName.trim()) {
        const createdId = await createProgrammeInline(customProgrammeName)
        if (!createdId) return
        programmeId = createdId
      }
      if (programmeId.startsWith('temp-')) {
        setError('Wait for the new programme to finish saving.')
        return
      }
      const data = new FormData()
      data.set('id', draft.id)
      data.set('name', draft.name)
      data.set('email', draft.email)
      data.set('phone', draft.phone)
      data.set('address', draft.address)
      data.set('pin', draft.pin)
      data.set('kind', draft.kind)
      data.set('status', draft.status)
      data.set('tags', draft.tags)
      data.set('specification', draft.specification)
      data.set('notes', draft.notes)
      data.set('source', draft.source)
      data.set('dateOfBirth', draft.dateOfBirth)
      data.set('programmeId', programmeId)
      data.set('selfPay', draft.selfPay ? 'yes' : 'no')
      data.set('linksJson', JSON.stringify(draft.links))
      const result = await saveClientRecord(data)
      if ('error' in result && result.error) {
        setError(result.error)
        return
      }
      if ('ok' in result && result.ok) {
        setNotice(result.notice)
        if (result.id) setSelectedId(result.id)
        onRefresh?.()
      }
    })
  }

  function runDelete(id: string) {
    if (!window.confirm('Remove this record from the directory? Past invoices keep their bill-to text.')) return
    setError(null)
    startTransition(async () => {
      const result = await deleteClientRecord(id)
      if ('error' in result && result.error) {
        setError(result.error)
        return
      }
      if ('ok' in result && result.ok) {
        setSelectedId(null)
        setDraft(blankDraft())
        setNotice(result.notice)
        onRefresh?.()
      }
    })
  }

  function runSaveProgramme() {
    setError(null)
    startTransition(async () => {
      const data = new FormData()
      data.set('id', programmeDraft.id)
      data.set('name', programmeDraft.name)
      data.set('description', programmeDraft.description)
      data.set('active', programmeDraft.active ? 'yes' : 'no')
      data.set('sortOrder', programmeDraft.sortOrder)
      for (const leadId of programmeDraft.leadIds) data.append('leadId', leadId)
      const result = await saveAcademyProgramme(data)
      if ('error' in result && result.error) {
        setError(result.error)
        return
      }
      if ('ok' in result && result.ok) {
        setNotice(result.notice)
        if (!programmeDraft.id && result.id) {
          setProgrammes((current) => {
            if (current.some((entry) => entry.id === result.id)) return current
            return [
              ...current,
              {
                id: result.id,
                name: programmeDraft.name.trim(),
                description: programmeDraft.description.trim() || null,
                active: programmeDraft.active,
                sortOrder: Number(programmeDraft.sortOrder) || 0,
                leadIds: programmeDraft.leadIds,
                leadNames: [],
                studentCount: 0,
              },
            ]
          })
        } else if (programmeDraft.id) {
          setProgrammes((current) =>
            current.map((entry) =>
              entry.id === programmeDraft.id
                ? {
                    ...entry,
                    name: programmeDraft.name.trim(),
                    description: programmeDraft.description.trim() || null,
                    active: programmeDraft.active,
                    sortOrder: Number(programmeDraft.sortOrder) || 0,
                    leadIds: programmeDraft.leadIds,
                  }
                : entry,
            ),
          )
        }
        setProgrammeDraft(blankProgramme())
        onRefresh?.()
      }
    })
  }

  const counts = {
    all: desk.clients.length,
    students: desk.clients.filter((c) => c.kind === 'student').length,
    guardians: desk.clients.filter((c) => c.kind === 'guardian').length,
    programmes: programmes.length,
  }

  const linkCandidates = desk.clients.filter((client) => client.id !== draft.id)

  return (
    <div className="clients-portal">
      <header className="clients-hero">
        <div>
          <span className="eyebrow">Relationships</span>
          <h1>Client management</h1>
          <p>
            One directory for commercial clients and GCS Academy intake — tags and links carry dual roles, invoices bill
            guardian or organisation by default.
          </p>
        </div>
        <div className="clients-hero-stats">
          <div>
            <strong>{counts.all}</strong>
            <span>In view</span>
          </div>
          <div>
            <strong>{counts.students}</strong>
            <span>Students</span>
          </div>
          <div>
            <strong>{counts.programmes}</strong>
            <span>Programmes</span>
          </div>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}

      <div className="project-shell clients-shell">
        <nav className="office-rail project-rail" aria-label="Client sections">
          <div className="office-rail-group">
            <span>Focus</span>
            {(
              [
                ...(showDirectory ? ([['directory', 'Directory', String(counts.all)]] as const) : []),
                ['students', 'Students', String(counts.students)],
                ['guardians', 'Guardians', String(counts.guardians)],
                ['curriculum', 'Curriculum', String(counts.programmes)],
              ] as const
            ).map(([id, label, count]) => (
              <button key={id} type="button" className={focus === id ? 'selected' : ''} onClick={() => setFocus(id)}>
                {label}
                <em>{count}</em>
              </button>
            ))}
          </div>
        </nav>

        <div className="project-stage">
          {focus !== 'curriculum' ? (
            <section className="project-section clients-section">
              <header className="project-section-head clients-toolbar">
                <div>
                  <h2>
                    {focus === 'students' ? 'Students' : focus === 'guardians' ? 'Guardians' : 'Directory'}
                  </h2>
                  <p>
                    {focus === 'students'
                      ? 'Academy learners — parents often register; self-pay is opt-in.'
                      : focus === 'guardians'
                        ? 'Parents and sponsors linked to students.'
                        : 'Organisations and individuals, with tags when someone also wears an academy hat.'}
                  </p>
                </div>
                <div className="clients-toolbar-actions">
                  {caps.canCreate && focus === 'students' ? (
                    <Button type="button" className="create-button" onClick={() => startCreate('student')}>
                      <Plus aria-hidden="true" /> Add student
                    </Button>
                  ) : null}
                  {caps.canCreate && focus === 'guardians' ? (
                    <Button type="button" className="create-button" onClick={() => startCreate('guardian')}>
                      <Plus aria-hidden="true" /> Add guardian
                    </Button>
                  ) : null}
                  {caps.canCreate && showDirectory && focus === 'directory' ? (
                    <>
                      <Button type="button" className="create-button" onClick={() => startCreate('organization')}>
                        <Plus aria-hidden="true" /> Organisation
                      </Button>
                      <Button type="button" variant="outline" onClick={() => startCreate('individual')}>
                        Individual
                      </Button>
                    </>
                  ) : null}
                </div>
              </header>

              <div className="clients-filters">
                <label className="clients-search">
                  <Search aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name, email, tags, programme…"
                  />
                </label>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                  <option value="all">All statuses</option>
                  {Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="clients-layout">
                <div className="clients-list">
                  {filtered.length === 0 ? (
                    <p className="empty-state">No records match this view yet.</p>
                  ) : (
                    filtered.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        className={`clients-card${selectedId === client.id || draft.id === client.id ? ' is-on' : ''}`}
                        onClick={() => selectClient(client)}
                      >
                        <span className={`clients-kind kind-${client.kind}`}>{CLIENT_KIND_LABELS[client.kind]}</span>
                        <strong>{client.name}</strong>
                        <span>
                          {CLIENT_STATUS_LABELS[client.status]}
                          {client.programmeName ? ` · ${client.programmeName}` : ''}
                          {client.tags.length ? ` · ${client.tags.slice(0, 2).join(', ')}` : ''}
                        </span>
                      </button>
                    ))
                  )}
                </div>

                <div className="clients-editor project-section-docs">
                  <header className="project-section-head">
                    <div>
                      <h2>{draft.id ? (caps.canUpdate ? 'Edit record' : 'Record') : 'New record'}</h2>
                      <p>
                        {canMutate
                          ? 'Primary type plus tags for dual roles. Links connect guardians, payers, and related parties.'
                          : 'You can view this record. Ask leadership if you need create or edit access.'}
                      </p>
                    </div>
                  </header>
                  {!canMutate && !draft.id ? (
                    <p className="td-muted">Select a record to view details, or request create access in Settings → Module access.</p>
                  ) : null}

                  <div className={`clients-form-grid${canMutate ? '' : ' is-readonly'}`}>
                    <label className="form-field">
                      <span>Type</span>
                      <select
                        value={draft.kind}
                        onChange={(event) => {
                          const kind = event.target.value as ClientKind
                          setDraft((current) => ({
                            ...current,
                            kind,
                            status: kind === 'student' && current.status === 'active' ? 'enquiry' : current.status,
                            programmeId: kind === 'student' ? current.programmeId : '',
                          }))
                          if (kind !== 'student') {
                            setProgrammeChoice('')
                            setCustomProgrammeName('')
                          }
                        }}
                        disabled={!canMutate || (!showDirectory && (draft.kind === 'organization' || draft.kind === 'individual'))}
                      >
                        {Object.entries(CLIENT_KIND_LABELS).map(([value, label]) => {
                          if (!showDirectory && (value === 'organization' || value === 'individual')) return null
                          return (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          )
                        })}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Status</span>
                      <select
                        value={draft.status}
                        disabled={!canMutate}
                        onChange={(event) => setDraft({ ...draft, status: event.target.value as ClientStatus })}
                      >
                        {Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field clients-span-2">
                      <span>Name</span>
                      <input
                        value={draft.name}
                        disabled={!canMutate}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </label>
                    <label className="form-field">
                      <span>Email</span>
                      <input
                        type="email"
                        value={draft.email}
                        disabled={!canMutate}
                        onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                      />
                    </label>
                    <label className="form-field">
                      <span>Phone</span>
                      <input
                        value={draft.phone}
                        disabled={!canMutate}
                        onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                      />
                    </label>
                    <label className="form-field clients-span-2">
                      <span>Tags</span>
                      <input
                        value={draft.tags}
                        disabled={!canMutate}
                        onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                        placeholder="consulting, academy-parent, sponsor…"
                      />
                    </label>
                    <label className="form-field clients-span-2">
                      <span>Specification / brief</span>
                      <textarea
                        rows={3}
                        value={draft.specification}
                        disabled={!canMutate}
                        onChange={(event) => setDraft({ ...draft, specification: event.target.value })}
                        placeholder="What they need, programme interest, delivery notes…"
                      />
                    </label>
                    {(draft.kind === 'organization' || draft.kind === 'individual' || draft.kind === 'guardian') && (
                      <>
                        <label className="form-field">
                          <span>PIN / tax ref</span>
                          <input
                            value={draft.pin}
                            disabled={!canMutate}
                            onChange={(event) => setDraft({ ...draft, pin: event.target.value })}
                          />
                        </label>
                        <label className="form-field">
                          <span>Source</span>
                          <input
                            value={draft.source}
                            disabled={!canMutate}
                            onChange={(event) => setDraft({ ...draft, source: event.target.value })}
                            placeholder="Referral, walk-in, WhatsApp…"
                          />
                        </label>
                        <label className="form-field clients-span-2">
                          <span>Address</span>
                          <textarea
                            rows={2}
                            value={draft.address}
                            disabled={!canMutate}
                            onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                          />
                        </label>
                      </>
                    )}
                    {draft.kind === 'student' ? (
                      <>
                        <div className={`form-field clients-span-2${creatingProgramme ? ' category-field category-field-open' : ' category-field'}`}>
                          <label>
                            <span>Programme</span>
                            <select
                              value={creatingProgramme ? NEW_PROGRAMME_VALUE : draft.programmeId}
                              disabled={!canMutate || programmeBusy}
                              onChange={(event) => onProgrammeSelectChange(event.target.value)}
                            >
                              <option value="">Select programme</option>
                              {programmes
                                .filter((programme) => programme.active || programme.id === draft.programmeId)
                                .map((programme) => (
                                  <option key={programme.id} value={programme.id}>
                                    {programme.name}
                                  </option>
                                ))}
                              {caps.canManageCurriculum ? (
                                <option value={NEW_PROGRAMME_VALUE}>Add new programme…</option>
                              ) : null}
                            </select>
                          </label>
                          {creatingProgramme && caps.canManageCurriculum ? (
                            <label className="category-custom">
                              New programme name
                              <input
                                value={customProgrammeName}
                                onChange={(event) => setCustomProgrammeName(event.target.value)}
                                placeholder="e.g. Youth Innovation Track"
                                disabled={!canMutate || programmeBusy}
                                autoFocus
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void createProgrammeInline()
                                  }
                                }}
                              />
                            </label>
                          ) : null}
                          {creatingProgramme && caps.canManageCurriculum ? (
                            <div className="row-actions" style={{ marginTop: 8 }}>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={!canMutate || programmeBusy || !customProgrammeName.trim()}
                                onClick={() => void createProgrammeInline()}
                              >
                                {programmeBusy ? 'Adding…' : 'Create programme'}
                              </Button>
                            </div>
                          ) : null}
                          {!caps.canManageCurriculum ? (
                            <p className="field-hint">Ask leadership for curriculum access to add programmes here.</p>
                          ) : null}
                        </div>
                        <label className="form-field">
                          <span>Date of birth</span>
                          <input
                            type="date"
                            value={draft.dateOfBirth}
                            disabled={!canMutate}
                            onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })}
                          />
                        </label>
                        <label className="form-field clients-span-2 clients-check">
                          <input
                            type="checkbox"
                            checked={draft.selfPay}
                            disabled={!canMutate}
                            onChange={(event) => setDraft({ ...draft, selfPay: event.target.checked })}
                          />
                          <span>Student may be billed directly (self-pay). Default is guardian / organisation.</span>
                        </label>
                      </>
                    ) : null}
                    <label className="form-field clients-span-2">
                      <span>Internal notes</span>
                      <textarea
                        rows={2}
                        value={draft.notes}
                        disabled={!canMutate}
                        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      />
                    </label>
                  </div>

                  <div className="clients-links">
                    <header>
                      <Link2 aria-hidden="true" />
                      <div>
                        <strong>Links</strong>
                        <p>Guardian of, pays for, or related — for parents who are also consulting clients, keep kind as guardian and add a consulting tag.</p>
                      </div>
                    </header>
                    {draft.links.length === 0 ? <p className="td-muted">No links yet.</p> : null}
                    <ul className="clients-link-list">
                      {draft.links.map((link, index) => {
                        const other = desk.clients.find((client) => client.id === link.toClientId)
                        return (
                          <li key={`${link.toClientId}-${link.relation}-${index}`}>
                            <span>
                              {CLIENT_LINK_LABELS[link.relation]} · {other?.name ?? 'Unknown'}
                            </span>
                            {canMutate ? (
                              <button
                                type="button"
                                className="attachment-remove"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    links: current.links.filter((_, i) => i !== index),
                                  }))
                                }
                              >
                                Remove
                              </button>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                    {canMutate ? (
                      <div className="clients-link-add">
                        <select value={linkRelation} onChange={(event) => setLinkRelation(event.target.value as ClientLinkRelation)}>
                          {Object.entries(CLIENT_LINK_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)}>
                          <option value="">Choose person…</option>
                          {linkCandidates.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name} · {CLIENT_KIND_LABELS[client.kind]}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!linkTargetId}
                          onClick={() => {
                            if (!linkTargetId) return
                            setDraft((current) => ({
                              ...current,
                              links: [
                                ...current.links.filter(
                                  (link) => !(link.toClientId === linkTargetId && link.relation === linkRelation),
                                ),
                                { toClientId: linkTargetId, relation: linkRelation },
                              ],
                            }))
                            setLinkTargetId('')
                          }}
                        >
                          Add link
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="row-actions">
                    {canMutate ? (
                      <Button
                        type="button"
                        className="create-button"
                        disabled={
                          isPending ||
                          programmeBusy ||
                          !draft.name.trim() ||
                          (creatingProgramme && !customProgrammeName.trim())
                        }
                        onClick={runSave}
                      >
                        {isPending ? 'Saving…' : draft.id ? 'Save changes' : 'Create record'}
                      </Button>
                    ) : null}
                    {draft.id && caps.canDelete ? (
                      <Button type="button" variant="outline" disabled={isPending} onClick={() => runDelete(draft.id)}>
                        Remove
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => {
                        setSelectedId(null)
                        setDraft(blankDraft(focus === 'students' ? 'student' : focus === 'guardians' ? 'guardian' : 'organization'))
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="project-section clients-section clients-curriculum">
              <header className="project-section-head">
                <div>
                  <h2>Curriculum & leads</h2>
                  <p>Programmes for GCS Academy intake. High-level admins assign ops leads who can manage students on those programmes.</p>
                </div>
              </header>

              {caps.canManageCurriculum ? (
                <div className="clients-editor">
                  <div className="clients-form-grid">
                    <label className="form-field clients-span-2">
                      <span>Programme name</span>
                      <input
                        value={programmeDraft.name}
                        onChange={(event) => setProgrammeDraft({ ...programmeDraft, name: event.target.value })}
                        placeholder="e.g. Youth Innovation Track"
                      />
                    </label>
                    <label className="form-field clients-span-2">
                      <span>Description</span>
                      <textarea
                        rows={3}
                        value={programmeDraft.description}
                        onChange={(event) => setProgrammeDraft({ ...programmeDraft, description: event.target.value })}
                      />
                    </label>
                    <label className="form-field">
                      <span>Sort order</span>
                      <input
                        value={programmeDraft.sortOrder}
                        onChange={(event) => setProgrammeDraft({ ...programmeDraft, sortOrder: event.target.value })}
                      />
                    </label>
                    <label className="form-field clients-check">
                      <input
                        type="checkbox"
                        checked={programmeDraft.active}
                        onChange={(event) => setProgrammeDraft({ ...programmeDraft, active: event.target.checked })}
                      />
                      <span>Active for new enrolments</span>
                    </label>
                    <fieldset className="clients-span-2 clients-leads">
                      <legend>Ops / academy leads</legend>
                      <div className="clients-lead-grid">
                        {people.map((person) => {
                          const checked = programmeDraft.leadIds.includes(person.id)
                          return (
                            <label key={person.id} className="clients-lead-chip">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setProgrammeDraft((current) => ({
                                    ...current,
                                    leadIds: checked
                                      ? current.leadIds.filter((id) => id !== person.id)
                                      : [...current.leadIds, person.id],
                                  }))
                                }
                              />
                              <UserAvatar
                                initials={person.initials}
                                url={person.avatarUrl}
                                color={person.avatarColor}
                                size="sm"
                              />
                              <span>
                                {person.firstName} {person.lastName}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </fieldset>
                  </div>
                  <div className="row-actions">
                    <Button
                      type="button"
                      className="create-button"
                      disabled={isPending || !programmeDraft.name.trim()}
                      onClick={runSaveProgramme}
                    >
                      {programmeDraft.id ? 'Update programme' : 'Add programme'}
                    </Button>
                    {programmeDraft.id ? (
                      <Button type="button" variant="outline" onClick={() => setProgrammeDraft(blankProgramme())}>
                        Cancel edit
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="td-muted">You can view programmes you lead. Leadership assigns curriculum and ops leads.</p>
              )}

              <div className="clients-programme-list">
                {programmes.length === 0 ? (
                  <p className="empty-state">No programmes yet. Add the first track to start academy intake.</p>
                ) : (
                  programmes.map((programme) => (
                    <article key={programme.id} className="clients-programme-card">
                      <div>
                        <span className={`clients-kind ${programme.active ? 'kind-image' : 'kind-file'}`}>
                          {programme.active ? 'Active' : 'Paused'}
                        </span>
                        <h3>{programme.name}</h3>
                        {programme.description ? <p>{programme.description}</p> : null}
                        <p className="td-muted">
                          <GraduationCap aria-hidden="true" className="inline-icon" /> {programme.studentCount} student
                          {programme.studentCount === 1 ? '' : 's'}
                          {programme.leadNames.length
                            ? ` · Leads: ${programme.leadNames.join(', ')}`
                            : ' · No leads assigned'}
                        </p>
                      </div>
                      {caps.canManageCurriculum && !programme.id.startsWith('temp-') ? (
                        <div className="row-actions">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              setProgrammeDraft({
                                id: programme.id,
                                name: programme.name,
                                description: programme.description ?? '',
                                active: programme.active,
                                sortOrder: String(programme.sortOrder),
                                leadIds: programme.leadIds,
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isPending}
                            onClick={() => {
                              if (!window.confirm('Remove this programme? Students keep their records.')) return
                              setProgrammes((current) => current.filter((entry) => entry.id !== programme.id))
                              if (draft.programmeId === programme.id) {
                                setDraft((current) => ({ ...current, programmeId: '' }))
                                setProgrammeChoice('')
                              }
                              startTransition(async () => {
                                const result = await deleteAcademyProgramme(programme.id)
                                if ('error' in result && result.error) {
                                  setError(result.error)
                                  onRefresh?.()
                                } else if ('ok' in result && result.ok) {
                                  setNotice(result.notice)
                                  onRefresh?.()
                                }
                              })
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <aside className="clients-footnote">
        <Users aria-hidden="true" />
        <p>
          Invoices stay under Admin office. Bill-to defaults to guardian or organisation for students unless self-pay is
          enabled. Open <strong>Clients</strong> here for the full relationship house.
        </p>
      </aside>
    </div>
  )
}
