'use client'

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import {
  addProjectDepartment,
  addProjectMilestone,
  addProjectTeamMember,
  addTaskHelper,
  deleteProject,
  deleteProjectMilestone,
  deleteTask,
  notifyProjectPeople,
  removeProjectDepartment,
  removeProjectTeamMember,
  removeTaskHelper,
  setTaskPlacement,
  unlinkTaskFromMilestone,
  updateProjectDetails,
  updateProjectMilestone,
  updateTaskDetails,
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

type TaskHelper = {
  id?: string
  firstName: string
  lastName: string
  initials: string
  avatarUrl?: string | null
  avatarColor?: string | null
}

type WorkspaceTask = {
  id: string
  title: string
  description?: string | null
  status: string
  priority?: string
  dueDate: string | Date | null
  startDate?: string | Date | null
  assigneeId?: string | null
  assignee: { firstName: string; lastName: string; initials?: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  projectId?: string | null
  helpers?: TaskHelper[]
}

type DepartmentOption = { id: string; name: string }

type Focus = 'overview' | 'work' | 'people' | 'pulse'
type DrawerKind = 'edit' | 'notify' | 'task' | null

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

function isOverdue(dueDate: string | Date | null | undefined, status: string) {
  if (!dueDate || status === 'completed' || status === 'cancelled') return false
  return String(dueDate).slice(0, 10) < localIsoDate(0)
}

function ProjectDrawer({
  title,
  subtitle,
  badge,
  onClose,
  children,
  wide,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const panelRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const headingId = useId()

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [])

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

  return (
    <div className="drawer-scrim" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className={`dept-drawer office-drawer${wide ? ' project-drawer-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dept-drawer-head office-drawer-head">
          <div className="dept-drawer-title">
            <div className="office-drawer-title-row">
              <h2 id={headingId}>{title}</h2>
              {badge}
            </div>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="close-button" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="dept-drawer-body office-drawer-body">{children}</div>
      </aside>
    </div>
  )
}

export function ProjectWorkspace({
  project,
  people,
  departments,
  tasks,
  canManage,
  canCreateWork,
  lockLeadToSelf = false,
  openNotifyOnMount = false,
  onBack,
  onCreateTask,
  onOpenTask,
  onProjectDeleted,
  onTaskRemoved,
  canDeleteLinkedTask,
  onTaskLinked,
  onRefresh,
}: {
  project: Project
  people: Person[]
  departments: DepartmentOption[]
  tasks: WorkspaceTask[]
  canManage: boolean
  canCreateWork: boolean
  lockLeadToSelf?: boolean
  openNotifyOnMount?: boolean
  onBack: () => void
  onCreateTask: (milestoneId: string) => void
  onOpenTask: (taskId: string) => void
  onProjectDeleted: () => void
  onTaskRemoved: (taskId: string) => void
  canDeleteLinkedTask: (taskId: string) => boolean
  onTaskLinked?: (taskId: string, placement: { projectId: string; milestoneId: string | null }) => void
  onRefresh?: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus>('work')
  const [drawer, setDrawer] = useState<DrawerKind>(openNotifyOnMount && canManage ? 'notify' : null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
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
  const [notifyMode, setNotifyMode] = useState<'reminder' | 'progress'>('reminder')
  const [notifyAudience, setNotifyAudience] = useState<'all' | 'assignees' | 'helpers' | 'selected'>('all')
  const [notifyNote, setNotifyNote] = useState('')
  const [notifySelected, setNotifySelected] = useState<string[]>([])

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

  useEffect(() => {
    if (openNotifyOnMount && canManage) setDrawer('notify')
  }, [openNotifyOnMount, canManage, project.id])

  const linkedIds = new Set(project.taskIds ?? [])
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const activeTask = activeTaskId ? byId.get(activeTaskId) ?? null : null
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
  const canAddMilestone = Boolean(milestoneTitle.trim()) && datesAreValid(milestoneStart, milestoneDue)
  const leadPerson = people.find((person) => person.id === ownerId)
  const canSaveProject = Boolean(title.trim() && ownerId && departmentId)
  const canLinkTask = Boolean(linkTaskId)
  const canLinkExisting = canManage || canCreateWork
  const linkedTaskCount = project.taskIds?.length ?? 0

  const projectTaskIdSet = useMemo(() => new Set(project.taskIds ?? []), [project.taskIds])
  const notifyCandidates = useMemo(() => {
    const map = new Map<string, { id: string; name: string; role: string }>()
    for (const member of project.team ?? []) {
      map.set(member.id, {
        id: member.id,
        name: `${member.firstName} ${member.lastName}`,
        role: member.id === project.ownerId ? 'Lead' : 'Team',
      })
    }
    for (const task of tasks.filter((entry) => entry.projectId === project.id || projectTaskIdSet.has(entry.id))) {
      if (task.assigneeId && task.assignee) {
        map.set(task.assigneeId, {
          id: task.assigneeId,
          name: `${task.assignee.firstName} ${task.assignee.lastName}`,
          role: 'Assignee',
        })
      }
      for (const helper of task.helpers ?? []) {
        if (!helper.id) continue
        map.set(helper.id, {
          id: helper.id,
          name: `${helper.firstName} ${helper.lastName}`,
          role: 'Collaborator',
        })
      }
    }
    return [...map.values()]
  }, [project, tasks, projectTaskIdSet])

  function run(action: () => Promise<{ error?: string } | { ok?: boolean } | void>, successNotice?: string) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await action()
      if (result && 'error' in result && result.error) setError(result.error)
      else {
        setConfirm(null)
        if (successNotice) setNotice(successNotice)
        onRefresh?.()
      }
    })
  }

  function openTaskDrawer(taskId: string) {
    setActiveTaskId(taskId)
    setDrawer('task')
  }

  function closeDrawer() {
    setDrawer(null)
    setActiveTaskId(null)
  }

  return (
    <div className="project-workspace">
      <div className="project-identity">
        <button type="button" className="text-back" onClick={onBack}>
          Back to portfolio
        </button>
        <div className="project-identity-main">
          <div>
            <span className="eyebrow">Project</span>
            <h1>{project.title}</h1>
            <p className="project-identity-meta">
              {ledBy(project.owner)}
              {project.partner ? ` · Partner ${project.partner}` : ''}
              {project.department ? ` · Home ${project.department}` : ''}
            </p>
            {project.participation === 'contributing' ? (
              <p className="project-workspace-summary">Your department is contributing. You can run your slice of the work.</p>
            ) : null}
          </div>
          <div className="project-workspace-actions">
            <StatusBadge status={project.health ?? project.status} />
            <StatusBadge status={project.risk} />
            {project.participation === 'contributing' ? <StatusBadge status="Contributing" /> : null}
            {project.participation === 'home' ? <StatusBadge status="Home" /> : null}
            {canManage ? (
              <Button variant="outline" type="button" onClick={() => setDrawer('edit')}>
                Edit project
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="outline" type="button" onClick={() => setDrawer('notify')}>
                Notify people
              </Button>
            ) : null}
            {canCreateWork && defaultMilestoneId ? (
              <Button className="create-button" type="button" onClick={() => onCreateTask(defaultMilestoneId)}>
                <Plus data-icon="inline-start" /> New task
              </Button>
            ) : null}
            {canManage ? (
              <Button
                variant="destructive"
                type="button"
                onClick={() => setConfirm({ kind: 'delete-project', deleteLinkedTasks: false })}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>
        <div className="project-health-strip">
          <div>
            <strong>{project.completionRate}%</strong>
            <span>complete</span>
          </div>
          <div>
            <strong>{project.tasks}</strong>
            <span>tasks</span>
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
          <div className="progress-track project-workspace-track">
            <div className="progress-fill fill-teal" style={{ width: `${project.progress}%` }} />
          </div>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}

      <div className="project-shell">
        <nav className="office-rail project-rail" aria-label="Project sections">
          <div className="office-rail-group">
            <span>Focus</span>
            {(
              [
                ['work', 'Work', String(linkedTaskCount)],
                ['overview', 'Overview', null],
                ['people', 'People', String((project.team ?? []).length)],
                ['pulse', 'Pulse', String((project.activity ?? []).length)],
              ] as const
            ).map(([id, label, count]) => (
              <button key={id} type="button" className={focus === id ? 'selected' : ''} onClick={() => setFocus(id)}>
                {label}
                {count != null ? <em>{count}</em> : null}
              </button>
            ))}
          </div>
        </nav>

        <div className="project-stage">
          {focus === 'overview' ? (
            <section className="project-section project-section-overview">
              <header className="project-section-head">
                <div>
                  <h2>Overview</h2>
                  <p>Purpose, ownership, and how this project is set up</p>
                </div>
              </header>
              {project.description ? <p className="project-overview-copy">{project.description}</p> : <p className="empty-state">No description yet.</p>}
              <div className="project-overview-grid">
                <div>
                  <span>Lead</span>
                  <strong>{project.owner}</strong>
                </div>
                <div>
                  <span>Partner</span>
                  <strong>{project.partner || 'None'}</strong>
                </div>
                <div>
                  <span>Home department</span>
                  <strong>{project.department || '—'}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{project.projectStatus ?? project.status}</strong>
                </div>
              </div>
              {(project.contributingDepartments ?? []).length > 0 ? (
                <p className="project-workspace-summary">
                  Contributing: {project.contributingDepartments?.map((entry) => entry.name).join(', ')}
                </p>
              ) : null}
            </section>
          ) : null}

          {focus === 'work' ? (
            <section className="project-section project-section-work">
              <header className="project-section-head">
                <div>
                  <h2>Work</h2>
                  <p>Milestones and the tasks that move them</p>
                </div>
              </header>

              <div className="milestone-list">
                {(project.milestones ?? []).map((milestone) => {
                  const editingThis = editingMilestoneId === milestone.id
                  return (
                    <div className="milestone-card" key={milestone.id}>
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
                          {canCreateWork ? (
                            <Button variant="outline" type="button" onClick={() => onCreateTask(milestone.id)}>
                              Add task
                            </Button>
                          ) : null}
                          {canManage ? (
                            <Button
                              variant="outline"
                              type="button"
                              onClick={() => setEditingMilestoneId(editingThis ? null : milestone.id)}
                            >
                              {editingThis ? 'Done' : 'Edit'}
                            </Button>
                          ) : null}
                          {canManage ? (
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
                          ) : null}
                        </div>
                      </div>
                      {editingThis && canManage ? (
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
                      ) : null}
                      <div className="milestone-tasks">
                        {milestone.taskIds.length === 0 ? <p className="empty-state empty-state-compact">No tasks linked yet.</p> : null}
                        {milestone.taskIds.map((taskId) => {
                          const task = byId.get(taskId)
                          if (!task) return null
                          const overdue = isOverdue(task.dueDate, task.status)
                          const helpers = task.helpers ?? []
                          return (
                            <div className={`project-task-row${overdue ? ' is-overdue' : ''}`} key={taskId}>
                              <button type="button" className="project-task-main" onClick={() => openTaskDrawer(taskId)}>
                                <strong>{task.title}</strong>
                                <span>
                                  {task.assignee
                                    ? `${task.assignee.firstName} ${task.assignee.lastName}`
                                    : 'Unassigned'}
                                  {task.dueDate ? ` · ${formatDue(task.dueDate)}` : ''}
                                  {helpers.length > 0
                                    ? ` · +${helpers.length} collaborator${helpers.length === 1 ? '' : 's'}`
                                    : ''}
                                </span>
                              </button>
                              <span className={`office-chip office-chip-${overdue ? 'attention' : task.status === 'completed' ? 'good' : 'calm'}`}>
                                {overdue ? 'Overdue' : TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS] ?? task.status}
                              </span>
                              <div className="project-task-actions">
                                <button type="button" className="row-action" onClick={() => onOpenTask(taskId)}>
                                  Open
                                </button>
                                {canManage ? (
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
                                ) : null}
                                {canDeleteLinkedTask(taskId) ? (
                                  <button
                                    type="button"
                                    className="row-action row-action-danger"
                                    disabled={isPending}
                                    onClick={() => setConfirm({ kind: 'delete-task', taskId, title: task.title })}
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {(project.milestones ?? []).length === 0 ? <p className="empty-state">No milestones yet.</p> : null}
                {unscheduledTasks.length > 0 ? (
                  <div className="milestone-card">
                    <div className="milestone-head">
                      <div className="responsibility-main">
                        <strong>Not on a milestone</strong>
                        <span>Still on this project</span>
                      </div>
                    </div>
                    <div className="milestone-tasks">
                      {unscheduledTasks.map((task) => (
                        <div className="project-task-row" key={task.id}>
                          <button type="button" className="project-task-main" onClick={() => openTaskDrawer(task.id)}>
                            <strong>{task.title}</strong>
                            <span>{TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS] ?? task.status}</span>
                          </button>
                          <button type="button" className="row-action" onClick={() => onOpenTask(task.id)}>
                            Open
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {canManage ? (
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
              ) : null}

              {canLinkExisting ? (
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
              ) : null}
            </section>
          ) : null}

          {focus === 'people' ? (
            <div className="project-people-grid">
              <section className="project-section project-section-people">
                <header className="project-section-head">
                  <div>
                    <h2>Team</h2>
                    <p>People on the roster for this project</p>
                  </div>
                </header>
                <div className="employee-list">
                  {(project.team ?? []).map((member) => (
                    <div className="employee-row" key={member.id}>
                      <UserAvatar initials={member.initials} url={member.avatarUrl} color={member.avatarColor} size="sm" />
                      <div className="employee-main">
                        <strong>
                          {member.firstName} {member.lastName}
                        </strong>
                        <span>{member.id === project.ownerId ? 'Project lead' : 'Teammate'}</span>
                      </div>
                      {canManage && member.id !== project.ownerId ? (
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
                      ) : null}
                    </div>
                  ))}
                </div>
                {canManage ? (
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
                ) : null}
              </section>

              <section className="project-section project-section-people">
                <header className="project-section-head">
                  <div>
                    <h2>Departments</h2>
                    <p>Home owns the project. Contributing functions run their slice.</p>
                  </div>
                </header>
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
                      {canManage ? (
                        <button
                          type="button"
                          className="row-action"
                          disabled={isPending}
                          onClick={() => setConfirm({ kind: 'remove-department', departmentId: entry.id, name: entry.name })}
                        >
                          <X aria-hidden="true" /> Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {canManage && addableDepartments.length > 0 ? (
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
                ) : null}
              </section>
            </div>
          ) : null}

          {focus === 'pulse' ? (
            <section className="project-section project-section-pulse">
              <header className="project-section-head">
                <div>
                  <h2>Pulse</h2>
                  <p>Project changes and linked task movement</p>
                </div>
              </header>
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
                {(project.activity ?? []).length === 0 ? <p className="empty-state empty-state-compact">No project activity yet.</p> : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {drawer === 'edit' && canManage ? (
        <ProjectDrawer title="Edit project" subtitle="Name, lead, home department, and lifecycle" onClose={closeDrawer}>
          <form
            className="office-drawer-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!canSaveProject) {
                setError('Name, lead, and department are required.')
                return
              }
              run(async () => {
                const result = await updateProjectDetails({
                  projectId: project.id,
                  title,
                  description,
                  status: projectStatus as 'active' | 'paused' | 'completed' | 'archived',
                  ownerId,
                  partnerId: partnerId || null,
                  departmentId,
                })
                if (!result || !('error' in result) || !result.error) closeDrawer()
                return result
              }, 'Project saved.')
            }}
          >
            <div className="invoice-grid">
              <label className="invoice-span">
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
                    <input value={leadPerson ? `${leadPerson.firstName} ${leadPerson.lastName}` : project.owner} readOnly aria-readonly="true" />
                    <span className="field-hint">You stay the project lead.</span>
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
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Home department
                <select value={departmentId} disabled={lockLeadToSelf} onChange={(event) => setDepartmentId(event.target.value)}>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="invoice-span">
                Description
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
              </label>
            </div>
            <Button className="create-button" type="submit" disabled={isPending || !canSaveProject}>
              Save project
            </Button>
          </form>
        </ProjectDrawer>
      ) : null}

      {drawer === 'notify' && canManage ? (
        <ProjectDrawer title="Notify people" subtitle="Remind people of their work or ask for a progress update" onClose={closeDrawer}>
          <form
            className="office-drawer-form"
            onSubmit={(event) => {
              event.preventDefault()
              run(async () => {
                const result = await notifyProjectPeople({
                  projectId: project.id,
                  mode: notifyMode,
                  audience: notifyAudience,
                  userIds: notifyAudience === 'selected' ? notifySelected : undefined,
                  note: notifyNote,
                })
                if (result && 'error' in result && result.error) return result
                if (result && 'ok' in result && result.ok) {
                  const mailBit =
                    result.mailReady === false
                      ? ' In-app notices were sent. Email is not set up on this workspace yet.'
                      : result.mailed
                        ? ` ${result.mailed} email${result.mailed === 1 ? '' : 's'} sent.`
                        : ''
                  setNotice(`Notified ${result.notified} ${result.notified === 1 ? 'person' : 'people'}.${mailBit}`)
                  closeDrawer()
                }
                return result
              })
            }}
          >
            <label>
              Message type
              <select value={notifyMode} onChange={(event) => setNotifyMode(event.target.value as 'reminder' | 'progress')}>
                <option value="reminder">Assignment reminder (deadlines)</option>
                <option value="progress">Progress request</option>
              </select>
            </label>
            <label>
              Who to notify
              <select
                value={notifyAudience}
                onChange={(event) => setNotifyAudience(event.target.value as typeof notifyAudience)}
              >
                <option value="all">Everyone involved</option>
                <option value="assignees">Assignees only</option>
                <option value="helpers">Collaborators only</option>
                <option value="selected">Specific people</option>
              </select>
            </label>
            {notifyAudience === 'selected' ? (
              <div className="invoice-pay-list">
                {notifyCandidates.map((person) => (
                  <label key={person.id} className={`invoice-pay-option${notifySelected.includes(person.id) ? ' selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={notifySelected.includes(person.id)}
                      onChange={(event) =>
                        setNotifySelected((current) =>
                          event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                        )
                      }
                    />
                    <span>
                      <strong>{person.name}</strong>
                      <em>{person.role}</em>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
            <label>
              Note
              <textarea
                rows={3}
                value={notifyNote}
                onChange={(event) => setNotifyNote(event.target.value)}
                placeholder={
                  notifyMode === 'progress'
                    ? 'Please share a short update on where things stand.'
                    : 'Reminder of your deadlines on this project.'
                }
              />
            </label>
            <Button className="create-button" type="submit" disabled={isPending}>
              Send notices
            </Button>
          </form>
        </ProjectDrawer>
      ) : null}

      {drawer === 'task' && activeTask ? (
        <TaskCoordinateDrawer
          task={activeTask}
          people={people}
          canManage={canManage}
          pending={isPending}
          onClose={closeDrawer}
          onOpenFull={() => {
            onOpenTask(activeTask.id)
            closeDrawer()
          }}
          onSave={(next) =>
            run(
              () =>
                updateTaskDetails({
                  taskId: activeTask.id,
                  title: next.title,
                  description: next.description,
                  assigneeId: next.assigneeId,
                  priority: (next.priority || 'medium') as 'low' | 'medium' | 'high',
                  startDate: next.startDate || null,
                  dueDate: next.dueDate || null,
                }),
              'Task updated.',
            )
          }
          onAddHelper={(userId) => run(() => addTaskHelper(activeTask.id, userId), 'Collaborator added.')}
          onRemoveHelper={(userId) => run(() => removeTaskHelper(activeTask.id, userId), 'Collaborator removed.')}
        />
      ) : null}

      {confirm?.kind === 'unlink' ? (
        <ConfirmDialog
          title="Unlink this task?"
          description={`“${confirm.taskTitle}” leaves ${confirm.milestoneTitle}. The task itself stays in the workspace.`}
          confirmLabel="Unlink task"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => unlinkTaskFromMilestone(confirm.milestoneId, confirm.taskId))}
        />
      ) : null}
      {confirm?.kind === 'remove-member' ? (
        <ConfirmDialog
          title="Remove teammate?"
          description={`${confirm.name} will leave this project roster. They keep any tasks already assigned to them.`}
          confirmLabel="Remove teammate"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => removeProjectTeamMember(project.id, confirm.userId))}
        />
      ) : null}
      {confirm?.kind === 'remove-department' ? (
        <ConfirmDialog
          title="Remove this department?"
          description={`${confirm.name} will no longer be a contributing function on this project. Their people keep assigned tasks.`}
          confirmLabel="Remove department"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => removeProjectDepartment(project.id, confirm.departmentId))}
        />
      ) : null}
      {confirm?.kind === 'delete-milestone' ? (
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
          {confirm.linkedCount > 0 && (project.milestones ?? []).filter((milestone) => milestone.id !== confirm.milestoneId).length > 0 ? (
            <label className="confirm-field">
              Keep linked work on
              <select
                value={confirm.rehomeMilestoneId}
                onChange={(event) => setConfirm({ ...confirm, rehomeMilestoneId: event.target.value })}
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
          ) : null}
          {confirm.linkedCount > 0 && (project.milestones ?? []).filter((milestone) => milestone.id !== confirm.milestoneId).length === 0 ? (
            <p className="field-hint">This is the last milestone, so linked tasks will leave the project but remain as normal work.</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
      {confirm?.kind === 'delete-task' ? (
        <ConfirmDialog
          title="Delete this task?"
          description={`“${confirm.title}” and all associated comments, files, and links will be permanently deleted. This action cannot be undone.`}
          confirmLabel="Delete task"
          pending={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(async () => {
              const result = await deleteTask(confirm.taskId)
              if (!result || !('error' in result) || !result.error) onTaskRemoved(confirm.taskId)
              return result
            })
          }
        />
      ) : null}
      {confirm?.kind === 'delete-project' ? (
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
                onChange={(event) => setConfirm({ ...confirm, deleteLinkedTasks: event.target.checked })}
              />
              Also permanently delete {linkedTaskCount} linked {linkedTaskCount === 1 ? 'task' : 'tasks'} and their stored files
            </label>
          ) : (
            <p className="field-hint">This project has no linked tasks.</p>
          )}
        </ConfirmDialog>
      ) : null}
    </div>
  )
}

function TaskCoordinateDrawer({
  task,
  people,
  canManage,
  pending,
  onClose,
  onOpenFull,
  onSave,
  onAddHelper,
  onRemoveHelper,
}: {
  task: WorkspaceTask
  people: Person[]
  canManage: boolean
  pending: boolean
  onClose: () => void
  onOpenFull: () => void
  onSave: (next: {
    title: string
    description: string
    assigneeId: string
    priority: string
    startDate: string
    dueDate: string
  }) => void
  onAddHelper: (userId: string) => void
  onRemoveHelper: (userId: string) => void
}) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? '')
  const [priority, setPriority] = useState(task.priority ?? 'medium')
  const [startDate, setStartDate] = useState(dateInputValue(task.startDate))
  const [dueDate, setDueDate] = useState(dateInputValue(task.dueDate))
  const [helperId, setHelperId] = useState('')
  const helpers = task.helpers ?? []
  const helperIds = new Set(helpers.map((helper) => helper.id).filter((id): id is string => Boolean(id)))
  const addable = people.filter((person) => person.id !== assigneeId && !helperIds.has(person.id))

  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description ?? '')
    setAssigneeId(task.assigneeId ?? '')
    setPriority(task.priority ?? 'medium')
    setStartDate(dateInputValue(task.startDate))
    setDueDate(dateInputValue(task.dueDate))
  }, [task])

  return (
    <ProjectDrawer
      title={task.title}
      subtitle={task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : 'Unassigned'}
      badge={
        <span className={`office-chip office-chip-${isOverdue(task.dueDate, task.status) ? 'attention' : 'calm'}`}>
          {isOverdue(task.dueDate, task.status)
            ? 'Overdue'
            : TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS] ?? task.status}
        </span>
      }
      onClose={onClose}
      wide
    >
      <form
        className="office-drawer-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canManage || !assigneeId) return
          onSave({ title, description, assigneeId, priority, startDate, dueDate })
        }}
      >
        <section className="invoice-section invoice-section-client">
          <header className="invoice-section-head">
            <div>
              <h3>Details</h3>
              <p>Title, lead, and dates for this task</p>
            </div>
          </header>
          <div className="invoice-grid">
            <label className="invoice-span">
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canManage} required />
            </label>
            <label>
              Assigned to
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} disabled={!canManage} required>
                <option value="">Choose someone…</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.firstName} {person.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={priority} onChange={(event) => setPriority(event.target.value)} disabled={!canManage}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Start
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={!canManage} />
            </label>
            <label>
              Due
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={!canManage} />
            </label>
            <label className="invoice-span">
              Brief
              <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canManage} />
            </label>
          </div>
          {canManage ? (
            <Button className="create-button" type="submit" disabled={pending || !assigneeId}>
              Save task
            </Button>
          ) : null}
        </section>

        <section className="invoice-section invoice-section-pay">
          <header className="invoice-section-head">
            <div>
              <h3>Collaborators</h3>
              <p>People working with the lead on this task</p>
            </div>
          </header>
          <div className="employee-list">
            {helpers.length === 0 ? <p className="invoice-note">No collaborators yet.</p> : null}
            {helpers.map((helper) => (
              <div className="employee-row" key={helper.id ?? `${helper.firstName}-${helper.lastName}`}>
                <UserAvatar initials={helper.initials} url={helper.avatarUrl} color={helper.avatarColor} size="sm" />
                <div className="employee-main">
                  <strong>
                    {helper.firstName} {helper.lastName}
                  </strong>
                  <span>Collaborator</span>
                </div>
                {canManage && helper.id ? (
                  <button type="button" className="row-action" disabled={pending} onClick={() => onRemoveHelper(helper.id!)}>
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="team-add">
              <select value={helperId} onChange={(event) => setHelperId(event.target.value)}>
                <option value="">Add collaborator…</option>
                {addable.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.firstName} {person.lastName}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !helperId}
                onClick={() => {
                  if (!helperId) return
                  onAddHelper(helperId)
                  setHelperId('')
                }}
              >
                Add
              </Button>
            </div>
          ) : null}
        </section>

        <Button type="button" variant="outline" onClick={onOpenFull}>
          Open full task
        </Button>
      </form>
    </ProjectDrawer>
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
