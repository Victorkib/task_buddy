'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import {
  addProjectDepartment,
  addProjectMilestone,
  addProjectTeamMember,
  deleteProject,
  deleteProjectMilestone,
  deleteTask,
  removeProjectDepartment,
  removeProjectTeamMember,
  setTaskPlacement,
  unlinkTaskFromMilestone,
  updateProjectDetails,
  updateProjectMilestone,
} from '@/app/actions'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { UserAvatar } from '@/components/user-avatar'
import { TASK_STATUS_LABELS } from '@/lib/constants'
import { formatDue, formatRelative, ledBy } from '@/lib/format'
import type { Person } from '@/lib/types'

type Milestone = {
  id: string
  title: string
  status: string
  startDate?: string | Date | null
  dueDate: string | Date | null
  progress: number
  taskIds: string[]
}

type ProjectActivity = {
  id: string
  summary: string
  createdAt: string | Date
  actor?: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
}

type Project = {
  id: string
  title: string
  description?: string | null
  owner: string
  ownerId?: string
  partnerId?: string | null
  partner?: string | null
  departmentId?: string | null
  department?: string | null
  projectStatus?: string
  progress: number
  completionRate: number
  status: string
  health?: string
  risk: string
  overdueCount: number
  blockedCount: number
  tasks: string
  taskIds?: string[]
  unscheduledTaskIds?: string[]
  contributingDepartments?: Array<{ id: string; name: string }>
  participation?: 'home' | 'contributing' | 'member'
  milestones?: Milestone[]
  team?: Array<{ id: string; firstName: string; lastName: string; initials: string; avatarUrl?: string | null; avatarColor?: string | null }>
  activity?: ProjectActivity[]
}

type WorkspaceTask = {
  id: string
  title: string
  status: string
  dueDate: string | Date | null
  assignee: { firstName: string; lastName: string } | null
  projectId?: string | null
}

type DepartmentOption = { id: string; name: string }

type ConfirmState =
  | { kind: 'unlink'; milestoneId: string; taskId: string; taskTitle: string; milestoneTitle: string }
  | { kind: 'remove-member'; userId: string; name: string }
  | { kind: 'remove-department'; departmentId: string; name: string }
  | {
      kind: 'delete-milestone'
      milestoneId: string
      title: string
      linkedCount: number
      rehomeMilestoneId: string
    }
  | { kind: 'delete-task'; taskId: string; title: string }
  | { kind: 'delete-project'; deleteLinkedTasks: boolean }

function localIsoDate(daysFromToday = 0) {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateInputValue(value: string | Date | null | undefined) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function datesAreValid(startDate: string, dueDate: string) {
  if (startDate && dueDate && dueDate < startDate) return false
  return true
}

export function ProjectWorkspace({
  project,
  people,
  departments,
  tasks,
  canManage,
  canCreateWork,
  lockLeadToSelf = false,
  onBack,
  onCreateTask,
  onOpenTask,
  onProjectDeleted,
  onTaskRemoved,
  canDeleteLinkedTask,
  onTaskLinked,
}: {
  project: Project
  people: Person[]
  departments: DepartmentOption[]
  tasks: WorkspaceTask[]
  canManage: boolean
  canCreateWork: boolean
  lockLeadToSelf?: boolean
  onBack: () => void
  onCreateTask: (milestoneId: string) => void
  onOpenTask: (taskId: string) => void
  onProjectDeleted: () => void
  onTaskRemoved: (taskId: string) => void
  canDeleteLinkedTask: (taskId: string) => boolean
  onTaskLinked?: (taskId: string, placement: { projectId: string; milestoneId: string | null }) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description ?? '')
  const [projectStatus, setProjectStatus] = useState(project.projectStatus ?? 'active')
  const [ownerId, setOwnerId] = useState(project.ownerId ?? '')
  const [partnerId, setPartnerId] = useState(project.partnerId ?? '')
  const [departmentId, setDepartmentId] = useState(project.departmentId ?? '')
  const [milestoneTitle, setMilestoneTitle] = useState('')
  const [milestoneStart, setMilestoneStart] = useState('')
  const [milestoneDue, setMilestoneDue] = useState('')
  const [linkMilestoneId, setLinkMilestoneId] = useState(project.milestones?.[0]?.id ?? '')
  const [linkTaskId, setLinkTaskId] = useState('')
  const [addUserId, setAddUserId] = useState('')
  const [addDepartmentId, setAddDepartmentId] = useState('')
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  useEffect(() => {
    setTitle(project.title)
    setDescription(project.description ?? '')
    setProjectStatus(project.projectStatus ?? 'active')
    setOwnerId(project.ownerId ?? '')
    setPartnerId(project.partnerId ?? '')
    setDepartmentId(project.departmentId ?? '')
    setLinkMilestoneId((current) =>
      project.milestones?.some((milestone) => milestone.id === current)
        ? current
        : (project.milestones?.[0]?.id ?? ''),
    )
    setMilestoneStart((current) => current || localIsoDate(0))
    setMilestoneDue((current) => current || localIsoDate(14))
  }, [project])

  const linkedIds = new Set(project.taskIds ?? [])
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const linkableTasks = tasks.filter((task) => !task.projectId && !linkedIds.has(task.id))
  const teamIds = new Set((project.team ?? []).map((member) => member.id))
  const addablePeople = people.filter((person) => !teamIds.has(person.id))
  const contributingIds = new Set((project.contributingDepartments ?? []).map((entry) => entry.id))
  const addableDepartments = departments.filter(
    (department) => department.id !== project.departmentId && !contributingIds.has(department.id),
  )
  const unscheduledTasks = (project.unscheduledTaskIds ?? [])
    .map((taskId) => byId.get(taskId))
    .filter((task): task is NonNullable<typeof task> => Boolean(task))
  const defaultMilestoneId = project.milestones?.[0]?.id ?? ''
  const canAddMilestone =
    Boolean(milestoneTitle.trim()) && datesAreValid(milestoneStart, milestoneDue)
  const leadPerson = people.find((person) => person.id === ownerId)
  const canSaveProject = Boolean(title.trim() && ownerId && departmentId)
  const canLinkTask = Boolean(linkTaskId)
  const canLinkExisting = canManage || canCreateWork
  const linkedTaskCount = project.taskIds?.length ?? 0

  function run(action: () => Promise<{ error?: string } | { ok?: boolean } | void>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result && 'error' in result && result.error) setError(result.error)
      else setConfirm(null)
    })
  }

  return (
    <div className="project-workspace">
      <div className="project-workspace-top">
        <button type="button" className="text-back" onClick={onBack}>
          Back to portfolio
        </button>
        <div className="project-workspace-heading">
          <div>
            <span className="eyebrow">Project workspace</span>
            <h1>{project.title}</h1>
            <p>
              {ledBy(project.owner)}
              {project.partner ? ` · Partner: ${project.partner}` : ''}
              {project.department ? ` · Home: ${project.department}` : ''}
              {(project.contributingDepartments ?? []).length > 0
                ? ` · Contributing: ${project.contributingDepartments?.map((entry) => entry.name).join(', ')}`
                : ''}
            </p>
            {project.participation === 'contributing' ? (
              <p className="project-workspace-summary">Your department is contributing. You can run your slice of the work.</p>
            ) : null}
            {project.description ? <p className="project-workspace-summary">{project.description}</p> : null}
          </div>
          <div className="project-workspace-actions">
            <StatusBadge status={project.health ?? project.status} />
            <StatusBadge status={project.risk} />
            {project.participation === 'contributing' ? <StatusBadge status="Contributing" /> : null}
            {project.participation === 'home' ? <StatusBadge status="Home" /> : null}
            {canManage && (
              <Button variant="outline" type="button" onClick={() => setEditing((current) => !current)}>
                {editing ? 'Close editor' : 'Edit project'}
              </Button>
            )}
            {canCreateWork && defaultMilestoneId && (
              <Button className="create-button" type="button" onClick={() => onCreateTask(defaultMilestoneId)}>
                <Plus data-icon="inline-start" /> Create task
              </Button>
            )}
            {canManage && (
              <Button
                variant="destructive"
                type="button"
                onClick={() => setConfirm({ kind: 'delete-project', deleteLinkedTasks: false })}
              >
                Delete project
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="project-health-row">
        <div>
          <strong>{project.completionRate}%</strong>
          <span>linked completion</span>
        </div>
        <div>
          <strong>{project.tasks}</strong>
          <span>linked tasks</span>
        </div>
        <div>
          <strong>{project.overdueCount}</strong>
          <span>overdue</span>
        </div>
        <div>
          <strong>{project.blockedCount}</strong>
          <span>stuck</span>
        </div>
        <div>
          <strong>{(project.milestones ?? []).length}</strong>
          <span>milestones</span>
        </div>
      </div>
      <div className="progress-track project-workspace-track">
        <div className="progress-fill fill-teal" style={{ width: `${project.progress}%` }} />
      </div>

      {error && <p className="form-error">{error}</p>}

      {editing && canManage && (
        <section className="panel project-edit-panel">
          <div className="panel-heading">
            <div>
              <h2>Project settings</h2>
              <p>Name, lead, home department, and lifecycle.</p>
            </div>
          </div>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault()
              if (!canSaveProject) {
                setError('Name, lead, and department are required.')
                return
              }
              run(() =>
                updateProjectDetails({
                  projectId: project.id,
                  title,
                  description,
                  status: projectStatus as 'active' | 'paused' | 'completed' | 'archived',
                  ownerId,
                  partnerId: partnerId || null,
                  departmentId,
                }),
              )
            }}
          >
            <label>
              Name
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <label>
              Status
              <select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>
              Led by
              {lockLeadToSelf ? (
                <>
                  <input
                    value={leadPerson ? `${leadPerson.firstName} ${leadPerson.lastName}` : project.owner}
                    readOnly
                    aria-readonly="true"
                  />
                  <span className="field-hint">You stay the project lead. Ask a manager or head to reassign leadership.</span>
                </>
              ) : (
                <select
                  value={ownerId}
                  onChange={(event) => {
                    const next = event.target.value
                    setOwnerId(next)
                    if (partnerId === next) setPartnerId('')
                  }}
                >
                  {people.map((person) => (
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
              <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
                <option value="">Optional co-lead</option>
                {people
                  .filter((person) => person.id !== ownerId)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.firstName} {person.lastName}
                      {person.jobTitle ? ` · ${person.jobTitle}` : ''}
                    </option>
                  ))}
              </select>
              <span className="field-hint">Delivery co-owner only — not a reporting-line change.</span>
            </label>
            <label>
              Home department
              <select
                value={departmentId}
                disabled={lockLeadToSelf}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              {lockLeadToSelf ? (
                <span className="field-hint">Projects you create stay in your department.</span>
              ) : null}
            </label>
            <label className="span-2">
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </label>
            <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button className="create-button" type="submit" disabled={isPending || !canSaveProject}>
                Save project
              </Button>
            </div>
          </form>
        </section>
      )}

      <div className="project-workspace-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Milestones</h2>
              <p>Chosen work lives on a milestone, not the whole department.</p>
            </div>
          </div>
          <div className="milestone-list">
            {(project.milestones ?? []).map((milestone) => {
              const editingThis = editingMilestoneId === milestone.id
              return (
                <div className="milestone-block" key={milestone.id}>
                  <div className="milestone-head">
                    <div className="responsibility-main">
                      <strong>{milestone.title}</strong>
                      <span>
                        {milestone.dueDate ? formatDue(milestone.dueDate) : 'No due date'} · {milestone.taskIds.length}{' '}
                        linked · {milestone.progress}%
                      </span>
                    </div>
                    <StatusBadge status={milestone.status} />
                    <div className="milestone-actions">
                      {canCreateWork && (
                        <Button variant="outline" type="button" onClick={() => onCreateTask(milestone.id)}>
                          Add task
                        </Button>
                      )}
                      {canManage && (
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() => setEditingMilestoneId(editingThis ? null : milestone.id)}
                        >
                          {editingThis ? 'Done' : 'Edit'}
                        </Button>
                      )}
                      {canManage && (
                        <Button
                          variant="outline"
                          type="button"
                          onClick={() =>
                            setConfirm({
                              kind: 'delete-milestone',
                              milestoneId: milestone.id,
                              title: milestone.title,
                              linkedCount: milestone.taskIds.length,
                              rehomeMilestoneId:
                                (project.milestones ?? []).find((entry) => entry.id !== milestone.id)?.id ?? '',
                            })
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                  {editingThis && canManage && (
                    <MilestoneEditor
                      milestone={milestone}
                      disabled={isPending}
                      onSave={(next) =>
                        run(() =>
                          updateProjectMilestone({
                            milestoneId: milestone.id,
                            ...next,
                          }),
                        )
                      }
                    />
                  )}
                  <div className="milestone-tasks">
                    {milestone.taskIds.length === 0 && <p className="empty-state empty-state-compact">No tasks linked yet.</p>}
                    {milestone.taskIds.map((taskId) => {
                      const task = byId.get(taskId)
                      if (!task) return null
                      return (
                        <div className="milestone-task-row" key={taskId}>
                          <button type="button" className="text-back" onClick={() => onOpenTask(taskId)}>
                            {task.title}
                          </button>
                          <span>
                            {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS] ?? task.status}
                            {task.assignee ? ` · ${task.assignee.firstName} ${task.assignee.lastName}` : ''}
                          </span>
                          {canManage && (
                            <button
                              type="button"
                              className="row-action"
                              disabled={isPending}
                              onClick={() =>
                                setConfirm({
                                  kind: 'unlink',
                                  milestoneId: milestone.id,
                                  taskId,
                                  taskTitle: task.title,
                                  milestoneTitle: milestone.title,
                                })
                              }
                            >
                              Unlink
                            </button>
                          )}
                          {canDeleteLinkedTask(taskId) && (
                            <button
                              type="button"
                              className="row-action row-action-danger"
                              disabled={isPending}
                              onClick={() =>
                                setConfirm({
                                  kind: 'delete-task',
                                  taskId,
                                  title: task.title,
                                })
                              }
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {(project.milestones ?? []).length === 0 && <p className="empty-state">No milestones yet.</p>}
            {unscheduledTasks.length > 0 && (
              <div className="milestone-block">
                <div className="milestone-head">
                  <div className="responsibility-main">
                    <strong>Not on a milestone</strong>
                    <span>Still on this project</span>
                  </div>
                </div>
                <div className="milestone-tasks">
                  {unscheduledTasks.map((task) => (
                    <div className="milestone-task-row" key={task.id}>
                      <button type="button" className="text-back" onClick={() => onOpenTask(task.id)}>
                        {task.title}
                      </button>
                      <span>{TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS] ?? task.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {canManage && (
            <form
              className="milestone-add"
              onSubmit={(event) => {
                event.preventDefault()
                if (!canAddMilestone) {
                  setError('Enter a milestone name. Due date cannot be before the start date.')
                  return
                }
                const data = new FormData()
                data.set('projectId', project.id)
                data.set('title', milestoneTitle.trim())
                data.set('startDate', milestoneStart)
                data.set('dueDate', milestoneDue)
                run(async () => {
                  const result = await addProjectMilestone(data)
                  if (!result?.error) {
                    setMilestoneTitle('')
                    setMilestoneStart(localIsoDate(0))
                    setMilestoneDue(localIsoDate(14))
                  }
                  return result
                })
              }}
            >
              <input
                value={milestoneTitle}
                onChange={(event) => setMilestoneTitle(event.target.value)}
                placeholder="Milestone name"
                aria-label="Milestone name"
              />
              <input type="date" value={milestoneStart} onChange={(event) => setMilestoneStart(event.target.value)} aria-label="Milestone start date" />
              <input type="date" value={milestoneDue} onChange={(event) => setMilestoneDue(event.target.value)} aria-label="Milestone due date" />
              <Button className="create-button" type="submit" disabled={isPending || !canAddMilestone}>
                Add
              </Button>
            </form>
          )}
          {canManage && !datesAreValid(milestoneStart, milestoneDue) && (
            <p className="form-error">Due date cannot be before the start date.</p>
          )}

          {canLinkExisting && (
            <form
              className="link-existing"
              onSubmit={(event) => {
                event.preventDefault()
                if (!canLinkTask) {
                  setError('Choose an independent task to bring onto this project.')
                  return
                }
                run(async () => {
                  const result = await setTaskPlacement({
                    taskId: linkTaskId,
                    projectId: project.id,
                    milestoneId: linkMilestoneId || null,
                  })
                  if (!result || 'error' in result) return result
                  onTaskLinked?.(linkTaskId, { projectId: project.id, milestoneId: linkMilestoneId || null })
                  setLinkTaskId('')
                  return result
                })
              }}
            >
              <label>
                Link independent work
                <select value={linkMilestoneId} onChange={(event) => setLinkMilestoneId(event.target.value)}>
                  <option value="">On the project only</option>
                  {(project.milestones ?? []).map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Task
                <select value={linkTaskId} onChange={(event) => setLinkTaskId(event.target.value)}>
                  <option value="">{linkableTasks.length === 0 ? 'No independent tasks to link' : 'Select a task…'}</option>
                  {linkableTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="outline" type="submit" disabled={isPending || !canLinkTask}>
                Link task
              </Button>
            </form>
          )}
        </section>

        <div className="project-side-stack">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Departments</h2>
                <p>Home owns the project. Contributing functions run their slice.</p>
              </div>
            </div>
            <div className="employee-list">
              {project.department ? (
                <div className="employee-row">
                  <div className="employee-main">
                    <strong>{project.department}</strong>
                    <span>Home</span>
                  </div>
                </div>
              ) : null}
              {(project.contributingDepartments ?? []).map((entry) => (
                <div className="employee-row" key={entry.id}>
                  <div className="employee-main">
                    <strong>{entry.name}</strong>
                    <span>Contributing</span>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      className="row-action"
                      disabled={isPending}
                      onClick={() => setConfirm({ kind: 'remove-department', departmentId: entry.id, name: entry.name })}
                    >
                      <X aria-hidden="true" /> Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canManage && addableDepartments.length > 0 && (
              <form
                className="team-add"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!addDepartmentId) return
                  run(async () => {
                    const result = await addProjectDepartment(project.id, addDepartmentId)
                    if (!result?.error) setAddDepartmentId('')
                    return result
                  })
                }}
              >
                <select value={addDepartmentId} onChange={(event) => setAddDepartmentId(event.target.value)}>
                  <option value="">Bring in a department…</option>
                  {addableDepartments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
                <Button variant="outline" type="submit" disabled={isPending || !addDepartmentId}>
                  Add
                </Button>
              </form>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Team</h2>
                <p>The lead stays on the roster.</p>
              </div>
            </div>
            <div className="employee-list">
              {(project.team ?? []).map((member) => (
                <div className="employee-row" key={member.id}>
                  <UserAvatar
                    initials={member.initials}
                    url={member.avatarUrl}
                    color={member.avatarColor}
                    size="sm"
                  />
                  <div className="employee-main">
                    <strong>
                      {member.firstName} {member.lastName}
                    </strong>
                    <span>{member.id === project.ownerId ? 'Project lead' : 'Teammate'}</span>
                  </div>
                  {canManage && member.id !== project.ownerId && (
                    <button
                      type="button"
                      className="row-action"
                      disabled={isPending}
                      onClick={() =>
                        setConfirm({
                          kind: 'remove-member',
                          userId: member.id,
                          name: `${member.firstName} ${member.lastName}`,
                        })
                      }
                    >
                      <X aria-hidden="true" /> Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canManage && (
              <form
                className="team-add"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!addUserId) return
                  run(async () => {
                    const result = await addProjectTeamMember(project.id, addUserId)
                    if (!result?.error) setAddUserId('')
                    return result
                  })
                }}
              >
                <select value={addUserId} onChange={(event) => setAddUserId(event.target.value)}>
                  <option value="">Add teammate…</option>
                  {addablePeople.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.firstName} {person.lastName}
                    </option>
                  ))}
                </select>
                <Button variant="outline" type="submit" disabled={isPending || !addUserId}>
                  Add
                </Button>
              </form>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Activity</h2>
                <p>Project changes and linked task movement.</p>
              </div>
            </div>
            <div className="activity-list">
              {(project.activity ?? []).map((event) => (
                <div className="activity-row" key={event.id}>
                  <UserAvatar
                    initials={event.actor?.initials ?? '—'}
                    url={event.actor?.avatarUrl}
                    color={event.actor?.avatarColor}
                    size="sm"
                  />
                  <div className="activity-copy">
                    <strong>
                      {event.actor ? `${event.actor.firstName} ${event.actor.lastName}` : 'System'} {event.summary}
                    </strong>
                    <span suppressHydrationWarning>{formatRelative(event.createdAt)}</span>
                  </div>
                </div>
              ))}
              {(project.activity ?? []).length === 0 && <p className="empty-state empty-state-compact">No project activity yet.</p>}
            </div>
          </section>
        </div>
      </div>

      {confirm?.kind === 'unlink' && (
        <ConfirmDialog
          title="Unlink this task?"
          description={`“${confirm.taskTitle}” leaves ${confirm.milestoneTitle}. The task itself stays in the workspace.`}
          confirmLabel="Unlink task"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => unlinkTaskFromMilestone(confirm.milestoneId, confirm.taskId))}
        />
      )}
      {confirm?.kind === 'remove-member' && (
        <ConfirmDialog
          title="Remove teammate?"
          description={`${confirm.name} will leave this project roster. They keep any tasks already assigned to them.`}
          confirmLabel="Remove teammate"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => removeProjectTeamMember(project.id, confirm.userId))}
        />
      )}
      {confirm?.kind === 'remove-department' && (
        <ConfirmDialog
          title="Remove this department?"
          description={`${confirm.name} will no longer be a contributing function on this project. Their people keep assigned tasks.`}
          confirmLabel="Remove department"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => removeProjectDepartment(project.id, confirm.departmentId))}
        />
      )}
      {confirm?.kind === 'delete-milestone' && (
        <ConfirmDialog
          title="Remove this milestone?"
          description={
            confirm.linkedCount === 0
              ? `“${confirm.title}” will be deleted. No linked tasks are affected.`
              : `“${confirm.title}” has ${confirm.linkedCount} linked ${confirm.linkedCount === 1 ? 'task' : 'tasks'}. Tasks are never deleted.`
          }
          confirmLabel="Remove milestone"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(() =>
              deleteProjectMilestone(
                confirm.milestoneId,
                confirm.linkedCount > 0 && confirm.rehomeMilestoneId ? confirm.rehomeMilestoneId : null,
              ),
            )
          }
        >
          {confirm.linkedCount > 0 && (project.milestones ?? []).filter((milestone) => milestone.id !== confirm.milestoneId).length > 0 && (
            <label className="confirm-field">
              Keep linked work on
              <select
                value={confirm.rehomeMilestoneId}
                onChange={(event) =>
                  setConfirm({ ...confirm, rehomeMilestoneId: event.target.value })
                }
              >
                <option value="">Unlink from this project</option>
                {(project.milestones ?? [])
                  .filter((milestone) => milestone.id !== confirm.milestoneId)
                  .map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      Move to {milestone.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {confirm.linkedCount > 0 && (project.milestones ?? []).filter((milestone) => milestone.id !== confirm.milestoneId).length === 0 && (
            <p className="field-hint">This is the last milestone, so linked tasks will leave the project but remain as normal work.</p>
          )}
        </ConfirmDialog>
      )}
      {confirm?.kind === 'delete-task' && (
       <ConfirmDialog
       title="Delete this task?"
       description={`“${confirm.title}” and all associated comments, files, and links will be permanently deleted. This action cannot be undone.`}
       confirmLabel="Delete task"
       pending={isPending}
       onCancel={() => setConfirm(null)}
       onConfirm={() =>
         run(async () => {
           const result = await deleteTask(confirm.taskId)
           if (!result || !('error' in result) || !result.error) {
             onTaskRemoved(confirm.taskId)
           }
           return result
         })
       }
     />
      )}
      {confirm?.kind === 'delete-project' && (
        <ConfirmDialog
          title="Delete this project?"
          description={`“${project.title}” will be removed from the portfolio. Linked tasks stay in the workspace unless you choose to delete them below.`}
          confirmLabel="Delete project"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(async () => {
              const result = await deleteProject(project.id, { deleteLinkedTasks: confirm.deleteLinkedTasks })
              if (result && 'ok' in result && result.ok) {
                const deletedTaskIds = 'deletedTaskIds' in result ? result.deletedTaskIds ?? [] : []
                for (const taskId of deletedTaskIds) onTaskRemoved(taskId)
                onProjectDeleted()
              }
              return result
            })
          }
        >
          {linkedTaskCount > 0 ? (
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={confirm.deleteLinkedTasks}
                onChange={(event) =>
                  setConfirm({ ...confirm, deleteLinkedTasks: event.target.checked })
                }
              />
              Also permanently delete {linkedTaskCount} linked {linkedTaskCount === 1 ? 'task' : 'tasks'} and their stored files
            </label>
          ) : (
            <p className="field-hint">This project has no linked tasks.</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}

function MilestoneEditor({
  milestone,
  disabled,
  onSave,
}: {
  milestone: Milestone
  disabled: boolean
  onSave: (next: {
    title: string
    status: 'planned' | 'active' | 'completed'
    startDate: string | null
    dueDate: string | null
  }) => void
}) {
  const [title, setTitle] = useState(milestone.title)
  const [status, setStatus] = useState(milestone.status)
  const [startDate, setStartDate] = useState(dateInputValue(milestone.startDate))
  const [dueDate, setDueDate] = useState(dateInputValue(milestone.dueDate))
  const canSave = Boolean(title.trim()) && datesAreValid(startDate, dueDate)

  return (
    <form
      className="milestone-edit"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSave) return
        onSave({
          title,
          status: status as 'planned' | 'active' | 'completed',
          startDate: startDate || null,
          dueDate: dueDate || null,
        })
      }}
    >
      <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Milestone name" required />
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Milestone status">
        <option value="planned">Planned</option>
        <option value="active">Active</option>
        <option value="completed">Completed</option>
      </select>
      <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-label="Milestone start date" />
      <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Milestone due date" />
      <Button className="create-button" type="submit" disabled={disabled || !canSave}>
        Save
      </Button>
    </form>
  )
}
