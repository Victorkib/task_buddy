'use client'

import { useEffect, useRef, useState } from 'react'
import { BriefcaseBusiness, CircleAlert, Clock3, Plus, Target, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import { UserAvatar } from '@/components/user-avatar'
import { formatDue, fullName, ledBy } from '@/lib/format'
import { departmentHealth, type DepartmentPosture } from '@/lib/department-view'

const ROSTER_PREVIEW = 6
const LIST_PREVIEW = 5

export type DepartmentSummary = {
  id: string
  name: string
  color: string
  progress: number
  total: number
  completed: number
  active?: number
  blocked?: number
  overdue?: number
  owner?: { firstName: string; lastName: string } | null
  teams?: { id: string }[]
}

export type DepartmentPerson = {
  id: string
  firstName: string
  lastName: string
  initials: string
  jobTitle?: string | null
  avatarUrl?: string | null
  avatarColor?: string | null
  status?: string
  manager?: { firstName: string; lastName: string } | null
}

export type DepartmentProject = {
  id: string
  title: string
  owner: string
  status: string
  progress: number
  participation?: 'home' | 'contributing' | 'member'
}

export type DepartmentTask = {
  id: string
  title: string
  status: string
  dueDate: string | Date | null
  assignee: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
}

type DepartmentDetailProps = {
  department: DepartmentSummary
  posture: DepartmentPosture
  people: DepartmentPerson[]
  projects: DepartmentProject[]
  tasks: DepartmentTask[]
  onOpenProject?: (projectId: string) => void
  onOpenTask?: (taskId: string) => void
  onAssignTask?: (personId?: string) => void
  onInvite?: () => void
  onEditPerson?: (personId: string) => void
  onRemovePerson?: (personId: string) => void
  onToggleStatus?: (personId: string) => void
  onResendInvite?: (personId: string) => void
  onCancelInvite?: (personId: string) => void
  busy?: boolean
}

function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone: string
}) {
  return (
    <div className={`dept-stat ${tone}`}>
      <span className="dept-stat-icon">{icon}</span>
      <em>{value}</em>
      <span className="dept-stat-label">{label}</span>
    </div>
  )
}

function SectionHeading({
  title,
  count,
  action,
}: {
  title: string
  count: number
  action?: React.ReactNode
}) {
  return (
    <div className="dept-section-head">
      <h3>
        {title} <span>{count}</span>
      </h3>
      {action}
    </div>
  )
}

/**
 * The body of a department: identity, health, roster, projects, and unscheduled work.
 * Rendered inside the slide-over for org-wide viewers and inline as the whole page
 * for anyone who only ever has one department.
 */
export function DepartmentDetailBody({
  department,
  posture,
  people,
  projects,
  tasks,
  onOpenProject,
  onOpenTask,
  onAssignTask,
  onInvite,
  onEditPerson,
  onRemovePerson,
  onToggleStatus,
  onResendInvite,
  onCancelInvite,
  busy = false,
}: DepartmentDetailProps) {
  const [showAllPeople, setShowAllPeople] = useState(false)
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [showAllTasks, setShowAllTasks] = useState(false)

  const visiblePeople = showAllPeople ? people : people.slice(0, ROSTER_PREVIEW)
  const visibleProjects = showAllProjects ? projects : projects.slice(0, LIST_PREVIEW)
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, LIST_PREVIEW)
  const canSeeReportingLines = posture === 'org' || posture === 'lead'

  return (
    <div className="dept-detail-body">
      <div className="dept-stats">
        <StatTile
          label="Completion"
          value={`${department.progress}%`}
          icon={<Target aria-hidden="true" />}
          tone="dept-stat-teal"
        />
        <StatTile
          label="Open work"
          value={department.active ?? Math.max(0, department.total - department.completed)}
          icon={<BriefcaseBusiness aria-hidden="true" />}
          tone="dept-stat-navy"
        />
        <StatTile
          label="Overdue"
          value={department.overdue ?? 0}
          icon={<Clock3 aria-hidden="true" />}
          tone="dept-stat-warn"
        />
        <StatTile
          label="Stuck"
          value={department.blocked ?? 0}
          icon={<CircleAlert aria-hidden="true" />}
          tone="dept-stat-alert"
        />
      </div>

      <div className="dept-progress">
        <div className="progress-track">
          <div className={`progress-fill fill-${department.color}`} style={{ width: `${department.progress}%` }} />
        </div>
        <p className="dept-progress-copy">
          {department.completed} of {department.total} tasks completed
        </p>
      </div>

      <section className="dept-section">
        <SectionHeading
          title="People"
          count={people.length}
          action={
            onInvite ? (
              <Button variant="outline" size="sm" onClick={onInvite}>
                <Plus data-icon="inline-start" /> Add person
              </Button>
            ) : undefined
          }
        />
        {people.length === 0 ? (
          <p className="empty-state empty-state-compact">Nobody is assigned to this department yet.</p>
        ) : (
          <ul className="dept-people">
            {visiblePeople.map((person) => (
              <li key={person.id} className="dept-person">
                <UserAvatar initials={person.initials} url={person.avatarUrl} color={person.avatarColor} size="sm" />
                <div className="dept-person-copy">
                  <strong>{fullName(person)}</strong>
                  <span>
                    {person.jobTitle || 'No title set'}
                    {canSeeReportingLines && person.manager ? ` · reports to ${fullName(person.manager)}` : ''}
                  </span>
                </div>
                <StatusBadge
                  status={
                    person.status === 'invited' ? 'Invited' : person.status === 'inactive' ? 'Inactive' : 'Active'
                  }
                />
                {person.status === 'invited' && (onResendInvite || onCancelInvite) ? (
                  <div className="dept-person-actions">
                    {onResendInvite ? (
                      <button type="button" className="row-action" disabled={busy} onClick={() => onResendInvite(person.id)}>
                        Resend
                      </button>
                    ) : null}
                    {onCancelInvite ? (
                      <button type="button" className="row-action row-action-danger" disabled={busy} onClick={() => onCancelInvite(person.id)}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ) : person.status !== 'invited' && (onEditPerson || onRemovePerson || onToggleStatus || onAssignTask) ? (
                  <div className="dept-person-actions">
                    {onAssignTask ? (
                      <button
                        type="button"
                        className="row-action"
                        disabled={busy}
                        onClick={() => onAssignTask(person.id)}
                      >
                        Assign task
                      </button>
                    ) : null}
                    {onEditPerson ? (
                      <button type="button" className="row-action" disabled={busy} onClick={() => onEditPerson(person.id)}>
                        Edit
                      </button>
                    ) : null}
                    {onRemovePerson ? (
                      <button
                        type="button"
                        className="row-action row-action-danger"
                        disabled={busy}
                        onClick={() => onRemovePerson(person.id)}
                      >
                        Remove
                      </button>
                    ) : null}
                    {onToggleStatus ? (
                      <button type="button" className="row-action" disabled={busy} onClick={() => onToggleStatus(person.id)}>
                        {person.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {people.length > ROSTER_PREVIEW ? (
          <button type="button" className="row-action" onClick={() => setShowAllPeople((open) => !open)}>
            {showAllPeople ? 'Show fewer' : `Show all ${people.length}`}
          </button>
        ) : null}
      </section>

      <section className="dept-section">
        <SectionHeading title="Projects" count={projects.length} />
        {projects.length === 0 ? (
          <p className="empty-state empty-state-compact">No projects for this department yet.</p>
        ) : (
          <ul className="dept-rows">
            {visibleProjects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="dept-row"
                  onClick={() => onOpenProject?.(project.id)}
                  disabled={!onOpenProject}
                >
                  <span className="dept-row-main">
                    <strong>{project.title}</strong>
                    <span>{ledBy(project.owner)}</span>
                  </span>
                  {project.participation === 'contributing' ? <StatusBadge status="Contributing" /> : null}
                  <StatusBadge status={project.status} />
                  <em className="dept-row-value">{project.progress}%</em>
                </button>
              </li>
            ))}
          </ul>
        )}
        {projects.length > LIST_PREVIEW ? (
          <button type="button" className="row-action" onClick={() => setShowAllProjects((open) => !open)}>
            {showAllProjects ? 'Show fewer' : `Show all ${projects.length}`}
          </button>
        ) : null}
      </section>

      <section className="dept-section">
        <SectionHeading
          title="Standalone work"
          count={tasks.length}
          action={
            onAssignTask ? (
              <Button variant="outline" size="sm" onClick={() => onAssignTask()}>
                <Plus data-icon="inline-start" /> Assign task
              </Button>
            ) : undefined
          }
        />
        <p className="dept-section-note">Open tasks that are not sitting under a project.</p>
        {tasks.length === 0 ? (
          <p className="empty-state empty-state-compact">No standalone tasks right now.</p>
        ) : (
          <ul className="dept-rows">
            {visibleTasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="dept-row"
                  onClick={() => onOpenTask?.(task.id)}
                  disabled={!onOpenTask}
                >
                  <span className="dept-row-main">
                    <strong>{task.title}</strong>
                    <span>Due {formatDue(task.dueDate)}</span>
                  </span>
                  {task.assignee ? (
                    <UserAvatar
                      initials={task.assignee.initials}
                      url={task.assignee.avatarUrl}
                      color={task.assignee.avatarColor}
                      size="sm"
                    />
                  ) : null}
                  <StatusBadge status={task.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {tasks.length > LIST_PREVIEW ? (
          <button type="button" className="row-action" onClick={() => setShowAllTasks((open) => !open)}>
            {showAllTasks ? 'Show fewer' : `Show all ${tasks.length}`}
          </button>
        ) : null}
      </section>
    </div>
  )
}

/**
 * Right-side slide-over used by org-wide viewers. Sits below the modal layer so a
 * task or project opened from inside it stacks on top rather than behind.
 */
export function DepartmentDrawer({
  onClose,
  ...props
}: DepartmentDetailProps & { onClose: () => void }) {
  const panelRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const { department } = props
  const headingId = `dept-drawer-${department.id}`

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => restoreFocusRef.current?.focus?.()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div className="drawer-scrim" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="dept-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dept-drawer-head">
          <div className={`department-icon department-${department.color}`}>{department.name.slice(0, 1)}</div>
          <div className="dept-drawer-title">
            <h2 id={headingId}>{department.name}</h2>
            <p>
              {ledBy(department.owner ? fullName(department.owner) : null)}
              {department.teams?.length ? ` · ${department.teams.length} teams` : ''}
            </p>
          </div>
          <StatusBadge status={departmentHealth(department)} />
          <button type="button" className="close-button" aria-label="Close department details" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="dept-drawer-body">
          <DepartmentDetailBody {...props} />
        </div>
      </aside>
    </div>
  )
}
