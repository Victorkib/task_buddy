'use client'

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Sparkles, X } from 'lucide-react'
import { createTask } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { CategoryField } from '@/components/category-field'
import { TASK_PRIORITY_LABELS } from '@/lib/constants'
import { suggestTaskFields } from '@/lib/task-suggest'
import type { Person } from '@/lib/types'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button className="create-button" type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create task'}
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

export type TaskProjectOption = {
  id: string
  title: string
  departmentId?: string | null
  department?: string | null
  contributingDepartmentIds?: string[]
  teamUserIds?: string[]
  milestones?: Array<{ id: string; title: string }>
}

function personDepartmentId(person: Person & { department?: { id?: string } | null }) {
  return person.departmentId ?? person.department?.id ?? ''
}

function departmentLead(departmentId: string, people: Person[], departments: DepartmentOption[]) {
  const members = people.filter((person) => personDepartmentId(person) === departmentId)
  const namedOwner = departments.find((department) => department.id === departmentId)?.owner
  return (
    members.find(
      (person) => person.firstName === namedOwner?.firstName && person.lastName === namedOwner?.lastName,
    ) ??
    members[0] ??
    null
  )
}

export function CreateTaskDialog({
  people,
  directory = people,
  currentUserId,
  currentUserDepartmentId = '',
  canAssignAcrossDepartments = false,
  canAssignOthers = true,
  departments,
  projects = [],
  defaultDepartmentId = '',
  defaultAssigneeId = '',
  defaultProjectId = '',
  defaultMilestoneId = '',
  lockDepartment = false,
  onClose,
}: {
  people: Person[]
  directory?: Person[]
  currentUserId: string
  currentUserDepartmentId?: string
  canAssignAcrossDepartments?: boolean
  /** When false, assignee stays locked to the current user (IC create). */
  canAssignOthers?: boolean
  departments: DepartmentOption[]
  projects?: TaskProjectOption[]
  defaultDepartmentId?: string
  defaultAssigneeId?: string
  defaultProjectId?: string
  defaultMilestoneId?: string
  lockDepartment?: boolean
  onClose: () => void
}) {
  const allPeople = directory.length > 0 ? directory : people
  const roster = useMemo(
    () =>
      allPeople.map((person) => ({
        ...person,
        departmentId: personDepartmentId(person) || null,
      })),
    [allPeople],
  )
  const defaultLead = defaultDepartmentId ? departmentLead(defaultDepartmentId, roster, departments) : null
  const initialAssignee = !canAssignOthers
    ? currentUserId
    : defaultAssigneeId ||
      (defaultDepartmentId && defaultLead ? defaultLead.id : '') ||
      currentUserId
  const [error, setError] = useState<string | null>(null)
  const [placement, setPlacement] = useState<'project' | 'new' | 'independent'>(
    defaultProjectId || defaultMilestoneId ? 'project' : 'independent',
  )
  const [projectId, setProjectId] = useState(defaultProjectId)
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [newProjectDepartmentId, setNewProjectDepartmentId] = useState(
    defaultDepartmentId || currentUserDepartmentId,
  )
  const [newProjectMilestone, setNewProjectMilestone] = useState('Delivery')
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState(initialAssignee)
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId)
  const [category, setCategory] = useState('operational')
  const [categoryCustom, setCategoryCustom] = useState('')
  const [priority, setPriority] = useState('medium')
  const [startDate, setStartDate] = useState(localIsoDate(0))
  const [dueDate, setDueDate] = useState(localIsoDate(7))
  const [ownerLocked, setOwnerLocked] = useState(!canAssignOthers || Boolean(defaultAssigneeId))
  const [departmentLocked, setDepartmentLocked] = useState(Boolean(defaultDepartmentId) && lockDepartment)
  const [categoryLocked, setCategoryLocked] = useState(false)
  const [priorityLocked, setPriorityLocked] = useState(false)
  const [milestoneId, setMilestoneId] = useState(defaultMilestoneId)

  const selectedProject = projects.find((project) => project.id === projectId) ?? null
  const allowedDepartmentIds = useMemo(() => {
    if (placement === 'independent' && !selectedProject) {
      if (canAssignAcrossDepartments) return null
      return currentUserDepartmentId ? new Set([currentUserDepartmentId]) : new Set<string>()
    }
    if (placement === 'new') {
      const ids = new Set<string>()
      if (newProjectDepartmentId) ids.add(newProjectDepartmentId)
      if (currentUserDepartmentId) ids.add(currentUserDepartmentId)
      return ids
    }
    if (selectedProject) {
      const ids = new Set<string>()
      if (selectedProject.departmentId) ids.add(selectedProject.departmentId)
      for (const id of selectedProject.contributingDepartmentIds ?? []) ids.add(id)
      return ids
    }
    return currentUserDepartmentId ? new Set([currentUserDepartmentId]) : new Set<string>()
  }, [
    canAssignAcrossDepartments,
    placement,
    currentUserDepartmentId,
    newProjectDepartmentId,
    selectedProject,
  ])

  const visibleRoster = useMemo(() => {
    if (!allowedDepartmentIds) return roster
    return roster.filter((person) => {
      if (selectedProject?.teamUserIds?.includes(person.id)) return true
      if (!person.departmentId) return canAssignAcrossDepartments
      return allowedDepartmentIds.has(person.departmentId)
    })
  }, [allowedDepartmentIds, roster, selectedProject, canAssignAcrossDepartments])

  const suggestion = useMemo(
    () => suggestTaskFields(title, visibleRoster, departments),
    [title, visibleRoster, departments],
  )

  const selectedOwner = roster.find((person) => person.id === assigneeId)
  const projectMilestones = selectedProject?.milestones ?? []

  function applySuggestion(next = suggestion, force = false) {
    if ((force || !categoryLocked) && next.category) {
      setCategory(next.category)
      setCategoryCustom('')
    }
    if ((force || !priorityLocked) && next.priority) setPriority(next.priority)
    if ((force || !departmentLocked) && next.departmentId) setDepartmentId(next.departmentId)
    if ((force || !ownerLocked) && next.assigneeId) setAssigneeId(next.assigneeId)
  }

  function onTitleChange(value: string) {
    setTitle(value)
    const next = suggestTaskFields(value, visibleRoster, departments)
    if (!categoryLocked && next.category) {
      setCategory(next.category)
      setCategoryCustom('')
    }
    if (!priorityLocked && next.priority) setPriority(next.priority)
    if (!departmentLocked && next.departmentId) setDepartmentId(next.departmentId)
    if (!ownerLocked && next.assigneeId) setAssigneeId(next.assigneeId)
  }

  function onOwnerChange(value: string) {
    if (!canAssignOthers) return
    setOwnerLocked(true)
    setAssigneeId(value)
    const owner = roster.find((person) => person.id === value)
    if (owner?.departmentId && !lockDepartment) {
      setDepartmentId(owner.departmentId)
      setDepartmentLocked(false)
    }
  }

  function onDepartmentChange(value: string) {
    setDepartmentLocked(true)
    setDepartmentId(value)
  }

  function onProjectChange(value: string) {
    setProjectId(value)
    if (!value) {
      setMilestoneId('')
      return
    }
    const next = projects.find((project) => project.id === value)
    const firstMilestone = next?.milestones?.[0]?.id ?? ''
    setMilestoneId(firstMilestone)
    if (next?.departmentId && !lockDepartment) setDepartmentId(next.departmentId)
  }

  async function action(formData: FormData) {
    formData.set('placement', placement)
    formData.set('assigneeId', canAssignOthers ? assigneeId : currentUserId)
    formData.set('departmentId', departmentId)
    formData.set('category', category)
    formData.set('categoryCustom', categoryCustom)
    formData.set('priority', priority)
    formData.set('startDate', startDate)
    formData.set('dueDate', dueDate)
    if (placement === 'project' || (placement === 'independent' && projectId)) {
      formData.set('placement', 'project')
      formData.set('projectId', projectId)
      if (milestoneId) formData.set('milestoneId', milestoneId)
    } else if (placement === 'new') {
      formData.set('newProjectTitle', newProjectTitle)
      formData.set('newProjectDepartmentId', newProjectDepartmentId)
      formData.set('newProjectMilestone', newProjectMilestone)
    }
    const result = await createTask(formData)
    if (result?.error) {
      setError(result.error)
      return
    }
    onClose()
  }

  const matchCopy = suggestion.reasons.slice(0, 2).join(' · ')

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="create-modal create-task-modal workspace-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form action={action}>
          <div className="modal-heading">
            <div>
              <span className="eyebrow">Assign work</span>
              <h2 id="create-task-title">Create a task</h2>
            </div>
            <button className="close-button" type="button" aria-label="Close dialog" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="workspace-sheet-body">
          <p className="field-hint placement-lede">
            A project is the initiative. A task is one piece of work. If it needs more than one person, more than one
            step, or another department, put it on a project.
          </p>

          <fieldset className="placement-picker">
            <legend>Where does this work live?</legend>
            <label className={`placement-card${placement === 'project' ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="placementChoice"
                checked={placement === 'project'}
                onChange={() => {
                  setPlacement('project')
                  if (!projectId && projects[0]) onProjectChange(projects[0].id)
                }}
              />
              <span>
                <strong>Existing project</strong>
                <small>Add this task under an initiative already in flight.</small>
              </span>
            </label>
            <label className={`placement-card${placement === 'new' ? ' is-on' : ''}`}>
              <input type="radio" name="placementChoice" checked={placement === 'new'} onChange={() => setPlacement('new')} />
              <span>
                <strong>Create a project</strong>
                <small>Start the container now, then this task becomes the first piece of work.</small>
              </span>
            </label>
            <label className={`placement-card${placement === 'independent' ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="placementChoice"
                checked={placement === 'independent'}
                onChange={() => {
                  setPlacement('independent')
                  setProjectId('')
                  setMilestoneId('')
                }}
              />
              <span>
                <strong>Independent task</strong>
                <small>One-off work. You can still optionally attach it to a project.</small>
              </span>
            </label>
          </fieldset>

          {placement === 'independent' && projects.length > 0 && (
            <div className="form-grid">
              <label>
                Link to a project (optional)
                <select value={projectId} onChange={(event) => onProjectChange(event.target.value)}>
                  <option value="">Keep independent</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                      {project.department ? ` · ${project.department}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {projectId && projectMilestones.length > 0 && (
                <label>
                  Milestone
                  <select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}>
                    <option value="">Not on a milestone yet</option>
                    {projectMilestones.map((milestone) => (
                      <option key={milestone.id} value={milestone.id}>
                        {milestone.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {placement === 'project' && (
            <div className="form-grid">
              <label>
                Project
                <select value={projectId} onChange={(event) => onProjectChange(event.target.value)} required>
                  <option value="">Select a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                      {project.department ? ` · ${project.department}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {projectMilestones.length > 0 && (
                <label>
                  Milestone
                  <select value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)}>
                    <option value="">Not on a milestone yet</option>
                    {projectMilestones.map((milestone) => (
                      <option key={milestone.id} value={milestone.id}>
                        {milestone.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {placement === 'new' && (
            <div className="form-grid">
              <label>
                Project name
                <input
                  value={newProjectTitle}
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                  required
                  placeholder="e.g. Task Buddy rollout"
                />
              </label>
              <label>
                Home department
                <select
                  value={newProjectDepartmentId}
                  onChange={(event) => setNewProjectDepartmentId(event.target.value)}
                  required
                >
                  <option value="">Select the accountable function</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                First milestone
                <input
                  value={newProjectMilestone}
                  onChange={(event) => setNewProjectMilestone(event.target.value)}
                  placeholder="Delivery"
                />
              </label>
            </div>
          )}

          <label htmlFor="task-title">Task name</label>
          <input
            id="task-title"
            name="title"
            type="text"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            autoFocus
            required
            placeholder="e.g. UMGM tenders or Harden Task Buddy access"
          />

          {title.trim() && matchCopy && (
            <p className="task-match-hint">
              <Sparkles aria-hidden="true" />
              <span>{matchCopy}</span>
              <button type="button" className="text-back" onClick={() => applySuggestion(suggestion, true)}>
                Re-apply match
              </button>
            </p>
          )}

          <div className="form-grid">
            <label>
              Led by
              {!canAssignOthers ? (
                <>
                  <input
                    value={
                      selectedOwner
                        ? `${selectedOwner.firstName} ${selectedOwner.lastName}`
                        : 'You'
                    }
                    readOnly
                    aria-readonly="true"
                  />
                  <span className="field-hint">You own work you create. Ask a manager or head to assign tasks to others.</span>
                </>
              ) : (
                <select value={assigneeId} onChange={(event) => onOwnerChange(event.target.value)}>
                  {departments.map((department) => {
                    const members = visibleRoster.filter((person) => person.departmentId === department.id)
                    if (members.length === 0) return null
                    return (
                      <optgroup key={department.id} label={department.name}>
                        {members.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.firstName} {person.lastName} · {person.jobTitle}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                  {visibleRoster.some((person) => !person.departmentId) && (
                    <optgroup label="Unassigned">
                      {visibleRoster
                        .filter((person) => !person.departmentId)
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.firstName} {person.lastName} · {person.jobTitle}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              )}
            </label>
            <label>
              Department
              <select
                value={departmentId}
                disabled={lockDepartment && placement === 'independent'}
                onChange={(event) => onDepartmentChange(event.target.value)}
              >
                <option value="">Match to lead</option>
                {departments
                  .filter((department) => !allowedDepartmentIds || allowedDepartmentIds.has(department.id))
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </select>
            </label>
            <CategoryField
              value={category}
              customValue={categoryCustom}
              onChange={(nextCategory, nextCustom) => {
                setCategoryLocked(true)
                setCategory(nextCategory)
                setCategoryCustom(nextCustom)
              }}
            />
            <label>
              Priority
              <select
                value={priority}
                onChange={(event) => {
                  setPriorityLocked(true)
                  setPriority(event.target.value)
                }}
              >
                {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date
              <input type="date" name="startDate" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              Due date
              <input type="date" name="dueDate" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
          </div>

          {selectedOwner && (
            <p className="task-assign-preview">
              Led by <strong>{selectedOwner.firstName} {selectedOwner.lastName}</strong>
              {selectedOwner.jobTitle ? ` · ${selectedOwner.jobTitle}` : ''}
              {departmentId ? ' in this department' : ''}
              {placement === 'independent' && !selectedProject ? '. Independent of a project.' : ''}
              {selectedProject ? ` on ${selectedProject.title}.` : ''}
              {`. Due ${dueDate || 'unscheduled'}.`}
            </p>
          )}

          <label htmlFor="task-description">Description</label>
          <textarea
            id="task-description"
            name="description"
            placeholder="Outcome, context, and what done looks like..."
          />
          {error && <p className="form-error">{error}</p>}
          </div>
          <div className="modal-actions workspace-sheet-footer">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton />
          </div>
        </form>
      </div>
    </div>
  )
}
