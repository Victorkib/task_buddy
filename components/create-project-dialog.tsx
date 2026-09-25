'use client'

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { createProject } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { ledBy } from '@/lib/format'
import type { Person } from '@/lib/types'

const STEPS = [
  { id: 1, label: 'Basics' },
  { id: 2, label: 'Lead & partner' },
  { id: 3, label: 'Timeline' },
  { id: 4, label: 'Team' },
] as const

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button className="create-button" type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create project'}
    </Button>
  )
}

function localIsoDate(daysFromToday = 0) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

type DepartmentOption = { id: string; name: string; owner?: { firstName: string; lastName: string } | null }

function personDepartmentId(person: Person) {
  return person.departmentId ?? ''
}

export function CreateProjectDialog({
  people,
  directory = people,
  currentUserId,
  departments,
  lockLeadToSelf = false,
  onClose,
}: {
  people: Person[]
  directory?: Person[]
  currentUserId: string
  departments: DepartmentOption[]
  /** Employees lead their own projects — hierarchy stays with managers/heads. */
  lockLeadToSelf?: boolean
  onClose: (projectId?: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [ownerId, setOwnerId] = useState(currentUserId)
  const [partnerId, setPartnerId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [status, setStatus] = useState('active')
  const [milestoneTitle, setMilestoneTitle] = useState('Delivery')
  const [startDate, setStartDate] = useState(localIsoDate(0))
  const [dueDate, setDueDate] = useState(localIsoDate(30))
  const [teamIds, setTeamIds] = useState<string[]>([currentUserId])
  const [contributingDepartmentIds, setContributingDepartmentIds] = useState<string[]>([])

  const owner = people.find((person) => person.id === ownerId) ?? directory.find((person) => person.id === ownerId)
  const partner =
    partnerId
      ? people.find((person) => person.id === partnerId) ?? directory.find((person) => person.id === partnerId)
      : null
  const department = departments.find((entry) => entry.id === departmentId)
  const allowedDepartmentIds = useMemo(() => {
    const ids = new Set<string>()
    if (departmentId) ids.add(departmentId)
    for (const id of contributingDepartmentIds) ids.add(id)
    return ids
  }, [departmentId, contributingDepartmentIds])
  const teamPeople = useMemo(() => {
    const source = directory.length > 0 ? directory : people
    return source.filter((person) => {
      if (person.id === ownerId || teamIds.includes(person.id)) return true
      const deptId = personDepartmentId(person)
      return !deptId || allowedDepartmentIds.has(deptId)
    })
  }, [directory, people, ownerId, teamIds, allowedDepartmentIds])
  const departmentPeople = useMemo(
    () => (departmentId ? people.filter((person) => personDepartmentId(person) === departmentId) : people),
    [departmentId, people],
  )
  const partnerPool = useMemo(() => {
    const source = departmentPeople.length > 0 ? departmentPeople : people
    return source.filter((person) => person.id !== ownerId)
  }, [departmentPeople, people, ownerId])

  function applyDepartment(nextId: string) {
    setDepartmentId(nextId)
    if (lockLeadToSelf) {
      setOwnerId(currentUserId)
      setPartnerId((current) => (current && current !== currentUserId ? current : ''))
      const members = people.filter((person) => personDepartmentId(person) === nextId)
      const nextTeam = new Set(members.map((person) => person.id))
      nextTeam.add(currentUserId)
      setTeamIds([...nextTeam])
      return
    }
    const named = departments.find((entry) => entry.id === nextId)?.owner
    const members = people.filter((person) => personDepartmentId(person) === nextId)
    const lead =
      members.find((person) => person.firstName === named?.firstName && person.lastName === named?.lastName) ??
      members[0]
    if (lead) setOwnerId(lead.id)
    setPartnerId((current) => (current && current !== lead?.id ? current : ''))
    const nextTeam = new Set(members.map((person) => person.id))
    nextTeam.add(lead?.id ?? currentUserId)
    setTeamIds([...nextTeam])
  }

  function toggleTeam(id: string) {
    setTeamIds((current) => {
      if (id === ownerId) return current
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    })
  }

  function goNext() {
    setError(null)
    if (step === 1 && !title.trim()) {
      setError('A project name is required.')
      return
    }
    if (step === 2 && !departmentId) {
      setError('Select the department this project belongs to.')
      return
    }
    if (step === 3 && startDate && dueDate && dueDate < startDate) {
      setError('Due date cannot be before the start date.')
      return
    }
    setStep((current) => Math.min(current + 1, 4))
  }

  async function action(formData: FormData) {
    formData.set('title', title.trim())
    formData.set('description', description)
    formData.set('ownerId', lockLeadToSelf ? currentUserId : ownerId)
    formData.set('partnerId', partnerId)
    formData.set('departmentId', departmentId)
    formData.set('status', status)
    formData.set('milestoneTitle', milestoneTitle.trim() || 'Delivery')
    formData.set('startDate', startDate)
    formData.set('dueDate', dueDate)
    formData.delete('teamUserIds')
    const uniqueTeam = new Set([...teamIds, ownerId, ...(partnerId ? [partnerId] : [])])
    for (const id of uniqueTeam) formData.append('teamUserIds', id)
    formData.delete('contributingDepartmentIds')
    for (const id of contributingDepartmentIds) formData.append('contributingDepartmentIds', id)
    const result = await createProject(formData)
    if (result && 'error' in result && result.error) {
      setError(result.error)
      return
    }
    onClose(result && 'id' in result ? result.id : undefined)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => onClose()}>
      <div
          className="create-modal create-project-modal workspace-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form action={action}>
          <div className="modal-heading">
            <div>
              <span className="eyebrow">Projects</span>
              <h2 id="create-project-title">Create a project</h2>
            </div>
            <button className="close-button" type="button" aria-label="Close dialog" onClick={() => onClose()}>
              <X aria-hidden="true" />
            </button>
          </div>

          <ol className="wizard-steps" aria-label="Project setup steps">
            {STEPS.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`wizard-step${step === entry.id ? ' is-active' : ''}${step > entry.id ? ' is-done' : ''}`}
                  onClick={() => {
                    if (entry.id < step) setStep(entry.id)
                  }}
                >
                  <span>{step > entry.id ? <Check aria-hidden="true" /> : entry.id}</span>
                  {entry.label}
                </button>
              </li>
            ))}
          </ol>

          <div className="wizard-body">
            {step === 1 && (
              <>
                <label htmlFor="project-title">Project name</label>
                <input
                  id="project-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                  required
                  placeholder="e.g. Q4 client onboarding readiness"
                />
                <label htmlFor="project-description">What does success look like?</label>
                <textarea
                  id="project-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Outcomes, scope, and who this is for..."
                />
              </>
            )}

            {step === 2 && (
              <div className="form-grid">
                <label>
                  Department
                  <select value={departmentId} onChange={(event) => applyDepartment(event.target.value)}>
                    <option value="">Select the home team</option>
                    {departments.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Led by
                  {lockLeadToSelf ? (
                    <>
                      <input
                        value={owner ? `${owner.firstName} ${owner.lastName}` : 'You'}
                        readOnly
                        aria-readonly="true"
                      />
                      <span className="field-hint">You lead projects you create. Managers and heads assign leads for the department.</span>
                    </>
                  ) : (
                    <select
                      value={ownerId}
                      onChange={(event) => {
                        const next = event.target.value
                        setOwnerId(next)
                        setTeamIds((current) => (current.includes(next) ? current : [...current, next]))
                        if (partnerId === next) setPartnerId('')
                      }}
                    >
                      {(departmentPeople.length > 0 ? departmentPeople : people).map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.firstName} {person.lastName}
                          {person.jobTitle ? ` · ${person.jobTitle}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label>
                  Lead partner
                  <select
                    value={partnerId}
                    onChange={(event) => {
                      const next = event.target.value
                      setPartnerId(next)
                      if (next) {
                        setTeamIds((current) => (current.includes(next) ? current : [...current, next]))
                      }
                    }}
                  >
                    <option value="">Optional co-lead</option>
                    {partnerPool.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.firstName} {person.lastName}
                        {person.jobTitle ? ` · ${person.jobTitle}` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">Delivery co-owner only — not a reporting-line change.</span>
                </label>
                {department && (
                  <p className="task-assign-preview" style={{ gridColumn: '1 / -1' }}>
                    {ledBy(owner ? `${owner.firstName} ${owner.lastName}` : null)}
                    {partner ? ` with ${partner.firstName} ${partner.lastName}` : ''} in {department.name}.
                    Team members from this department are suggested next.
                  </p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="form-grid">
                <label>
                  First milestone
                  <input value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} placeholder="Delivery" />
                </label>
                <label>
                  Status
                  <select value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
                <label>
                  Start date
                  <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
                <label>
                  Due date
                  <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                </label>
              </div>
            )}

            {step === 4 && (
              <>
                <p className="task-assign-preview" style={{ marginBottom: 12 }}>
                  {title.trim() || 'Untitled'} · {department?.name ?? 'No department'} ·{' '}
                  {ledBy(owner ? `${owner.firstName} ${owner.lastName}` : null)}
                  {partner ? ` · Partner: ${partner.firstName} ${partner.lastName}` : ''}
                </p>
                <fieldset className="team-picker">
                  <legend>Contributing departments</legend>
                  <p className="field-hint">Bring in another function as secondary. They see their slice; your department stays accountable.</p>
                  <div className="team-picker-grid">
                    {departments
                      .filter((entry) => entry.id !== departmentId)
                      .map((entry) => {
                        const checked = contributingDepartmentIds.includes(entry.id)
                        return (
                          <label key={entry.id} className={`team-chip${checked ? ' is-on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setContributingDepartmentIds((current) =>
                                  current.includes(entry.id)
                                    ? current.filter((id) => id !== entry.id)
                                    : [...current, entry.id],
                                )
                              }
                            />
                            <span>
                              <strong>{entry.name}</strong>
                              <small>Secondary</small>
                            </span>
                          </label>
                        )
                      })}
                  </div>
                </fieldset>
                <fieldset className="team-picker">
                  <legend>Project team</legend>
                  <div className="team-picker-grid">
                    {teamPeople.map((person) => {
                      const checked = teamIds.includes(person.id) || person.id === ownerId
                      return (
                        <label key={person.id} className={`team-chip${checked ? ' is-on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={person.id === ownerId}
                            onChange={() => toggleTeam(person.id)}
                          />
                          <span>
                            <strong>
                              {person.firstName} {person.lastName}
                            </strong>
                            <small>{person.jobTitle}</small>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              </>
            )}
          </div>

          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions workspace-sheet-footer">
            {step === 1 ? (
              <Button variant="outline" type="button" onClick={() => onClose()}>
                Cancel
              </Button>
            ) : (
              <Button variant="outline" type="button" onClick={() => { setError(null); setStep((current) => current - 1) }}>
                <ArrowLeft aria-hidden="true" /> Back
              </Button>
            )}
            {step < 4 ? (
              <Button className="create-button" type="button" onClick={goNext}>
                Continue <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <SubmitButton />
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
