'use client'

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import {
  Activity,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  FileText,
  Home,
  Inbox,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Plus,
  Settings2,
  ShieldCheck,
  Target,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { CreateTaskDialog } from '@/components/create-task-dialog'
import { CreateProjectDialog } from '@/components/create-project-dialog'
import { CreateResponsibilityDialog } from '@/components/create-responsibility-dialog'
import { TaskDetailSheet, type TaskDetailTab, type TaskReportEntry } from '@/components/task-detail-sheet'
import { InviteEmployeeDialog } from '@/components/invite-employee-dialog'
import { OrgSettingsPanel } from '@/components/org-settings-panel'
import { AdminOfficeDesk } from '@/components/admin-office-desk'
import { ProjectWorkspace } from '@/components/project-workspace'
import { WorkhubShell, useCollapsedSidebar } from '@/components/workhub-shell'
import { UserAvatar } from '@/components/user-avatar'
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from '@/lib/constants'
import { formatDue, formatLongDate, formatRelative, fullName, greeting, categoryLabel, ledBy, toDateInputValue } from '@/lib/format'
import { signOutToLogin } from '@/lib/auth/sign-out-client'
import { resolveWorkspaceView, type WorkspaceView } from '@/lib/workspace-nav'
import type { OfficeDesk } from '@/lib/admin-office/types'
import { DepartmentDetailBody, DepartmentDrawer } from '@/components/department-detail'
import {
  departmentHealth,
  departmentPosture,
  departmentPostureShowsGrid,
  departmentViewCopy,
} from '@/lib/department-view'
import {
  canCreateWork as roleCanCreateWork,
  canAssignDepartmentWork as roleCanAssignDepartmentWork,
  isDepartmentMemberCreator as roleIsDepartmentMemberCreator,
  canDeleteTask,
  canEditTask,
  canProgressTask,
  canManageOrg,
  canManageUsers,
  canRunAdminOffice,
  canSubmitLeadershipRequest,
  canSubmitWorkRequest,
  canViewCompanyReports,
  canViewDepartmentReports,
  inviteableRoleKeys,
} from '@/lib/auth/permissions'
import { canSelfCreateTask, isSponsoredContributor } from '@/lib/auth/sponsored'
import {
  addAttachment,
  addComment,
  deleteAttachment,
  deleteComment,
  deleteTask,
  deleteTasks,
  deleteTaskDependency,
  createTaskDependency,
  approveTask,
  approveDeliverable,
  updateResponsibilityOwner,
  rejectTask,
  rejectDeliverable,
  requestTaskRevision,
  completeTask,
  createDeliverable,
  markAllNotificationsRead,
  markNotificationRead,
  createManagementRequest,
  exportReportCsv,
  updateManagementRequestStatus,
  updateNotificationPreferences,
  sendWorkspaceReminder,
  promoteWorkRequest,
  submitDeliverable,
  verifyDeliverable,
  toggleUserStatus,
  updateTaskDetails,
  updateTaskProgress,
  updateTaskStatus,
  setTaskPlacement,
} from '@/app/actions'
import { cancelInvite, resendInvite } from '@/app/invite-actions'
import { CreateSelfTaskDialog } from '@/components/create-self-task-dialog'
import { CreateDepartmentDialog } from '@/components/create-department-dialog'
import { RemovePersonDialog } from '@/components/remove-person-dialog'
import { EditPersonDialog } from '@/components/edit-person-dialog'
import type { Person } from '@/lib/types'
import { taskCategoryEnum, taskPriorityEnum, taskStatusEnum } from '@/lib/db/schema'
import { PRODUCT_NAME } from '@/lib/branding'

type View = WorkspaceView

type TaskStatus = (typeof taskStatusEnum.enumValues)[number]
type TaskCategory = (typeof taskCategoryEnum.enumValues)[number]
type TaskPriority = (typeof taskPriorityEnum.enumValues)[number]

type DbComment = {
  id: string
  body: string
  createdAt: string | Date
  userId?: string | null
  user: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
}

type DbAttachment = {
  id: string
  label: string
  url: string
  publicId?: string | null
  bytes?: number | null
  mimeType?: string | null
  originalName?: string | null
  createdAt: string | Date
  userId?: string | null
}

type DbTask = {
  id: string
  title: string
  description?: string | null
  category: TaskCategory
  categoryCustom?: string | null
  priority: TaskPriority
  status: TaskStatus
  progress?: number
  assigneeId?: string | null
  createdById?: string | null
  dueDate: string | Date | null
  startDate?: string | Date | null
  assignee: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  department: { id?: string; name: string; color?: string } | null
  projectId?: string | null
  projectTitle?: string | null
  milestoneId?: string | null
  milestoneTitle?: string | null
  assigneeDepartmentId?: string | null
  projectHomeDepartmentId?: string | null
  contributingDepartmentIds?: string[]
  projectTeamUserIds?: string[]
  comments?: DbComment[]
  attachments?: DbAttachment[]
  approvals?: Array<{
    id: string
    status: string
    decisionReason: string | null
    createdAt: string | Date
    requestor?: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
    approver?: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  }>
  deliverables?: Array<{
    id: string
    title: string
    description?: string | null
    status: string
    evidenceUrl: string | null
    evidencePublicId?: string | null
    evidenceBytes?: number | null
    evidenceOriginalName?: string | null
    submissionNotes?: string | null
    decisionReason?: string | null
  }>
  blockingDependencies?: Array<{
    id: string
    blockedTask: { id: string; title: string; status: TaskStatus; dueDate: string | Date | null }
  }>
  blockedByDependencies?: Array<{
    id: string
    blockingTask: { id: string; title: string; status: TaskStatus; dueDate: string | Date | null }
  }>
  reports?: Array<{
    id: string
    title: string
    body: string
    createdAt: string | Date
    emailedAt?: string | Date | null
    author: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  }>
}

type DeadlineFilter = 'all' | 'overdue' | 'today' | 'week' | 'attention' | 'stuck'

const TASK_STATUSES = taskStatusEnum.enumValues

const TASK_PAGE_SIZES = [8, 12, 24] as const
const DEFAULT_TASK_PAGE_SIZE = 8

function parseDeadlineFilter(value: string | null): DeadlineFilter {
  if (value === 'overdue' || value === 'today' || value === 'week' || value === 'attention' || value === 'stuck') return value
  return 'all'
}

function parseTaskFilter(value: string | null): 'All' | TaskStatus {
  if (value && (TASK_STATUSES as readonly string[]).includes(value)) return value as TaskStatus
  return 'All'
}

function parseTaskPage(value: string | null) {
  const page = Number(value)
  if (!Number.isInteger(page) || page < 1) return 1
  return page
}

function parseTaskPageSize(value: string | null) {
  const size = Number(value)
  if ((TASK_PAGE_SIZES as readonly number[]).includes(size)) return size
  return DEFAULT_TASK_PAGE_SIZE
}

function visiblePageNumbers(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const picked = new Set([1, total, current, current - 1, current + 1])
  if (current <= 3) {
    picked.add(2)
    picked.add(3)
    picked.add(4)
  }
  if (current >= total - 2) {
    picked.add(total - 1)
    picked.add(total - 2)
    picked.add(total - 3)
  }
  const nums = [...picked].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right)
  const items: Array<number | 'gap'> = []
  let last = 0
  for (const page of nums) {
    if (last && page > last + 1) items.push('gap')
    items.push(page)
    last = page
  }
  return items
}

function taskRowStatusClass(status: TaskStatus) {
  return `task-row--${status.replaceAll('_', '-')}`
}

function sortDepartmentsForScorecard(departments: DbDepartment[]) {
  return [...departments].sort((left, right) => {
    if (left.total === 0 && right.total !== 0) return 1
    if (right.total === 0 && left.total !== 0) return -1
    if (left.progress !== right.progress) return left.progress - right.progress
    return left.name.localeCompare(right.name)
  })
}

function AttentionTiles({
  blocked,
  overdue,
  dueToday,
  dueThisWeek,
  unreadCount,
  onStuck,
  onOverdue,
  onToday,
  onWeek,
  onAlerts,
}: {
  blocked: number
  overdue: number
  dueToday: number
  dueThisWeek: number
  unreadCount: number
  onStuck: () => void
  onOverdue: () => void
  onToday: () => void
  onWeek: () => void
  onAlerts: () => void
}) {
  const tiles = [
    { key: 'stuck', count: blocked, label: 'Stuck', detail: 'Blocked or waiting on approval', tone: 'attention-tile-alert', icon: <CircleAlert aria-hidden="true" />, onClick: onStuck },
    { key: 'overdue', count: overdue, label: 'Overdue', detail: 'Past due and still open', tone: 'attention-tile-warn', icon: <Clock3 aria-hidden="true" />, onClick: onOverdue },
    { key: 'today', count: dueToday, label: 'Due today', detail: 'Needs a decision before close of day', tone: 'attention-tile-info', icon: <CalendarDays aria-hidden="true" />, onClick: onToday },
    { key: 'week', count: dueThisWeek, label: 'This week', detail: 'Coming due in the next 7 days', tone: 'attention-tile-note', icon: <Target aria-hidden="true" />, onClick: onWeek },
    { key: 'alerts', count: unreadCount, label: 'Alerts', detail: 'Unread items in your inbox', tone: 'attention-tile-navy', icon: <Bell aria-hidden="true" />, onClick: onAlerts },
  ]

  return (
    <div className="attention-tiles">
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          className={`attention-tile ${tile.tone}${tile.count === 0 ? ' is-quiet' : ''}`}
          onClick={tile.onClick}
        >
          <span className="attention-tile-icon">{tile.icon}</span>
          <span className="attention-tile-copy">
            <strong>{tile.label}</strong>
            <span>{tile.detail}</span>
          </span>
          <em>{tile.count}</em>
          <ChevronRight aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

function ScorecardList({
  departments,
  onOpen,
}: {
  departments: DbDepartment[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="scorecard-list">
      {sortDepartmentsForScorecard(departments).map((department) => (
        <button
          key={department.id}
          type="button"
          className="scorecard-row"
          onClick={() => onOpen(department.id)}
        >
          <i className={`scorecard-swatch fill-${department.color}`} />
          <div className="scorecard-copy">
            <strong>{department.name}</strong>
            <span>
              {department.completed}/{department.total} tasks
              {department.owner ? ` · ${fullName(department.owner)}` : ''}
            </span>
            <div className="progress-track">
              <div className={`progress-fill fill-${department.color}`} style={{ width: `${department.progress}%` }} />
            </div>
          </div>
          <em>{department.progress}%</em>
          <StatusBadge status={departmentHealth(department)} />
        </button>
      ))}
    </div>
  )
}

type DbDepartment = {
  id: string
  name: string
  slug?: string
  owner?: { firstName: string; lastName: string } | null
  progress: number
  total: number
  completed: number
  active?: number
  blocked?: number
  overdue?: number
  color: string
  teams?: { id: string }[]
}

type DbResponsibility = {
  id: string
  title: string
  category: string
  status: string
  owner: { id?: string; initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null }
  department?: { name: string } | null
}

type DbActivityEvent = {
  id: string
  action: string
  summary: string
  createdAt: string | Date
  actor?: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
}

type DbProject = {
  id: string
  title: string
  description?: string | null
  owner: string
  ownerId?: string
  progress: number
  completionRate: number
  status: string
  risk: string
  overdueCount: number
  blockedCount: number
  milestoneCount: number
  nextMilestone: string
  nextMilestoneDue?: string | Date | null
  tasks: string
  taskIds?: string[]
  unscheduledTaskIds?: string[]
  departmentId?: string | null
  department?: string | null
  partnerId?: string | null
  partner?: string | null
  contributingDepartments?: Array<{ id: string; name: string }>
  participation?: 'home' | 'contributing' | 'member'
  projectStatus?: string
  health?: string
  activity?: Array<{
    id: string
    summary: string
    createdAt: string | Date
    actor?: { initials: string; firstName: string; lastName: string; avatarUrl?: string | null; avatarColor?: string | null } | null
  }>
  milestones?: Array<{
    id: string
    title: string
    status: string
    startDate?: string | Date | null
    dueDate: string | Date | null
    progress: number
    taskIds: string[]
  }>
  team?: Array<{ id: string; firstName: string; lastName: string; initials: string; avatarUrl?: string | null; avatarColor?: string | null }>
}

type DbNotification = {
  id: string
  type: string
  title: string
  body: string
  entityType?: string | null
  entityId?: string | null
  readAt: string | Date | null
  createdAt: string | Date
}

type DbManagementRequest = {
  id: string
  title: string
  description?: string | null
  priority: string
  status: string
  kind?: string | null
  responseNotes?: string | null
  requestor?: { firstName: string; lastName: string } | null
  assignee?: { firstName: string; lastName: string } | null
}

type NotificationPreferences = {
  deadlineAlerts: number
  escalationAlerts: number
  approvalAlerts: number
  managementRequestAlerts: number
  dailySummary: number
}

type Metrics = {
  active: number
  departments: number
  dueThisWeek: number
  dueToday: number
  attention: number
  overdue: number
  blocked: number
  completionRate: number
}

type Employee = Person & {
  email?: string
  teamId?: string | null
  managerId?: string | null
  department?: { id?: string; name: string; slug?: string } | null
  team?: { id?: string; name: string } | null
  manager?: { id?: string; firstName: string; lastName: string } | null
  status?: string
  roles?: { role: { key: string; name: string } }[]
}

export default function WorkhubDashboardDB({
  initialTasks,
  initialDepartments,
  initialActivity,
  upcoming,
  metrics,
  people,
  directory,
  departmentDirectory,
  responsibilities,
  allActivity,
  myTasks: initialMyTasks,
  myMetrics,
  projects,
  reportMetrics,
  currentUserId,
  currentUserRoles,
  initialView = 'Overview',
  myTaskCount,
  initialNotifications = [],
  unreadNotificationCount = 0,
  managementRequests: initialManagementRequests = [],
  notificationPreferences: initialNotificationPreferences = {
    deadlineAlerts: 1,
    escalationAlerts: 1,
    approvalAlerts: 1,
    managementRequestAlerts: 1,
    dailySummary: 1,
  },
  workspaceRoles = [],
  workspaceTeams = [],
  companyName = 'GCS Operations',
  companyShortName = 'GCS',
  officeDesk = null,
}: {
  initialTasks: DbTask[]
  initialDepartments: DbDepartment[]
  initialActivity: DbActivityEvent[]
  upcoming: DbTask[]
  metrics: {
    active: number
    dueThisWeek: number
    dueToday: number
    attention: number
    overdue: number
    blocked: number
    completionRate: number
    departments: number
  }
  people: Employee[]
  directory?: Employee[]
  departmentDirectory?: DbDepartment[]
  responsibilities: DbResponsibility[]
  allActivity: DbActivityEvent[]
  myTasks: DbTask[]
  myMetrics: { assigned: number; inProgress: number; completed: number }
  projects: DbProject[]
  reportMetrics: {
    completionRate: number
    overdue: number
    blocked: number
    dueToday?: number
    dueThisWeek?: number
    active?: number
    attention?: number
    activeProjects: number
    teamCoverage: number
    departments: Array<{ id: string; name: string; progress: number; color?: string; total: number; completed: number }>
    peopleLoad?: Array<{ id: string; name: string; initials: string; active: number; overdue: number }>
  }
  currentUserId: string
  currentUserRoles: string[]
  initialView?: View
  myTaskCount: number
  initialNotifications: DbNotification[]
  unreadNotificationCount: number
  managementRequests: DbManagementRequest[]
  notificationPreferences: NotificationPreferences
  workspaceRoles?: { key: string; name: string; description?: string | null }[]
  workspaceTeams?: { id: string; name: string; departmentId?: string; department?: { name: string } | null }[]
  companyName?: string
  companyShortName?: string
  officeDesk?: OfficeDesk | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSidebar()
  const [query, setQuery] = useState('')
  const commandQuery = query.trim().toLowerCase()
  const [projectStatusFilter, setProjectStatusFilter] = useState<'all' | 'On track' | 'At risk' | 'Needs review'>('all')
  const [tasks, setTasks] = useState(initialTasks)
  const [responsibilityRows, setResponsibilityRows] = useState(responsibilities)
  const [selectedTask, setSelectedTask] = useState<DbTask | null>(null)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showCreateDepartment, setShowCreateDepartment] = useState(false)
  const [showSelfTask, setShowSelfTask] = useState(false)
  const [notificationRows, setNotificationRows] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(unreadNotificationCount)
  const [managementRequestRows, setManagementRequestRows] = useState(initialManagementRequests)
  const [requestTitle, setRequestTitle] = useState('')
  const [requestDescription, setRequestDescription] = useState('')
  const [requestPriority, setRequestPriority] = useState('medium')
  const [requestAssigneeId, setRequestAssigneeId] = useState('')
  const [reminderMessage, setReminderMessage] = useState('')
  const [reminderTargetId, setReminderTargetId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createAssigneeId, setCreateAssigneeId] = useState('')
  const [createFromDepartment, setCreateFromDepartment] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)
  const [createTaskMilestoneId, setCreateTaskMilestoneId] = useState('')
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showCreateResp, setShowCreateResp] = useState(false)
  const [respFilter, setRespFilter] = useState<'all' | 'mine'>('all')
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [attachLabel, setAttachLabel] = useState('')
  const [attachUrl, setAttachUrl] = useState('')
  const [showAttachForm, setShowAttachForm] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailsSaved, setDetailsSaved] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const [dependencyBlockingTaskId, setDependencyBlockingTaskId] = useState('')
  const [deleteTaskConfirm, setDeleteTaskConfirm] = useState<{ id: string; title: string } | null>(null)
  const [removePersonTarget, setRemovePersonTarget] = useState<Employee | null>(null)
  const [editPersonTarget, setEditPersonTarget] = useState<Employee | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [approvalReason, setApprovalReason] = useState('')
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [deliverableTitle, setDeliverableTitle] = useState('')
  const [deliverableDescription, setDeliverableDescription] = useState('')
  const [deliverableEvidenceById, setDeliverableEvidenceById] = useState<Record<string, string>>({})
  const [deliverableEvidenceMetaById, setDeliverableEvidenceMetaById] = useState<Record<string, { publicId?: string; bytes?: number; mimeType?: string; originalName?: string }>>({})
  const [deliverableNotesById, setDeliverableNotesById] = useState<Record<string, string>>({})
  const [deliverableError, setDeliverableError] = useState<string | null>(null)
  const [deliverableDecisionById, setDeliverableDecisionById] = useState<Record<string, string>>({})
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [detailTab, setDetailTab] = useState<TaskDetailTab>('overview')
  const [clockLabel, setClockLabel] = useState('')
  const [hello, setHello] = useState('Hello')
  const [isPending, startTransition] = useTransition()

  const currentUser = useMemo(
    () => people.find((p) => p.id === currentUserId) ?? null,
    [people, currentUserId],
  )

  useEffect(() => {
    setClockLabel(formatLongDate())
    setHello(greeting())
  }, [])

  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  useEffect(() => {
    setSelectedTaskIds((current) => {
      const valid = new Set(tasks.map((task) => task.id))
      const next = new Set([...current].filter((id) => valid.has(id)))
      return next.size === current.size ? current : next
    })
  }, [tasks])
  const activePeople = useMemo(
    () => people.filter((person) => person.status !== 'inactive'),
    [people],
  )
  const pickerPeople = useMemo(
    () => (directory && directory.length > 0 ? directory : people).filter((person) => person.status !== 'inactive'),
    [directory, people],
  )
  const pickerDepartments = (departmentDirectory && departmentDirectory.length > 0
    ? departmentDirectory
    : initialDepartments
  ).map((department) => ({
    id: department.id,
    name: department.name,
    owner: 'owner' in department ? department.owner ?? null : null,
  }))

  const roleSet = useMemo(() => new Set(currentUserRoles), [currentUserRoles])
  const actor = useMemo(
    () => ({
      id: currentUserId,
      departmentId: currentUser?.departmentId ?? null,
      managerId: currentUser?.managerId ?? null,
      department: currentUser?.departmentId
        ? {
            id: currentUser.departmentId,
            slug:
              currentUser.department?.slug ??
              initialDepartments.find((department) => department.id === currentUser.departmentId)?.slug,
            name: currentUser.department?.name,
          }
        : null,
      roles: currentUserRoles.map((key) => ({ role: { key } })),
    }),
    [
      currentUserId,
      currentUser?.departmentId,
      currentUser?.managerId,
      currentUser?.department?.name,
      currentUser?.department?.slug,
      currentUserRoles,
      initialDepartments,
    ],
  )
  const isManagement = roleSet.has('admin') || roleSet.has('managing_director')
  const isDepartmentLeader = roleSet.has('department_head') || roleSet.has('manager')
  const canCreateWork = roleCanCreateWork(actor)
  const canAssignDepartmentWork = roleCanAssignDepartmentWork(actor)
  const isMemberCreator = roleIsDepartmentMemberCreator(actor)
  const canLogOwnTask = canSelfCreateTask(actor)
  const sponsoredDesk = isSponsoredContributor(actor)
  const sponsorName = currentUser?.manager
    ? `${currentUser.manager.firstName} ${currentUser.manager.lastName}`
    : null
  const needsSponsor = sponsoredDesk && !currentUser?.managerId
  const mySelfTaskProjects = useMemo(
    () =>
      projects
        .filter(
          (project) =>
            project.projectStatus !== 'archived' &&
            (project.ownerId === currentUserId || project.team?.some((member) => member.id === currentUserId)),
        )
        .map((project) => ({
          id: project.id,
          title: project.title,
          departmentId: project.departmentId,
          department: project.department,
          contributingDepartmentIds: project.contributingDepartments?.map((entry) => entry.id) ?? [],
          teamUserIds: project.team?.map((member) => member.id) ?? [],
          milestones: project.milestones?.map((milestone) => ({ id: milestone.id, title: milestone.title })) ?? [],
        })),
    [projects, currentUserId],
  )
  const currentUserDepartmentId = currentUser?.departmentId ?? null
  const posture = departmentPosture({ roleKeys: currentUserRoles, departmentId: currentUserDepartmentId })
  const showsDepartmentGrid = departmentPostureShowsGrid(posture)
  // Everyone belonging to a department can open it; only management browses the set.
  const canViewDepartments = posture !== 'none'
  const ownDepartment = initialDepartments.find((department) => department.id === currentUserDepartmentId) ?? null
  const departmentCopy = departmentViewCopy(posture, ownDepartment?.name)
  const canViewProjects = isManagement || isDepartmentLeader || projects.length > 0
  const canViewReports = canViewCompanyReports(actor) || canViewDepartmentReports(actor)
  const canManagePeople = canManageUsers(actor)
  const canEditOrg = canManageOrg(actor)
  const runsOffice = canRunAdminOffice(actor)
  const canSubmitRequests = canSubmitLeadershipRequest(actor)
  const canRequestWork = canSubmitWorkRequest(actor)
  const inviteRoleKeys = inviteableRoleKeys(actor)
  const canInvitePeople = inviteRoleKeys.length > 0
  const inviteRoles = workspaceRoles.filter((role) => inviteRoleKeys.includes(role.key as (typeof inviteRoleKeys)[number]))
  const canEditSelected = selectedTask ? canEditTask(actor, selectedTask) : false
  const canProgressSelected = selectedTask ? canProgressTask(actor, selectedTask) : false

  const navItems: { label: View; displayLabel?: string; icon: typeof LayoutDashboard; count?: number; group: string }[] = [
    ...(isManagement
      ? [{ label: 'Home' as const, icon: Home, group: 'Lead' }]
      : [{ label: 'Overview' as const, icon: LayoutDashboard, group: 'Workspace' }]),
    { label: 'My tasks', icon: Check, count: myTaskCount, group: isManagement ? 'Work' : 'Workspace' },
    { label: 'Responsibilities', icon: ShieldCheck, group: isManagement ? 'Work' : 'Workspace' },
    ...(canViewDepartments
      ? [{ label: 'Departments' as const, displayLabel: departmentCopy.navLabel, icon: UsersRound, group: 'Delivery' }]
      : []),
    ...(canViewProjects ? [{ label: 'Projects' as const, icon: BriefcaseBusiness, group: 'Delivery' }] : []),
    ...(canViewReports ? [{ label: 'Reports' as const, icon: FileText, group: isManagement ? 'Lead' : 'Delivery' }] : []),
    { label: 'Activity', icon: Activity, group: isManagement ? 'Work' : 'Workspace' },
    ...(runsOffice
      ? [{ label: 'Admin office' as const, icon: Building2, count: officeDesk?.pendingCount ?? 0, group: isManagement ? 'Lead' : 'Workspace' }]
      : []),
    { label: 'My office' as const, icon: Inbox, count: officeDesk?.minePending ?? 0, group: isManagement ? 'Work' : 'Workspace' },
    ...((canManagePeople || canEditOrg) ? [{ label: 'Settings' as const, icon: Settings2, group: 'Account' }] : []),
  ]

  const allowedViews = new Set(navItems.map((item) => item.label))
  const defaultLandingView: View = isManagement ? 'Home' : isDepartmentLeader ? 'Departments' : 'My tasks'
  const activeNav = resolveWorkspaceView(
    searchParams.get('view') ?? initialView,
    allowedViews,
    defaultLandingView,
    isManagement,
  )
  const selectedProjectId = searchParams.get('project')
  // Single-department viewers never browse a set, so their own department is always
  // the selection and the `?department=` param is irrelevant to them.
  const selectedDepartmentId = showsDepartmentGrid ? searchParams.get('department') : currentUserDepartmentId
  const allWorkScope = searchParams.get('scope') === 'all'
  const deadlineFilter = parseDeadlineFilter(searchParams.get('deadline'))
  const filter = parseTaskFilter(searchParams.get('status'))
  const employeeFilter = searchParams.get('employee') ?? 'all'
  const departmentFilter = searchParams.get('dept') ?? 'all'
  const taskPageSize = parseTaskPageSize(searchParams.get('per'))
  const requestedTaskPage = parseTaskPage(searchParams.get('page'))
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedDepartment = initialDepartments.find((department) => department.id === selectedDepartmentId) ?? null
  const canManageSelectedProject = Boolean(
    selectedProject &&
      (isManagement ||
        selectedProject.ownerId === currentUserId ||
        (isDepartmentLeader &&
          currentUser?.departmentId &&
          selectedProject.departmentId === currentUser.departmentId)),
  )

  function patchQuery(updates: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(searchParams.toString())
    const resetsPage = ['status', 'deadline', 'dept', 'employee', 'scope', 'per'].some((key) => key in updates) && !('page' in updates)
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === 'all' || value === 'All' || (key === 'page' && value === '1')) params.delete(key)
      else params.set(key, value)
    }
    if (resetsPage) params.delete('page')
    router.push(`/?${params.toString()}`, { scroll: false })
  }

  function nav(
    view: View,
    extras?: {
      project?: string | null
      department?: string | null
      deadline?: DeadlineFilter
      departmentFilter?: string
      employee?: string
      status?: 'All' | TaskStatus
      scope?: 'all'
    },
  ) {
    setMobileOpen(false)
    setCommandOpen(false)
    setShowNotifications(false)
    setShowProfile(false)
    if (!extras) setProjectStatusFilter('all')

    const params = new URLSearchParams()
    params.set('view', view)
    if (extras?.project) params.set('project', extras.project)
    if (extras?.department) params.set('department', extras.department)
    if (extras?.scope === 'all') params.set('scope', 'all')
    if (extras?.deadline && extras.deadline !== 'all') params.set('deadline', extras.deadline)
    if (extras?.status && extras.status !== 'All') params.set('status', extras.status)
    if (extras?.employee && extras.employee !== 'all') params.set('employee', extras.employee)
    if (extras?.departmentFilter && extras.departmentFilter !== 'all') params.set('dept', extras.departmentFilter)
    router.push(`/?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        setShowNotifications(false)
        setShowProfile(false)
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
        setMobileOpen(false)
        setShowNotifications(false)
        setShowProfile(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const deepTaskId = searchParams.get('task')
    if (!deepTaskId) return
    const match =
      tasks.find((task) => task.id === deepTaskId) ??
      initialMyTasks.find((task) => task.id === deepTaskId) ??
      null
    if (!match) return
    setSelectedTask(match)
    setDetailTab('reports')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('task')
    const next = params.toString()
    router.replace(next ? `/?${next}` : '/', { scroll: false })
  }, [searchParams, tasks, initialMyTasks, router])

  const currentView = activeNav
  const currentProjectId = selectedProjectId
  const currentDepartmentId = selectedDepartmentId
  const currentProjectTaskIds = selectedProject?.taskIds ?? []
  const taskSource = currentView === 'My tasks' && !allWorkScope ? initialMyTasks : tasks
  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>
    for (const task of taskSource) counts[task.status] += 1
    return counts
  }, [taskSource])

  const visibleTasks = taskSource.filter((task) => {
        const matchesDepartment =
          departmentFilter === 'all' ||
          (task.department?.id ? task.department.id === departmentFilter : false)
        const matchesEmployee =
          employeeFilter === 'all' || task.assigneeId === employeeFilter

        const todayStr = new Date().toISOString().slice(0, 10)
        const weekEnd = new Date()
        weekEnd.setDate(weekEnd.getDate() + 7)
        const weekEndStr = weekEnd.toISOString().slice(0, 10)

        const dueDateStr = task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : null
        const isClosed = ['completed', 'cancelled'].includes(task.status)
        const isOverdueTask = Boolean(dueDateStr && dueDateStr < todayStr && !isClosed)
        const matchesDeadline =
          deadlineFilter === 'all' ||
          (deadlineFilter === 'overdue' && isOverdueTask) ||
          (deadlineFilter === 'today' && dueDateStr === todayStr) ||
          (deadlineFilter === 'week' && Boolean(dueDateStr && dueDateStr >= todayStr && dueDateStr <= weekEndStr)) ||
          (deadlineFilter === 'attention' && (isOverdueTask || task.status === 'blocked' || task.status === 'pending_approval')) ||
          (deadlineFilter === 'stuck' && (task.status === 'blocked' || task.status === 'pending_approval'))

        const matchesProject =
          currentView !== 'Projects' ||
          !currentProjectId ||
          currentProjectTaskIds.includes(task.id)
        const matchesDepartmentFocus =
          !currentDepartmentId ||
          (task.department?.id ? task.department.id === currentDepartmentId : false)
        const matchesStandalone =
          currentView !== 'Departments' || !currentDepartmentId || !task.projectId

        return (
          (filter === 'All' || task.status === filter) &&
          matchesDepartment &&
          matchesDeadline &&
          matchesEmployee &&
          matchesProject &&
          (currentView === 'Departments' ? matchesDepartmentFocus : true) &&
          matchesStandalone
        )
      })

  const taskPageCount = Math.max(1, Math.ceil(visibleTasks.length / taskPageSize))
  const taskPage = Math.min(requestedTaskPage, taskPageCount)
  const pagedTasks = visibleTasks.slice((taskPage - 1) * taskPageSize, taskPage * taskPageSize)
  const taskRangeStart = visibleTasks.length === 0 ? 0 : (taskPage - 1) * taskPageSize + 1
  const taskRangeEnd = Math.min(taskPage * taskPageSize, visibleTasks.length)

  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        const matchesStatus = projectStatusFilter === 'all' || project.status === projectStatusFilter
        const matchesOwner =
          employeeFilter === 'all' ||
          people.some((person) => person.id === employeeFilter && `${person.firstName} ${person.lastName}` === project.owner)
        const isArchived = project.projectStatus === 'archived'

        return !isArchived && matchesStatus && matchesOwner
      }),
    [projects, projectStatusFilter, employeeFilter, people],
  )

  const departmentPeople = useMemo(
    () => (selectedDepartmentId ? people.filter((person) => person.department?.id === selectedDepartmentId) : []),
    [people, selectedDepartmentId],
  )
  const departmentProjects = useMemo(
    () =>
      selectedDepartmentId
        ? projects.filter(
            (project) =>
              project.projectStatus !== 'archived' &&
              (project.departmentId === selectedDepartmentId ||
                project.contributingDepartments?.some((entry) => entry.id === selectedDepartmentId)),
          )
        : [],
    [projects, selectedDepartmentId],
  )
  const departmentStandaloneTasks = useMemo(
    () =>
      selectedDepartmentId
        ? tasks.filter(
            (task) =>
              !task.projectId &&
              task.department?.id === selectedDepartmentId &&
              task.status !== 'completed' &&
              task.status !== 'cancelled',
          )
        : [],
    [tasks, selectedDepartmentId],
  )

  function handleComplete(taskId: string) {
    startTransition(async () => {
      const res = await completeTask(taskId)
      if (!res || !('error' in res)) {
        setTasks((current) =>
          current.map((t) => (t.id === taskId ? { ...t, status: 'completed' } : t)),
        )
        setSelectedTask((current) =>
          current?.id === taskId ? { ...current, status: 'completed' } : current,
        )
      }
    })
  }

  function handleStatusChange(taskId: string, status: TaskStatus) {
    startTransition(async () => {
      const res = await updateTaskStatus(taskId, status)
      if (!res || !('error' in res)) {
        setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, status } : t)))
        setSelectedTask((current) => (current?.id === taskId ? { ...current, status } : current))
      }
    })
  }

  function handleProgressChange(taskId: string, progress: number) {
    startTransition(async () => {
      const res = await updateTaskProgress(taskId, progress)
      if (!res || !('error' in res)) {
        const newStatus = progress === 100 ? 'completed' as const : progress > 0 && selectedTask?.status === 'not_started' ? 'in_progress' as const : undefined
        setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, progress, ...(newStatus ? { status: newStatus } : {}) } : t)))
        setSelectedTask((current) => current?.id === taskId ? { ...current, progress, ...(newStatus ? { status: newStatus } : {}) } : current)
      }
    })
  }

  function handleAddComment(taskId: string) {
    if (!commentText.trim()) return
    const body = commentText.trim()
    startTransition(async () => {
      const res = await addComment(taskId, body)
      if (res && 'error' in res && res.error) {
        setCommentError(res.error)
        return
      }
      setCommentError(null)
      const saved = res && 'comment' in res ? res.comment : null
      const newComment: DbComment = saved ?? {
        id: Date.now().toString(),
        body,
        createdAt: new Date().toISOString(),
        userId: currentUserId,
        user: currentUser
          ? {
              initials: currentUser.initials,
              firstName: currentUser.firstName,
              lastName: currentUser.lastName,
              avatarUrl: currentUser.avatarUrl,
              avatarColor: currentUser.avatarColor,
            }
          : null,
      }
      setSelectedTask((current) => current?.id === taskId ? { ...current, comments: [...(current.comments ?? []), newComment] } : current)
      setCommentText('')
    })
  }

  function handleDeleteComment(commentId: string) {
    startTransition(async () => {
      const res = await deleteComment(commentId)
      if (res && 'error' in res && res.error) {
        setCommentError(res.error)
        return
      }
      setSelectedTask((current) =>
        current ? { ...current, comments: (current.comments ?? []).filter((comment) => comment.id !== commentId) } : current,
      )
    })
  }

  async function persistAttachment(taskId: string, payload: {
    label: string
    url: string
    publicId?: string | null
    bytes?: number | null
    mimeType?: string | null
    originalName?: string | null
  }) {
    const res = await addAttachment({ taskId, ...payload })
    if (res && 'error' in res && res.error) {
      setAttachError(res.error)
      throw new Error(res.error)
    }
    setAttachError(null)
    const saved = res && 'attachment' in res ? res.attachment : null
    const newAttach: DbAttachment = saved ?? {
      id: Date.now().toString(),
      label: payload.label,
      url: payload.url,
      publicId: payload.publicId,
      bytes: payload.bytes,
      mimeType: payload.mimeType,
      originalName: payload.originalName,
      createdAt: new Date().toISOString(),
      userId: currentUserId,
    }
    setSelectedTask((current) => current?.id === taskId ? { ...current, attachments: [...(current.attachments ?? []), newAttach] } : current)
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, attachments: [...(task.attachments ?? []), newAttach] } : task))
    setAttachLabel('')
    setAttachUrl('')
    setShowAttachForm(false)
  }

  function handleAddAttachment(taskId: string) {
    if (!attachLabel.trim() || !attachUrl.trim()) return
    startTransition(async () => {
      try {
        await persistAttachment(taskId, { label: attachLabel.trim(), url: attachUrl.trim() })
      } catch {
        // persistAttachment already set attachError
      }
    })
  }

  function handleDeleteAttachment(attachmentId: string) {
    setDeletingAttachmentId(attachmentId)
    startTransition(async () => {
      const res = await deleteAttachment(attachmentId)
      setDeletingAttachmentId(null)
      if (res && 'error' in res && res.error) {
        setAttachError(res.error)
        return
      }
      setSelectedTask((current) =>
        current ? { ...current, attachments: (current.attachments ?? []).filter((item) => item.id !== attachmentId) } : current,
      )
      setTasks((current) =>
        current.map((task) =>
          task.id === selectedTask?.id
            ? { ...task, attachments: (task.attachments ?? []).filter((item) => item.id !== attachmentId) }
            : task,
        ),
      )
    })
  }

  function handleCreateDependency() {
    if (!selectedTask) return
    if (!dependencyBlockingTaskId) return
    if (dependencyBlockingTaskId === selectedTask.id) return

    startTransition(async () => {
      setDetailsError(null)
      const res = await createTaskDependency(dependencyBlockingTaskId, selectedTask.id)
      if (res && 'error' in res && res.error) {
        setDetailsError(res.error)
        return
      }
      const blocking = tasks.find((entry) => entry.id === dependencyBlockingTaskId)
      const shouldBlock = blocking ? blocking.status !== 'completed' : true
      const dependencyId = res && 'id' in res && res.id ? res.id : `local-${dependencyBlockingTaskId}`
      setSelectedTask((current) =>
        current?.id === selectedTask.id
          ? {
              ...current,
              status: shouldBlock ? 'blocked' : current.status,
              blockedByDependencies: [
                ...(current.blockedByDependencies ?? []),
                {
                  id: dependencyId,
                  blockingTask: {
                    id: dependencyBlockingTaskId,
                    title: blocking?.title ?? 'Blocking task',
                    status: blocking?.status ?? 'in_progress',
                    dueDate: blocking?.dueDate ?? null,
                  },
                },
              ],
            }
          : current,
      )
      if (shouldBlock) {
        setTasks((current) => current.map((entry) => (entry.id === selectedTask.id ? { ...entry, status: 'blocked' } : entry)))
      }
      setDependencyBlockingTaskId('')
      router.refresh()
    })
  }

  function removeTaskFromLocalState(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId))
    setSelectedTask((current) => (current?.id === taskId ? null : current))
  }

  function handleDeleteDependency(dependencyId: string) {
    if (!selectedTask) return
    startTransition(async () => {
      setDetailsError(null)
      const res = await deleteTaskDependency(dependencyId)
      if (res && 'error' in res && res.error) {
        setDetailsError(res.error)
        return
      }
      setSelectedTask((current) =>
        current
          ? {
              ...current,
              blockedByDependencies: (current.blockedByDependencies ?? []).filter((item) => item.id !== dependencyId),
              blockingDependencies: (current.blockingDependencies ?? []).filter((item) => item.id !== dependencyId),
            }
          : current,
      )
      router.refresh()
    })
  }

  function handleDeleteTaskById(taskId: string) {
    startTransition(async () => {
      setDetailsError(null)
      setDeleteError(null)
      const res = await deleteTask(taskId)
      if (res && 'error' in res && res.error) {
        setDetailsError(res.error)
        setDeleteError(res.error)
        return
      }
      setDeleteTaskConfirm(null)
      removeTaskFromLocalState(taskId)
      router.refresh()
    })
  }

  function handleBulkDeleteTasks() {
    const ids = [...selectedTaskIds]
    if (ids.length === 0) return
    startTransition(async () => {
      setBulkDeleteError(null)
      const res = await deleteTasks(ids)
      if (res && 'error' in res && res.error) {
        setBulkDeleteError(res.error)
        return
      }
      setBulkDeleteConfirm(false)
      setSelectedTaskIds(new Set())
      setTasks((current) => current.filter((task) => !ids.includes(task.id)))
      setSelectedTask((current) => (current && ids.includes(current.id) ? null : current))
      router.refresh()
    })
  }

  function openCreateTaskFromDepartment(personId?: string) {
    setCreateAssigneeId(personId ?? '')
    setCreateFromDepartment(true)
    setCreateTaskMilestoneId('')
    setShowCreate(true)
  }

  function mergeTaskReports(taskId: string, reports: TaskReportEntry[]) {
    const normalized = reports.map((report) => ({
      ...report,
      author: report.author
        ? {
            initials: report.author.initials ?? 'G',
            firstName: report.author.firstName,
            lastName: report.author.lastName,
            avatarUrl: report.author.avatarUrl,
            avatarColor: report.author.avatarColor,
          }
        : null,
    }))
    setTasks((current) => current.map((entry) => (entry.id === taskId ? { ...entry, reports: normalized } : entry)))
    setSelectedTask((current) => (current?.id === taskId ? { ...current, reports: normalized } : current))
  }

  function toggleTaskSelected(taskId: string, selected: boolean) {
    setSelectedTaskIds((current) => {
      const next = new Set(current)
      if (selected) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }

  function handleApproveCurrentTask() {
    if (!selectedTask) return
    const task = selectedTask
    startTransition(async () => {
      setApprovalError(null)
      const res = await approveTask(task.id)
      if (!res || !('error' in res)) {
        setSelectedTask((c) => (c?.id === task.id ? { ...c, status: 'in_progress' } : c))
        setApprovalReason('')
      } else {
        setApprovalError(res.error ?? 'Unable to complete this action.')
      }
    })
  }

  function handleRejectCurrentTask() {
    if (!selectedTask) return
    if (!approvalReason.trim()) return
    const task = selectedTask
    startTransition(async () => {
      setApprovalError(null)
      const res = await rejectTask(task.id, approvalReason)
      if (!res || !('error' in res)) {
        setSelectedTask((c) => (c?.id === task.id ? { ...c, status: 'blocked' } : c))
        setApprovalReason('')
      } else {
        setApprovalError(res.error ?? 'Unable to complete this action.')
      }
    })
  }

  function handleRequestRevisionCurrentTask() {
    if (!selectedTask) return
    if (!approvalReason.trim()) return
    const task = selectedTask
    startTransition(async () => {
      setApprovalError(null)
      const res = await requestTaskRevision(task.id, approvalReason)
      if (!res || !('error' in res)) {
        setSelectedTask((c) => (c?.id === task.id ? { ...c, status: 'waiting' } : c))
        setApprovalReason('')
      } else {
        setApprovalError(res.error ?? 'Unable to complete this action.')
      }
    })
  }

  function handleCreateDeliverable() {
    if (!selectedTask) return
    if (!deliverableTitle.trim()) return
    const task = selectedTask

    startTransition(async () => {
      setDeliverableError(null)
      const res = await createDeliverable(task.id, deliverableTitle, deliverableDescription)
      if (!res || !('error' in res)) {
        const newDeliverable = res.deliverable as NonNullable<DbTask['deliverables']>[number]
        setSelectedTask((current) =>
          current?.id === task.id
            ? { ...current, deliverables: [...(current.deliverables ?? []), newDeliverable] }
            : current,
        )
        setTasks((current) => current.map((t) => (t.id === task.id ? { ...t, deliverables: [...(t.deliverables ?? []), newDeliverable] } : t)))
        setDeliverableTitle('')
        setDeliverableDescription('')
      } else {
        setDeliverableError(res.error ?? 'Unable to complete this action.')
      }
    })
  }

  function handleSubmitDeliverable(deliverableId: string) {
    if (!deliverableId || !selectedTask) return
    const task = selectedTask
    const evidenceUrl = deliverableEvidenceById[deliverableId] ?? ''
    const evidenceMeta = deliverableEvidenceMetaById[deliverableId]
    const notes = deliverableNotesById[deliverableId] ?? ''
    if (!evidenceUrl.trim()) {
      setDeliverableError('Upload a file or paste an https evidence link first.')
      return
    }

    startTransition(async () => {
      setDeliverableError(null)
      const res = await submitDeliverable(deliverableId, evidenceUrl, notes, evidenceMeta)
      if (res && 'error' in res && res.error) {
        setDeliverableError(res.error)
        return
      }
      if (!res || !('deliverable' in res)) {
        setDeliverableError('Unable to submit this deliverable.')
        return
      }
      const updated = res.deliverable
      setSelectedTask((current) => {
        if (!current || current.id !== task.id) return current
        return {
          ...current,
          deliverables: (current.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
        }
      })
      setTasks((current) =>
        current.map((t) => {
          if (t.id !== selectedTask.id) return t
          return {
            ...t,
            deliverables: (t.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
          }
        }),
      )
      setDeliverableEvidenceById((m) => {
        const next = { ...m }
        delete next[deliverableId]
        return next
      })
      setDeliverableEvidenceMetaById((m) => {
        const next = { ...m }
        delete next[deliverableId]
        return next
      })
      setDeliverableNotesById((m) => {
        const next = { ...m }
        delete next[deliverableId]
        return next
      })
    })
  }

  function handleVerifyDeliverable(deliverableId: string) {
    startTransition(async () => {
      setDeliverableError(null)
      const reason = deliverableDecisionById[deliverableId] ?? ''
      const res = await verifyDeliverable(deliverableId, reason)
      if (!res || !('error' in res)) {
        const updated = res.deliverable
        setSelectedTask((current) => {
          if (!current || current.id !== selectedTask?.id) return current
          return {
            ...current,
            deliverables: (current.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
          }
        })
        setTasks((current) =>
          current.map((t) => {
            if (t.id !== selectedTask?.id) return t
            return {
              ...t,
              deliverables: (t.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
            }
          }),
        )
        setDeliverableDecisionById((m) => {
          const next = { ...m }
          delete next[deliverableId]
          return next
        })
      } else {
        setDeliverableError(res.error ?? 'Unable to complete this action.')
      }
    })
  }

  function handleApproveDeliverable(deliverableId: string) {
    startTransition(async () => {
      setDeliverableError(null)
      const res = await approveDeliverable(deliverableId)
      if (!res || !('error' in res)) {
        const updated = res.deliverable
        setSelectedTask((current) => {
          if (!current || current.id !== selectedTask?.id) return current
          return {
            ...current,
            deliverables: (current.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
          }
        })
        setTasks((current) =>
          current.map((t) => {
            if (t.id !== selectedTask?.id) return t
            return {
              ...t,
              deliverables: (t.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
            }
          }),
        )
      } else {
        setDeliverableError(res.error ?? 'Unable to complete this action.')
      }
    })
  }

  function handleRejectDeliverable(deliverableId: string) {
    const reason = deliverableDecisionById[deliverableId] ?? ''
    if (!reason.trim()) return

    startTransition(async () => {
      setDeliverableError(null)
      const res = await rejectDeliverable(deliverableId, reason)
      if (!res || !('error' in res)) {
        const updated = res.deliverable
        setSelectedTask((current) => {
          if (!current || current.id !== selectedTask?.id) return current
          return {
            ...current,
            deliverables: (current.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
          }
        })
        setTasks((current) =>
          current.map((t) => {
            if (t.id !== selectedTask?.id) return t
            return {
              ...t,
              deliverables: (t.deliverables ?? []).map((d) => (d.id === deliverableId ? updated : d)),
            }
          }),
        )
        setDeliverableDecisionById((m) => {
          const next = { ...m }
          delete next[deliverableId]
          return next
        })
      } else {
        setDeliverableError(res.error ?? 'Unable to complete this action.')
      }
    })
  }

  function handleSaveTaskDetails() {
    if (!selectedTask || !selectedTask.assigneeId) return
    const task = selectedTask
    const assigneeId = selectedTask.assigneeId

    startTransition(async () => {
      setDetailsSaving(true)
      try {
        const res = await updateTaskDetails({
          taskId: task.id,
          title: task.title,
          description: task.description ?? '',
          assigneeId,
          priority: task.priority,
          category: task.category,
          categoryCustom: task.categoryCustom ?? null,
          startDate: toDateInputValue(task.startDate) || null,
          dueDate: toDateInputValue(task.dueDate) || null,
        })

        if (res && 'error' in res && res.error) {
          setDetailsSaved(false)
          setDetailsError(res.error)
          return
        }
        setDetailsError(null)
        setDetailsSaved(true)
        setTasks((current) => current.map((t) => (t.id === task.id ? { ...task } : t)))
      } finally {
        setDetailsSaving(false)
      }
    })
  }

  async function handleSetTaskPlacement(input: {
    projectId: string | null
    milestoneId?: string | null
    newProjectTitle?: string
    newProjectDepartmentId?: string
    newProjectMilestone?: string
  }) {
    if (!selectedTask) return { error: 'Task not found.' }
    const taskId = selectedTask.id
    const result = await setTaskPlacement({
      taskId,
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      newProjectTitle: input.newProjectTitle,
      newProjectDepartmentId: input.newProjectDepartmentId,
      newProjectMilestone: input.newProjectMilestone,
    })
    if (!result || 'error' in result) return { error: result?.error ?? 'Unable to update placement.' }

    const nextProjectId = result.projectId
    const nextProjectTitle = result.projectTitle
    const nextMilestoneId = result.milestoneId
    const nextMilestoneTitle = result.milestoneTitle

    setSelectedTask((current) =>
      current?.id === taskId
        ? {
            ...current,
            projectId: nextProjectId,
            projectTitle: nextProjectTitle,
            milestoneId: nextMilestoneId,
            milestoneTitle: nextMilestoneTitle,
          }
        : current,
    )
    setTasks((current) =>
      current.map((entry) =>
        entry.id === taskId
          ? {
              ...entry,
              projectId: nextProjectId,
              projectTitle: nextProjectTitle,
              milestoneId: nextMilestoneId,
              milestoneTitle: nextMilestoneTitle,
            }
          : entry,
      ),
    )
    router.refresh()
    return result
  }

  useEffect(() => {
    setDetailsError(null)
    setDetailsSaved(false)
    setAttachError(null)
    setCommentError(null)
    setShowAttachForm(false)
    setDetailTab('overview')
  }, [selectedTask?.id])

  useEffect(() => {
    if (!selectedTask) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedTask(null)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSaveTaskDetails()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedTask])

  function handleTakeResponsibility(responsibilityId: string) {
    if (!currentUser) return

    startTransition(async () => {
      const res = await updateResponsibilityOwner(responsibilityId, currentUser.id)
      if (!res || !('error' in res)) {
        setResponsibilityRows((current) =>
          current.map((item) =>
            item.id === responsibilityId
              ? {
                  ...item,
                  owner: {
                    id: currentUser.id,
                    initials: currentUser.initials,
                    firstName: currentUser.firstName,
                    lastName: currentUser.lastName,
                    avatarUrl: currentUser.avatarUrl,
                    avatarColor: currentUser.avatarColor,
                  },
                }
              : item,
          ),
        )
      }
    })
  }

  function handleToggleUserStatus(userId: string) {
    startTransition(async () => {
      await toggleUserStatus(userId)
      router.refresh()
    })
  }

  function handleResendInvite(userId: string) {
    startTransition(async () => {
      await resendInvite(userId)
      router.refresh()
    })
  }

  function handleCancelInvite(userId: string) {
    startTransition(async () => {
      await cancelInvite(userId)
      router.refresh()
    })
  }

  function handleMarkNotificationRead(notification: DbNotification) {
    startTransition(async () => {
      await markNotificationRead(notification.id)
      setNotificationRows((rows) =>
        rows.map((row) => (row.id === notification.id ? { ...row, readAt: new Date().toISOString() } : row)),
      )
      setUnreadCount((count) => (notification.readAt ? count : Math.max(0, count - 1)))
      setShowNotifications(false)
      if (notification.entityType === 'task' && notification.entityId) {
        const task =
          tasks.find((item) => item.id === notification.entityId) ??
          initialMyTasks.find((item) => item.id === notification.entityId) ??
          null
        if (task) setSelectedTask(task)
        else nav('My tasks', { scope: 'all', deadline: notification.title.toLowerCase().includes('overdue') ? 'overdue' : 'all' })
      } else if (notification.entityType === 'management_request') {
        nav(isManagement ? 'Home' : 'Overview')
      } else if (notification.entityType === 'admin_request') {
        nav(runsOffice ? 'Admin office' : 'My office')
      } else {
        nav(isManagement ? 'Home' : 'My tasks')
      }
      router.refresh()
    })
  }

  function handleMarkAllNotificationsRead() {
    startTransition(async () => {
      await markAllNotificationsRead()
      setNotificationRows((rows) => rows.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })))
      setUnreadCount(0)
      router.refresh()
    })
  }

  function handleCreateManagementRequest(kind?: 'work' | 'leadership') {
    if (!requestTitle.trim()) return
    const formData = new FormData()
    formData.set('title', requestTitle)
    formData.set('description', requestDescription)
    formData.set('priority', requestPriority)
    if (kind) formData.set('kind', kind)
    if (requestAssigneeId) formData.set('assigneeId', requestAssigneeId)
    startTransition(async () => {
      await createManagementRequest(formData)
      setRequestTitle('')
      setRequestDescription('')
      setRequestAssigneeId('')
      router.refresh()
    })
  }

  function handleExportReport() {
    startTransition(async () => {
      const result = await exportReportCsv()
      if (!result || 'error' in result || !result.csv) return
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  function handleSendReminder() {
    if (!reminderTargetId || !reminderMessage.trim()) return
    startTransition(async () => {
      await sendWorkspaceReminder({ userId: reminderTargetId, message: reminderMessage })
      setReminderMessage('')
      setReminderTargetId('')
      router.refresh()
    })
  }

  const filteredResponsibilities = respFilter === 'mine'
    ? responsibilityRows.filter((r) => r.owner.firstName === currentUser?.firstName && r.owner.lastName === currentUser?.lastName)
    : responsibilityRows

  const recentlyCompleted = useMemo(
    () => initialMyTasks.filter((t) => t.status === 'completed').slice(0, 5),
    [initialMyTasks],
  )

  const deletablePagedTasks = useMemo(
    () => pagedTasks.filter((task) => canDeleteTask(actor, task)),
    [pagedTasks, actor],
  )
  const allPagedDeletableSelected =
    deletablePagedTasks.length > 0 && deletablePagedTasks.every((task) => selectedTaskIds.has(task.id))
  const selectedCount = selectedTaskIds.size

  const renderTasks = (title = 'Task workload', subtitle = `Recent work activity in ${PRODUCT_NAME}`) => (
    <section className="panel task-panel" id="task-workload">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {visibleTasks.length > 0 ? (
          <p className="task-panel-count">{visibleTasks.length} matching</p>
        ) : null}
      </div>
      <div className="task-toolbar">
        <div className="filter-pills" role="group" aria-label="Filter tasks">
          <button
            className={filter === 'All' ? 'filter-pill selected' : 'filter-pill'}
            onClick={() => patchQuery({ status: null })}
          >
            All<span>{taskSource.length}</span>
          </button>
          {(['in_progress', 'waiting', 'blocked', 'pending_approval', 'cancelled', 'completed', 'not_started'] as const).map((value) => (
            <button
              key={value}
              className={`filter-pill filter-status-${value.replaceAll('_', '-')} ${filter === value ? 'selected' : ''}`}
              onClick={() => patchQuery({ status: value })}
            >
              {TASK_STATUS_LABELS[value]}
              <span>{statusCounts[value]}</span>
            </button>
          ))}
        </div>
        <button className="view-all" onClick={() => patchQuery({ status: null, deadline: null, dept: null, employee: null, scope: currentView === 'My tasks' ? 'all' : null })}>
          View all <ArrowUpRight aria-hidden="true" />
        </button>
      </div>
      {deletablePagedTasks.length > 0 ? (
        <div className="task-list-select-all">
          <label className="task-select">
            <input
              type="checkbox"
              aria-label="Select all deletable tasks on this page"
              checked={allPagedDeletableSelected}
              onChange={(event) => {
                const checked = event.target.checked
                setSelectedTaskIds((current) => {
                  const next = new Set(current)
                  for (const task of deletablePagedTasks) {
                    if (checked) next.add(task.id)
                    else next.delete(task.id)
                  }
                  return next
                })
              }}
            />
          </label>
          <span>Select deletable tasks on this page</span>
        </div>
      ) : null}
      <div className="task-list">
        {pagedTasks.map((task) => {
          const canDelete = canDeleteTask(actor, task)
          const isSelected = selectedTaskIds.has(task.id)
          return (
          <div
            className={`task-row task-row-clickable ${taskRowStatusClass(task.status)}${isSelected ? ' is-selected' : ''}`}
            key={task.id}
            onClick={() => setSelectedTask(task)}
          >
            {canDelete ? (
              <label className="task-select" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select ${task.title}`}
                  checked={isSelected}
                  onChange={(event) => toggleTaskSelected(task.id, event.target.checked)}
                />
              </label>
            ) : (
              <span className="task-select" aria-hidden="true" />
            )}
            <div className={`priority-bar priority-${task.priority}`} />
            <div className="task-main">
              <strong>{task.title}</strong>
              <span>
                {categoryLabel(task.category, task.categoryCustom)}
                {task.projectTitle ? (
                  <>
                    {' '}
                    <i /> {task.projectTitle}
                  </>
                ) : (
                  <>
                    {' '}
                    <i /> Independent
                  </>
                )}{' '}
                <i /> Due {formatDue(task.dueDate)}
              </span>
            </div>
            <div className="task-owner">
              {task.assignee && (
                <>
                  <UserAvatar
                    initials={task.assignee.initials}
                    url={task.assignee.avatarUrl}
                    color={task.assignee.avatarColor}
                    size="sm"
                  />
                  <span>{fullName(task.assignee)}</span>
                </>
              )}
            </div>
            <StatusBadge status={task.status} />
            {canDeleteTask(actor, task) ? (
              <button
                className="task-delete"
                type="button"
                aria-label={`Delete ${task.title}`}
                disabled={isPending}
                onClick={(event) => {
                  event.stopPropagation()
                  setDeleteTaskConfirm({ id: task.id, title: task.title })
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="task-check"
              aria-label={`Mark ${task.title} complete`}
              onClick={(event) => {
                event.stopPropagation()
                if (task.status !== 'completed') handleComplete(task.id)
              }}
              disabled={task.status === 'completed' || task.status === 'cancelled' || isPending}
            >
              <Check aria-hidden="true" />
            </button>
          </div>
        )})}
        {visibleTasks.length === 0 && (
          <div className="empty-state">
            {canLogOwnTask && activeNav === 'My tasks' && !allWorkScope && filter === 'All' ? (
              <div className="self-task-empty">
                <p>Nothing on your queue yet — including verbal work that was never written down.</p>
                <button type="button" className="create-button" onClick={() => setShowSelfTask(true)}>
                  Add my task
                </button>
              </div>
            ) : (
              'No tasks match your search.'
            )}
          </div>
        )}
      </div>
      {visibleTasks.length > 0 ? (
        <div className="task-pager">
          <p className="task-pager-copy">
            Showing {taskRangeStart}–{taskRangeEnd} of {visibleTasks.length}
          </p>
          <div className="task-pager-controls">
            <label className="task-pager-size">
              Per page
              <select
                value={taskPageSize}
                aria-label="Tasks per page"
                onChange={(event) => patchQuery({ per: event.target.value })}
              >
                {TASK_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="task-pager-btn"
              aria-label="Previous page"
              disabled={taskPage <= 1}
              onClick={() => patchQuery({ page: String(taskPage - 1) })}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            {visiblePageNumbers(taskPage, taskPageCount).map((item, index) =>
              item === 'gap' ? (
                <span key={`gap-${index}`} className="task-pager-gap">…</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`task-pager-btn ${item === taskPage ? 'selected' : ''}`}
                  aria-current={item === taskPage ? 'page' : undefined}
                  onClick={() => patchQuery({ page: String(item) })}
                >
                  {item}
                </button>
              ),
            )}
            <button
              type="button"
              className="task-pager-btn"
              aria-label="Next page"
              disabled={taskPage >= taskPageCount}
              onClick={() => patchQuery({ page: String(taskPage + 1) })}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      {selectedCount > 0 ? (
        <div className="task-bulk-bar" role="status">
          <p>
            <strong>{selectedCount}</strong> selected
          </p>
          <div className="task-bulk-actions">
            <button type="button" className="filter-pill" onClick={() => setSelectedTaskIds(new Set())}>
              Clear
            </button>
            <Button variant="destructive" type="button" disabled={isPending} onClick={() => setBulkDeleteConfirm(true)}>
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              Delete {selectedCount}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )

  const commandResults = [
    ...navItems
      .filter((item) => !commandQuery || (item.displayLabel ?? item.label).toLowerCase().includes(commandQuery))
      .map((item) => ({
        id: `view-${item.label}`,
        label: item.displayLabel ?? item.label,
        hint: 'Workspace view',
        onSelect: () => nav(item.label),
      })),
    ...(!commandQuery || 'profile'.includes(commandQuery)
      ? [
          {
            id: 'view-Profile',
            label: 'Profile',
            hint: 'Your account',
            onSelect: () => {
              setCommandOpen(false)
              router.push('/profile')
            },
          },
        ]
      : []),
    ...(commandQuery
      ? [
          ...tasks
            .filter((task) => task.title.toLowerCase().includes(commandQuery))
            .slice(0, 6)
            .map((task) => ({
              id: `task-${task.id}`,
              label: task.title,
              hint: 'Open task',
              onSelect: () => {
                setCommandOpen(false)
                setSelectedTask(task)
              },
            })),
          ...projects
            .filter((project) => project.title.toLowerCase().includes(commandQuery))
            .slice(0, 6)
            .map((project) => ({
              id: `project-${project.id}`,
              label: project.title,
              hint: 'Open project',
              onSelect: () => nav('Projects', { project: project.id }),
            })),
          ...people
            .filter((person) => fullName(person).toLowerCase().includes(commandQuery))
            .slice(0, 6)
            .map((person) => ({
              id: `person-${person.id}`,
              label: fullName(person),
              hint: person.jobTitle,
              onSelect: () => nav('Departments', { employee: person.id }),
            })),
        ]
      : []),
  ]

  // Not on Departments: the drawer scopes work itself, and a second department
  // selector there would fight the drilled-in department and silently empty the list.
  const taskFilterBar = (activeNav === 'My tasks' || activeNav === 'Overview') && (
    <div className="filter-toolbar">
      <label>
        Department
        <select value={departmentFilter} onChange={(event) => patchQuery({ dept: event.target.value })} aria-label="Filter by department">
          <option value="all">All departments</option>
          {initialDepartments.map((department) => (
            <option key={department.id} value={department.id}>{department.name}</option>
          ))}
        </select>
      </label>
      <label>
        Deadline
        <select
          value={deadlineFilter}
          onChange={(event) => patchQuery({ deadline: event.target.value })}
          aria-label="Filter by deadline"
        >
          <option value="all">Any time</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
          <option value="attention">Overdue or stuck</option>
          <option value="stuck">Blocked or pending approval</option>
        </select>
      </label>
      <label>
        Person
        <select value={employeeFilter} onChange={(event) => patchQuery({ employee: event.target.value })} aria-label="Filter by employee">
          <option value="all">All people</option>
          {activePeople.map((person) => (
            <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>
          ))}
        </select>
      </label>
    </div>
  )

  return (
    <WorkhubShell
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      mobileOpen={mobileOpen}
      onMobileOpen={() => setMobileOpen(true)}
      onMobileClose={() => setMobileOpen(false)}
      navItems={navItems}
      activeNav={activeNav}
      onNavigate={(view) => nav(view)}
      searchQuery={query}
      onSearchChange={setQuery}
      onOpenCommand={() => {
        setCommandOpen(true)
        setShowNotifications(false)
        setShowProfile(false)
      }}
      commandOpen={commandOpen}
      onCloseCommand={() => {
        setCommandOpen(false)
        setQuery('')
      }}
      commandResults={commandResults}
      onSelectCommand={(id) => {
        const match = commandResults.find((item) => item.id === id)
        match?.onSelect()
      }}
      unreadCount={unreadCount}
      onToggleNotifications={() => {
        setShowNotifications((value) => !value)
        setShowProfile(false)
        setCommandOpen(false)
      }}
      notificationsOpen={showNotifications}
      notifications={
        showNotifications ? (
          <div className="popover notifications notification-center">
            <div className="notification-center-head">
              <strong>Notification center</strong>
              <button className="view-all" type="button" onClick={handleMarkAllNotificationsRead}>
                Mark all read
              </button>
            </div>
            <div className="notification-list">
              {notificationRows.length === 0 ? (
                <p className="empty-state">You are fully caught up.</p>
              ) : (
                notificationRows.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    className={notification.readAt ? 'notification-item read' : 'notification-item unread'}
                    onClick={() => handleMarkNotificationRead(notification)}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                    <small>{formatRelative(notification.createdAt)}</small>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null
      }
      profileOpen={showProfile}
      onToggleProfile={() => {
        setShowProfile((value) => !value)
        setShowNotifications(false)
        setCommandOpen(false)
      }}
      profileMenu={
        showProfile && currentUser ? (
          <div className="popover profile-popover">
            <strong>{fullName(currentUser)}</strong>
            <span>{currentUser.jobTitle}</span>
            <small>
              {currentUserRoles.map((role) => role.replaceAll('_', ' ')).join(' · ') || 'Employee'}
            </small>
            <Link href="/profile" className="profile-page-link">
              Open profile
            </Link>
            <form
              className="notification-preferences"
              action={async (formData) => {
                startTransition(async () => {
                  await updateNotificationPreferences(formData)
                  router.refresh()
                })
              }}
            >
              <strong>Alert preferences</strong>
              <label><input type="checkbox" name="deadlineAlerts" defaultChecked={Boolean(initialNotificationPreferences.deadlineAlerts)} /> Deadline alerts</label>
              <label><input type="checkbox" name="escalationAlerts" defaultChecked={Boolean(initialNotificationPreferences.escalationAlerts)} /> Escalation alerts</label>
              <label><input type="checkbox" name="approvalAlerts" defaultChecked={Boolean(initialNotificationPreferences.approvalAlerts)} /> Approval alerts</label>
              <label><input type="checkbox" name="managementRequestAlerts" defaultChecked={Boolean(initialNotificationPreferences.managementRequestAlerts)} /> Management request alerts</label>
              <label><input type="checkbox" name="dailySummary" defaultChecked={Boolean(initialNotificationPreferences.dailySummary)} /> Daily and periodic summaries</label>
              <button type="submit">Save preferences</button>
            </form>
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                if (signingOut) return
                setSigningOut(true)
                signOutToLogin()
              }}
            >
              {signingOut ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing out
                </>
              ) : (
                'Sign out'
              )}
            </button>
          </div>
        ) : null
      }
      currentName={currentUser ? fullName(currentUser) : 'Workspace user'}
      currentTitle={currentUser?.jobTitle ?? 'Employee'}
      currentInitials={currentUser?.initials ?? 'G'}
      currentAvatarUrl={currentUser?.avatarUrl}
      currentAvatarColor={currentUser?.avatarColor}
      companyName={companyName}
      companyShortName={companyShortName}
      breadcrumb={
        activeNav === 'Departments'
          ? selectedDepartment && showsDepartmentGrid
            ? `${departmentCopy.breadcrumb} / ${selectedDepartment.name}`
            : departmentCopy.breadcrumb
          : activeNav
      }
      profileNavActive={false}
      onOpenProfile={() => {
        setMobileOpen(false)
        setShowProfile(false)
        router.push('/profile')
      }}
    >
        <div className="page-wrap">
          {activeNav === 'Home' && (
            <>
              <ViewHeading
                eyebrow={clockLabel || 'Today'}
                title={`${hello}, ${currentUser?.firstName ?? 'there'}`}
                description="What needs a decision across GCS today."
                action={canCreateWork ? () => setShowCreate(true) : undefined}
                actionLabel="Create task"
              />
              <section className="metric-grid" aria-label="Executive summary">
                <MetricCard label="Company completion" value={`${metrics.completionRate}%`} footer="Open work completed" icon={<Target aria-hidden="true" />} tone="coral-icon" onClick={() => nav('My tasks', { scope: 'all' })} />
                <MetricCard label="Overdue tasks" value={String(metrics.overdue)} footer="Past due and still open" icon={<CircleAlert aria-hidden="true" />} tone="gold-icon" negative onClick={() => nav('My tasks', { scope: 'all', deadline: 'overdue' })} />
                <MetricCard label="Stuck work" value={String(metrics.blocked)} footer="Blocked or pending approval" icon={<Clock3 aria-hidden="true" />} tone="gold-icon" negative onClick={() => nav('My tasks', { scope: 'all', deadline: 'stuck' })} />
                <MetricCard label="Active initiatives" value={String(reportMetrics.activeProjects)} footer="Open projects" icon={<BriefcaseBusiness aria-hidden="true" />} tone="blue-icon" onClick={() => nav('Projects')} />
              </section>
              <div className="dashboard-grid home-top-grid">
                <section className="panel report-panel attention-panel">
                  <div className="panel-heading">
                    <div><h2>Management attention</h2><p>Open these first</p></div>
                    <CircleAlert aria-hidden="true" className="heading-icon" />
                  </div>
                  <AttentionTiles
                    blocked={metrics.blocked}
                    overdue={metrics.overdue}
                    dueToday={metrics.dueToday}
                    dueThisWeek={metrics.dueThisWeek}
                    unreadCount={unreadCount}
                    onStuck={() => nav('My tasks', { scope: 'all', deadline: 'stuck' })}
                    onOverdue={() => nav('My tasks', { scope: 'all', deadline: 'overdue' })}
                    onToday={() => nav('My tasks', { scope: 'all', deadline: 'today' })}
                    onWeek={() => nav('My tasks', { scope: 'all', deadline: 'week' })}
                    onAlerts={() => setShowNotifications(true)}
                  />
                </section>
                <section className="panel report-panel scorecard-panel">
                  <div className="panel-heading">
                    <div><h2>Department scorecard</h2><p>Work first, idle teams last</p></div>
                    <FileText aria-hidden="true" className="heading-icon" />
                  </div>
                  <ScorecardList
                    departments={initialDepartments}
                    onOpen={(id) => nav('Departments', { department: id })}
                  />
                </section>
              </div>
              <div className="dashboard-grid">
                <section className="panel report-panel">
                  <div className="panel-heading">
                    <div><h2>Management requests</h2><p>Track leadership asks and responses</p></div>
                    <Target aria-hidden="true" className="heading-icon" />
                  </div>
                  {canSubmitRequests && (
                    <div className="management-request-form">
                      <input value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} placeholder="Request title" />
                      <select value={requestPriority} onChange={(event) => setRequestPriority(event.target.value)} aria-label="Request priority">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                      <select value={requestAssigneeId} onChange={(event) => setRequestAssigneeId(event.target.value)} aria-label="Assign request">
                        <option value="">Unassigned</option>
                        {activePeople.filter((person) => person.id !== currentUserId).map((person) => (
                          <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>
                        ))}
                      </select>
                      <textarea value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} placeholder="What do you need from leadership?" />
                      <button className="create-button" type="button" onClick={() => handleCreateManagementRequest()}>Submit request</button>
                    </div>
                  )}
                  <div className="responsibility-list">
                    {managementRequestRows.length === 0 ? (
                      <p className="empty-state">No management requests yet.</p>
                    ) : (
                      [...managementRequestRows]
                        .sort((left, right) => Number(left.status === 'resolved') - Number(right.status === 'resolved'))
                        .map((request) => (
                        <div className="responsibility-row" key={request.id}>
                          <div className="responsibility-main">
                            <strong>{request.title}</strong>
                            <span>{request.requestor ? fullName(request.requestor) : 'Unknown'} · {request.priority} priority</span>
                          </div>
                          <StatusBadge status={request.status.replaceAll('_', ' ')} />
                          {canViewReports && request.status !== 'resolved' && (
                            <button
                              className="filter-pill"
                              type="button"
                              onClick={() =>
                                startTransition(async () => {
                                  await updateManagementRequestStatus(request.id, 'resolved')
                                  setManagementRequestRows((rows) => rows.map((row) => row.id === request.id ? { ...row, status: 'resolved' } : row))
                                  router.refresh()
                                })
                              }
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
                <section className="panel report-panel">
                  <div className="panel-heading">
                    <div><h2>Communication</h2><p>Send reminders and request updates</p></div>
                    <MessageSquare aria-hidden="true" className="heading-icon" />
                  </div>
                  {canCreateWork && (
                    <div className="management-request-form">
                      <select value={reminderTargetId} onChange={(event) => setReminderTargetId(event.target.value)}>
                        <option value="">Select team member</option>
                        {activePeople.map((person) => (
                          <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>
                        ))}
                      </select>
                      <textarea value={reminderMessage} onChange={(event) => setReminderMessage(event.target.value)} placeholder="Write a reminder or update request" />
                      <button className="create-button" type="button" onClick={handleSendReminder}>Send reminder</button>
                    </div>
                  )}
                </section>
              </div>
              <div className="dashboard-grid workload-split">
                {renderTasks()}
                <DeadlinesPanel compact upcoming={upcoming} onOpen={() => nav('My tasks', { scope: 'all', deadline: 'week' })} onOpenTask={setSelectedTask} />
              </div>
            </>
          )}

          {activeNav === 'Overview' && (
            <>
              <ViewHeading
                eyebrow={clockLabel || 'Today'}
                title={`${hello}, ${currentUser?.firstName ?? 'there'}`}
                description={
                  canLogOwnTask
                    ? sponsorName
                      ? `Log your own work, stay aligned with ${sponsorName}, and track what is already on you.`
                      : 'Log your own work, request help when you need it, and track what is already on you.'
                    : canRequestWork
                      ? 'Your assignments, requests, and anything you have been invited into.'
                      : 'What is moving in your department today.'
                }
                actions={[
                  ...(canLogOwnTask
                    ? [{ label: 'Add my task', onClick: () => setShowSelfTask(true), variant: 'primary' as const }]
                    : []),
                  ...(canCreateWork
                    ? [{ label: 'Create task', onClick: () => setShowCreate(true), variant: 'primary' as const }]
                    : []),
                ]}
              />
              {needsSponsor ? (
                <div className="drill-banner sponsor-nudge" role="status">
                  <strong>Supervisor not set</strong>
                  <span>
                    Your desk is sponsored. Ask admin or your department lead to set Reports to so they get notified when you log work.
                  </span>
                </div>
              ) : null}
              <section className="metric-grid" aria-label="Workspace summary">
                <MetricCard featured label="Active tasks" value={String(metrics.active)} footer={`Across ${metrics.departments} departments`} icon={<Check aria-hidden="true" />} tone="teal-icon" onClick={() => nav('My tasks', { scope: 'all' })} />
                <MetricCard label="Due this week" value={String(metrics.dueThisWeek)} footer={`${metrics.dueToday} due today`} icon={<Clock3 aria-hidden="true" />} tone="blue-icon" onClick={() => nav('My tasks', { scope: 'all', deadline: 'week' })} />
                <MetricCard label="Need attention" value={String(metrics.attention)} footer={`${metrics.overdue} overdue, ${metrics.blocked} blocked`} icon={<CircleAlert aria-hidden="true" />} tone="gold-icon" negative onClick={() => nav('My tasks', { scope: 'all', deadline: 'attention' })} />
                <MetricCard label="Completion rate" value={`${metrics.completionRate}%`} footer="Across current workspace" icon={<Target aria-hidden="true" />} tone="coral-icon" onClick={() => nav('My tasks', { scope: 'all' })} />
              </section>
              {taskFilterBar}
              {canLogOwnTask && (
                <section className="panel self-task-panel" style={{ marginBottom: 18 }}>
                  <div className="panel-heading">
                    <div>
                      <h2>Already working on something?</h2>
                      <p>
                        {sponsorName
                          ? `Add it to your queue now. ${sponsorName} is notified automatically — no approval wait.`
                          : 'Add it to your queue now. Your supervisor is notified automatically — no approval wait.'}
                      </p>
                    </div>
                    <button type="button" className="create-button" onClick={() => setShowSelfTask(true)}>
                      Add my task
                    </button>
                  </div>
                </section>
              )}
              {canRequestWork && (
                <section className="panel request-work-panel" style={{ marginBottom: 18 }}>
                  <div className="panel-heading">
                    <div>
                      <h2>Request work</h2>
                      <p>
                        {canLogOwnTask
                          ? 'Need something new assigned that is not yours yet? Your supervisor reviews this and can turn it into a task.'
                          : 'Your supervisor will review this and can turn it into a task.'}
                      </p>
                    </div>
                  </div>
                  <div className="management-request-form">
                    <input value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} placeholder="What do you need assigned?" />
                    <select value={requestPriority} onChange={(event) => setRequestPriority(event.target.value)} aria-label="Request priority">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <textarea value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} placeholder="Context, deadline, or why it matters" />
                    <button className="create-button" type="button" onClick={() => handleCreateManagementRequest('work')}>
                      Send to my supervisor
                    </button>
                  </div>
                  {managementRequestRows.filter((row) => row.kind === 'work').length > 0 && (
                    <div className="responsibility-list" style={{ marginTop: 12 }}>
                      {managementRequestRows
                        .filter((row) => row.kind === 'work')
                        .map((request) => (
                          <div className="responsibility-row" key={request.id}>
                            <div className="responsibility-main">
                              <strong>{request.title}</strong>
                              <span>{request.status.replaceAll('_', ' ')}</span>
                            </div>
                            <StatusBadge status={request.status.replaceAll('_', ' ')} />
                          </div>
                        ))}
                    </div>
                  )}
                </section>
              )}
              {canSubmitRequests && !isManagement && (
                <section className="panel" style={{ marginBottom: 18 }}>
                  <div className="panel-heading">
                    <div><h2>Ask leadership</h2><p>Send a management request</p></div>
                  </div>
                  <div className="management-request-form">
                    <input value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} placeholder="Request title" />
                    <select value={requestPriority} onChange={(event) => setRequestPriority(event.target.value)} aria-label="Request priority">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <select value={requestAssigneeId} onChange={(event) => setRequestAssigneeId(event.target.value)} aria-label="Assign request">
                      <option value="">Unassigned</option>
                      {activePeople.filter((person) => person.id !== currentUserId).map((person) => (
                        <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>
                      ))}
                    </select>
                    <textarea value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} placeholder="What do you need from leadership?" />
                    <button className="create-button" type="button" onClick={() => handleCreateManagementRequest()}>Submit request</button>
                  </div>
                </section>
              )}
              <div className="dashboard-grid workload-split">
                {renderTasks()}
                <DeadlinesPanel compact upcoming={upcoming} onOpen={() => nav('My tasks', { deadline: 'week' })} onOpenTask={setSelectedTask} />
              </div>
              <div className="lower-grid">
                <DepartmentPanel departments={initialDepartments} onOpen={canViewDepartments ? (id) => nav('Departments', { department: id }) : undefined} />
                <ActivityPanel events={initialActivity} />
              </div>
            </>
          )}

          {activeNav === 'My tasks' && (
            <>
              <ViewHeading
                eyebrow={allWorkScope ? 'Company workload' : 'Employee workspace'}
                title={allWorkScope ? 'All open work' : 'My tasks'}
                description={
                  allWorkScope
                    ? 'Every task you are allowed to see, filtered to the attention item you opened.'
                    : canLogOwnTask
                      ? sponsorName
                        ? `Your queue — including work you log yourself. ${sponsorName} stays notified.`
                        : 'Your queue — including work you log yourself after a verbal ask.'
                      : 'Everything assigned to you, organized by urgency.'
                }
                actions={[
                  ...(canLogOwnTask && !allWorkScope
                    ? [{ label: 'Add my task', onClick: () => setShowSelfTask(true), variant: 'primary' as const }]
                    : []),
                  ...(canCreateWork
                    ? [{ label: 'Create task', onClick: () => setShowCreate(true), variant: 'primary' as const }]
                    : []),
                ]}
              />
              {needsSponsor && !allWorkScope ? (
                <div className="drill-banner sponsor-nudge" role="status">
                  <strong>Supervisor not set</strong>
                  <span>
                    Ask leadership to set your Reports to contact so they get notified when you add tasks.
                  </span>
                </div>
              ) : null}
              {allWorkScope && (
                <div className="drill-banner">
                  <button type="button" className="text-back" onClick={() => nav('My tasks')}>Back to my assignments</button>
                  <strong>Company workload</strong>
                  <span>
                    {deadlineFilter === 'overdue' && 'Showing overdue tasks'}
                    {deadlineFilter === 'today' && 'Showing work due today'}
                    {deadlineFilter === 'week' && 'Showing work due this week'}
                    {deadlineFilter === 'attention' && 'Showing overdue or stuck work'}
                    {deadlineFilter === 'stuck' && 'Showing blocked or pending-approval work'}
                    {filter === 'blocked' && deadlineFilter !== 'stuck' && 'Showing blocked tasks'}
                    {deadlineFilter === 'all' && filter === 'All' && 'Showing all visible tasks'}
                  </span>
                </div>
              )}
              {taskFilterBar}
              {!allWorkScope && (
              <div className="metric-grid compact-metrics">
                <MetricCard label="Assigned to me" value={String(myMetrics.assigned)} footer="Active workload" icon={<Check aria-hidden="true" />} tone="teal-icon" />
                <MetricCard label="In progress" value={String(myMetrics.inProgress)} footer="Needs movement" icon={<Clock3 aria-hidden="true" />} tone="blue-icon" />
                <MetricCard label="Completed" value={String(myMetrics.completed)} footer="Your closed work" icon={<Target aria-hidden="true" />} tone="coral-icon" />
              </div>
              )}
              {renderTasks(
                allWorkScope ? 'Matching work' : 'My task queue',
                allWorkScope
                  ? 'Filtered from the workspace, not only your assignments'
                  : `Prioritized work assigned to ${currentUser?.firstName ?? 'you'}`,
              )}
              {!allWorkScope && recentlyCompleted.length > 0 && (
                <section className="panel" style={{ marginTop: 18 }}>
                  <div className="panel-heading">
                    <div><h2>Recently completed</h2><p>Your closed work items</p></div>
                    <Check aria-hidden="true" className="heading-icon" />
                  </div>
                  <div className="task-list">
                    {recentlyCompleted.map((task) => (
                      <div className={`task-row ${taskRowStatusClass(task.status)}`} key={task.id}>
                        <div className="priority-bar" style={{ background: 'oklch(.55 .11 175)' }} />
                        <div className="task-main">
                          <strong style={{ textDecoration: 'line-through' }}>{task.title}</strong>
                          <span>{categoryLabel(task.category, task.categoryCustom)} <i /> {formatDue(task.dueDate)}</span>
                        </div>
                        <StatusBadge status={task.status} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {activeNav === 'Responsibilities' && (
            <>
              <ViewHeading eyebrow="Accountability" title="Responsibilities" description="Clear leads for recurring and strategic work." action={canCreateWork ? () => setShowCreateResp(true) : undefined} actionLabel="Add responsibility" />
              <section className="panel table-panel">
                <div className="panel-heading">
                  <div><h2>Responsibility register</h2><p>Leads, cadence, and current status</p></div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div className="filter-pills">
                      <button className={respFilter === 'all' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setRespFilter('all')}>All<span>{responsibilityRows.length}</span></button>
                      <button className={respFilter === 'mine' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setRespFilter('mine')}>Mine</button>
                    </div>
                    {canCreateWork && <Button variant="outline" onClick={() => setShowCreateResp(true)}><Plus data-icon="inline-start" /> Add</Button>}
                  </div>
                </div>
                <div className="responsibility-list">
                  {filteredResponsibilities.map((item) => (
                    <div className="responsibility-row" key={item.id}>
                      <div className="responsibility-icon"><ShieldCheck aria-hidden="true" /></div>
                      <div className="responsibility-main">
                        <strong>{item.title}</strong>
                        <span>{categoryLabel(item.category)}{item.department ? ` · ${item.department.name}` : ''}</span>
                      </div>
                      <div className="responsibility-owner">
                        <UserAvatar
                          initials={item.owner.initials}
                          url={item.owner.avatarUrl}
                          color={item.owner.avatarColor}
                          size="sm"
                        />
                        {fullName(item.owner)}
                      </div>
                      <StatusBadge status={item.status === 'active' ? 'Active' : item.status} />
                      {currentUser && item.owner.id !== currentUser.id && (
                        <button
                          className="filter-pill"
                          style={{ fontSize: 10 }}
                          disabled={isPending}
                          onClick={() => handleTakeResponsibility(item.id)}
                        >
                          Assign to me
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeNav === 'Departments' && (
            <>
              <ViewHeading
                eyebrow={departmentCopy.eyebrow}
                title={departmentCopy.title}
                description={departmentCopy.description}
                actions={[
                  ...(canEditOrg
                    ? [{ label: 'New department', onClick: () => setShowCreateDepartment(true), variant: 'outline' as const }]
                    : []),
                  ...(canInvitePeople
                    ? [{ label: 'Add person', onClick: () => setShowInvite(true), variant: 'primary' as const }]
                    : []),
                ]}
              />

              {showsDepartmentGrid ? (
                <>
                  <div className="department-grid">
                    {initialDepartments.map((department) => (
                      <article
                        className={`panel department-card${selectedDepartmentId === department.id ? ' is-selected' : ''}`}
                        key={department.id}
                        role="button"
                        tabIndex={0}
                        aria-expanded={selectedDepartmentId === department.id}
                        aria-label={`Open ${department.name} details`}
                        onClick={() => nav('Departments', { department: department.id })}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          nav('Departments', { department: department.id })
                        }}
                      >
                        <div className={`department-icon department-${department.color}`}>{department.name.slice(0, 1)}</div>
                        <div className="department-card-heading">
                          <div>
                            <h2>{department.name}</h2>
                            <p>{ledBy(department.owner ? fullName(department.owner) : null)}</p>
                          </div>
                          <StatusBadge status={departmentHealth(department)} />
                        </div>
                        <div className="department-stat"><strong>{department.progress}%</strong><span>completion rate</span></div>
                        <div className="progress-track">
                          <div className={`progress-fill fill-${department.color}`} style={{ width: `${department.progress}%` }} />
                        </div>
                        <div className="department-meta">
                          <span>{department.completed} / {department.total} tasks</span>
                          <span>{department.teams?.length ?? 0} teams</span>
                        </div>
                      </article>
                    ))}
                  </div>

                  <section className="panel table-panel">
                    <div className="panel-heading">
                      <div><h2>Reporting hierarchy</h2><p>Employees, roles, and manager assignments</p></div>
                      {canInvitePeople && (
                        <Button variant="outline" onClick={() => setShowInvite(true)}>
                          <Plus data-icon="inline-start" /> Add person
                        </Button>
                      )}
                    </div>
                    <div className="employee-list">
                      {people
                        .filter((employee) => employeeFilter === 'all' || employee.id === employeeFilter)
                        .map((employee) => (
                        <div className="employee-row" key={employee.id}>
                          <UserAvatar
                            initials={employee.initials}
                            url={employee.avatarUrl}
                            color={employee.avatarColor}
                          />
                          <div className="employee-main">
                            <strong>{fullName(employee)}</strong>
                            <span>
                              {employee.jobTitle}
                              {employee.roles?.[0]?.role?.name ? ` · ${employee.roles[0].role.name}` : ''}
                            </span>
                          </div>
                          <span>{employee.department?.name ?? '—'}</span>
                          <span>{employee.manager ? `Reports to ${fullName(employee.manager)}` : '—'}</span>
                          <StatusBadge
                            status={
                              employee.status === 'active'
                                ? 'Active'
                                : employee.status === 'invited'
                                  ? 'Invited'
                                  : 'Inactive'
                            }
                          />
                          <div className="employee-actions">
                            {canManagePeople && employee.status !== 'invited' ? (
                              <button
                                type="button"
                                className="row-action"
                                disabled={isPending}
                                onClick={() => setEditPersonTarget(employee)}
                              >
                                Edit
                              </button>
                            ) : null}
                            {canInvitePeople && employee.status === 'invited' ? (
                              <>
                                <button
                                  type="button"
                                  className="row-action"
                                  disabled={isPending}
                                  onClick={() => handleResendInvite(employee.id)}
                                >
                                  Resend invite
                                </button>
                                <button
                                  type="button"
                                  className="row-action row-action-danger"
                                  disabled={isPending}
                                  onClick={() => handleCancelInvite(employee.id)}
                                >
                                  Cancel invite
                                </button>
                              </>
                            ) : null}
                            {canManagePeople && employee.status !== 'invited' ? (
                              <button
                                type="button"
                                className="row-action row-action-danger"
                                disabled={isPending || employee.id === currentUserId}
                                onClick={() => setRemovePersonTarget(employee)}
                              >
                                Remove
                              </button>
                            ) : null}
                            {canManagePeople && employee.status !== 'invited' ? (
                              <button
                                className="filter-pill"
                                style={{ fontSize: 9, padding: '4px 8px' }}
                                disabled={isPending || employee.id === currentUserId}
                                onClick={() => handleToggleUserStatus(employee.id)}
                              >
                                {employee.status === 'active' ? 'Deactivate' : 'Activate'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              ) : selectedDepartment ? (
                <section className="panel dept-inline">
                  <div className="dept-inline-head">
                    <div className={`department-icon department-${selectedDepartment.color}`}>
                      {selectedDepartment.name.slice(0, 1)}
                    </div>
                    <div className="dept-drawer-title">
                      <h2>{selectedDepartment.name}</h2>
                      <p>
                        {ledBy(selectedDepartment.owner ? fullName(selectedDepartment.owner) : null)}
                        {selectedDepartment.teams?.length ? ` · ${selectedDepartment.teams.length} teams` : ''}
                      </p>
                    </div>
                    <StatusBadge status={departmentHealth(selectedDepartment)} />
                  </div>
                  <DepartmentDetailBody
                    key={selectedDepartment.id}
                    department={selectedDepartment}
                    posture={posture}
                    people={departmentPeople}
                    projects={departmentProjects}
                    tasks={departmentStandaloneTasks}
                    onOpenProject={canViewProjects ? (id) => nav('Projects', { project: id }) : undefined}
                    onOpenTask={(id) => {
                      const task = tasks.find((entry) => entry.id === id)
                      if (task) setSelectedTask(task)
                    }}
                    onInvite={canInvitePeople ? () => setShowInvite(true) : undefined}
                    onEditPerson={
                      canManagePeople
                        ? (personId) => {
                            const target = people.find((entry) => entry.id === personId) ?? null
                            if (target) setEditPersonTarget(target)
                          }
                        : undefined
                    }
                    onRemovePerson={
                      canManagePeople
                        ? (personId) => {
                            const target = people.find((entry) => entry.id === personId) ?? null
                            if (target && target.id !== currentUserId) setRemovePersonTarget(target)
                          }
                        : undefined
                    }
                    onToggleStatus={canManagePeople ? handleToggleUserStatus : undefined}
                    onResendInvite={canInvitePeople ? handleResendInvite : undefined}
                    onCancelInvite={canInvitePeople ? handleCancelInvite : undefined}
                    onAssignTask={canAssignDepartmentWork ? openCreateTaskFromDepartment : undefined}
                    busy={isPending}
                  />
                </section>
              ) : (
                <p className="empty-state">
                  You have not been assigned to a department yet. Ask your administrator to add you to one.
                </p>
              )}
            </>
          )}

          {activeNav === 'Projects' && selectedProject && (
            <ProjectWorkspace
              project={selectedProject}
              people={pickerPeople}
              departments={pickerDepartments.map((department) => ({ id: department.id, name: department.name }))}
              tasks={tasks.map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                dueDate: task.dueDate,
                assignee: task.assignee,
                projectId: task.projectId,
              }))}
              canManage={canManageSelectedProject}
              canCreateWork={canCreateWork}
              lockLeadToSelf={isMemberCreator}
              onBack={() => nav('Projects')}
              onCreateTask={(milestoneId) => {
                setCreateTaskMilestoneId(milestoneId)
                setCreateAssigneeId('')
                setCreateFromDepartment(false)
                setShowCreate(true)
              }}
              onOpenTask={(taskId) => {
                const task = tasks.find((entry) => entry.id === taskId)
                if (task) setSelectedTask(task)
              }}
              onProjectDeleted={() => nav('Projects')}
              onTaskRemoved={removeTaskFromLocalState}
              onTaskLinked={(taskId, placement) => {
                setTasks((current) =>
                  current.map((entry) =>
                    entry.id === taskId
                      ? {
                          ...entry,
                          projectId: placement.projectId,
                          projectTitle: selectedProject.title,
                          milestoneId: placement.milestoneId,
                          milestoneTitle:
                            selectedProject.milestones?.find((milestone) => milestone.id === placement.milestoneId)?.title ??
                            null,
                        }
                      : entry,
                  ),
                )
              }}
              canDeleteLinkedTask={(taskId) => {
                const task = tasks.find((entry) => entry.id === taskId)
                return task ? canDeleteTask(actor, task) : false
              }}
            />
          )}

          {activeNav === 'Projects' && !selectedProject && (
            <>
              <ViewHeading
                eyebrow="Work portfolio"
                title="Projects"
                description="Client systems, internal platforms, and live bids. Open a card for milestones and the people on the work."
                action={canCreateWork ? () => setShowCreateProject(true) : undefined}
                actionLabel="Create project"
              />
              <div className="task-toolbar" style={{ marginBottom: 16 }}>
                <div className="filter-pills" role="group" aria-label="Filter projects by status">
                  {(['all', 'On track', 'At risk', 'Needs review'] as const).map((value) => (
                    <button
                      key={value}
                      className={projectStatusFilter === value ? 'filter-pill selected' : 'filter-pill'}
                      onClick={() => setProjectStatusFilter(value)}
                    >
                      {value === 'all' ? 'All' : value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="project-grid">
                {visibleProjects.map((project) => (
                  <ProjectCard key={project.id} {...project} onOpen={() => nav('Projects', { project: project.id })} />
                ))}
              </div>
            </>
          )}

          {activeNav === 'Reports' && canViewReports && (
            <>
              <div className="report-pack">
              <ViewHeading
                eyebrow={isManagement ? 'Company pack' : 'Department pack'}
                title={isManagement ? 'Reports & insights' : 'Department report'}
                description={
                  isManagement
                    ? 'The operational pack you can stand behind in a meeting. Home is for decisions today; this is the picture.'
                    : 'The same operational questions, scoped to your function — not the whole company.'
                }
                action={handleExportReport}
                actionLabel="Download CSV"
              />
              <p className="report-pack-note">Print this page for Monday meetings. Numbers match the work you are allowed to see.</p>
              <section className="metric-grid">
                <MetricCard label={isManagement ? 'Company completion' : 'Department completion'} value={`${reportMetrics.completionRate}%`} footer="Current workspace rate" icon={<Target aria-hidden="true" />} tone="coral-icon" />
                <MetricCard label="Overdue tasks" value={String(reportMetrics.overdue)} footer="Needs follow-up" icon={<CircleAlert aria-hidden="true" />} tone="gold-icon" />
                <MetricCard label="Active initiatives" value={String(reportMetrics.activeProjects)} footer="Open projects" icon={<BriefcaseBusiness aria-hidden="true" />} tone="blue-icon" />
                <MetricCard label="Team coverage" value={`${reportMetrics.teamCoverage}%`} footer="People with department assignment" icon={<UsersRound aria-hidden="true" />} tone="teal-icon" />
              </section>
              <div className="dashboard-grid home-top-grid">
                <section className="panel report-panel attention-panel">
                  <div className="panel-heading">
                    <div><h2>Management attention</h2><p>Open these first</p></div>
                    <CircleAlert aria-hidden="true" className="heading-icon" />
                  </div>
                  <AttentionTiles
                    blocked={metrics.blocked}
                    overdue={metrics.overdue}
                    dueToday={metrics.dueToday}
                    dueThisWeek={metrics.dueThisWeek}
                    unreadCount={unreadCount}
                    onStuck={() => nav('My tasks', { scope: 'all', deadline: 'stuck' })}
                    onOverdue={() => nav('My tasks', { scope: 'all', deadline: 'overdue' })}
                    onToday={() => nav('My tasks', { scope: 'all', deadline: 'today' })}
                    onWeek={() => nav('My tasks', { scope: 'all', deadline: 'week' })}
                    onAlerts={() => setShowNotifications(true)}
                  />
                </section>
                <section className="panel report-panel scorecard-panel">
                  <div className="panel-heading">
                    <div><h2>Department scorecard</h2><p>Completion and attention areas</p></div>
                    <FileText aria-hidden="true" className="heading-icon" />
                  </div>
                  <ScorecardList
                    departments={initialDepartments}
                    onOpen={(id) => nav('Departments', { department: id })}
                  />
                </section>
              </div>
              <div className="dashboard-grid">
                <section className="panel report-panel">
                  <div className="panel-heading">
                    <div><h2>Management requests</h2><p>Track leadership asks and responses</p></div>
                    <Target aria-hidden="true" className="heading-icon" />
                  </div>
                  <div className="management-request-form">
                    {canSubmitRequests && (
                      <>
                        <input value={requestTitle} onChange={(e) => setRequestTitle(e.target.value)} placeholder="Request title" />
                        <textarea value={requestDescription} onChange={(e) => setRequestDescription(e.target.value)} placeholder="What do you need from leadership?" />
                        <button className="create-button" type="button" onClick={() => handleCreateManagementRequest()}>Submit request</button>
                      </>
                    )}
                  </div>
                  <div className="responsibility-list">
                    {managementRequestRows.length === 0 ? (
                      <p className="empty-state">No management requests yet.</p>
                    ) : (
                      [...managementRequestRows]
                        .sort((left, right) => Number(left.status === 'resolved') - Number(right.status === 'resolved'))
                        .map((request) => (
                        <div className="responsibility-row" key={request.id}>
                          <div className="responsibility-main">
                            <strong>{request.title}</strong>
                            <span>
                              {request.requestor ? fullName(request.requestor) : 'Unknown'} · {request.priority} priority
                              {request.kind === 'work' ? ' · work request' : ''}
                            </span>
                          </div>
                          <StatusBadge status={request.status.replaceAll('_', ' ')} />
                          {canCreateWork && request.kind === 'work' && request.status !== 'resolved' && request.status !== 'cancelled' && (
                            <button
                              className="filter-pill"
                              type="button"
                              onClick={() =>
                                startTransition(async () => {
                                  await promoteWorkRequest(request.id)
                                  router.refresh()
                                })
                              }
                            >
                              Make task
                            </button>
                          )}
                          {canViewReports && request.status !== 'resolved' && (
                            <button
                              className="filter-pill"
                              type="button"
                              onClick={() =>
                                startTransition(async () => {
                                  await updateManagementRequestStatus(request.id, 'resolved')
                                  router.refresh()
                                })
                              }
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
                <section className="panel report-panel">
                  <div className="panel-heading">
                    <div><h2>Communication</h2><p>Send reminders and request updates</p></div>
                    <MessageSquare aria-hidden="true" className="heading-icon" />
                  </div>
                  {canCreateWork && (
                    <div className="management-request-form">
                      <select value={reminderTargetId} onChange={(e) => setReminderTargetId(e.target.value)}>
                        <option value="">Select team member</option>
                        {activePeople.map((person) => (
                          <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>
                        ))}
                      </select>
                      <textarea value={reminderMessage} onChange={(e) => setReminderMessage(e.target.value)} placeholder="Write a reminder or update request" />
                      <button className="create-button" type="button" onClick={handleSendReminder}>Send reminder</button>
                    </div>
                  )}
                  <div className="attention-list">
                    <div><Activity aria-hidden="true" /><span><strong>{allActivity.length} recent events</strong> tracked across your workspace scope.</span></div>
                    <div><UsersRound aria-hidden="true" /><span><strong>{people.length} people</strong> visible in your current access context.</span></div>
                    <div><BriefcaseBusiness aria-hidden="true" /><span><strong>{projects.length} projects</strong> currently in view with health and risk indicators.</span></div>
                  </div>
                </section>
              </div>
              </div>
            </>
          )}

          {activeNav === 'Admin office' && runsOffice && officeDesk && (
            <>
              <ViewHeading
                eyebrow="Finance and admin"
                title="Admin office"
                description="Leave, letters, imprest, vendors, documents, and the Kenya compliance calendar."
              />
              <AdminOfficeDesk
                mode="admin"
                desk={officeDesk}
                colleagues={pickerPeople.map((person) => ({ id: person.id, firstName: person.firstName, lastName: person.lastName }))}
                currentUserId={currentUserId}
                canIssueOffers={isManagement}
              />
            </>
          )}

          {activeNav === 'My office' && officeDesk && (
            <>
              <ViewHeading
                eyebrow="Your requests"
                title="My office"
                description="Ask for leave, a letter, imprest, equipment, or printing. Balances already skip weekends and Kenya public holidays."
              />
              <AdminOfficeDesk
                mode="self"
                desk={officeDesk}
                colleagues={pickerPeople.map((person) => ({ id: person.id, firstName: person.firstName, lastName: person.lastName }))}
                currentUserId={currentUserId}
                canIssueOffers={false}
              />
            </>
          )}

          {activeNav === 'Activity' && (
            <>
              <ViewHeading eyebrow="Workspace history" title="Activity" description="A chronological record of updates across your workspace." />
              <section className="panel activity-full-panel">
                <ActivityPanel events={allActivity} full />
              </section>
            </>
          )}

          {activeNav === 'Settings' && (canManagePeople || canEditOrg) && (
            <>
              <ViewHeading
                eyebrow="Workspace"
                title="Settings"
                description={canEditOrg ? `Company structure, roles, and how ${PRODUCT_NAME} is configured.` : 'People, roles, and how this workspace is configured.'}
                action={canInvitePeople ? () => setShowInvite(true) : undefined}
                actionLabel="Add person"
              />
              <section className="metric-grid compact-metrics">
                <MetricCard label="Company" value={companyName} footer="Active workspace" icon={<BriefcaseBusiness aria-hidden="true" />} tone="blue-icon" />
                <MetricCard label="People" value={String(people.length)} footer="Including inactive accounts" icon={<UsersRound aria-hidden="true" />} tone="teal-icon" onClick={() => nav('Departments')} />
                <MetricCard label="Teams" value={String(workspaceTeams.length)} footer="Department teams" icon={<UsersRound aria-hidden="true" />} tone="gold-icon" />
              </section>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Roles</h2>
                      <p>Access desks in this workspace — Volunteer is for assigned support work</p>
                    </div>
                  </div>
                  <div className="responsibility-list">
                    {workspaceRoles.map((role) => (
                      <div className="responsibility-row" key={role.key}>
                        <div className="responsibility-main">
                          <strong>{role.name}</strong>
                          <span>
                            {role.description?.trim() || role.key.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <StatusBadge status={role.key === 'volunteer' ? 'Volunteer' : role.name} />
                      </div>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div><h2>Teams</h2><p>How departments are grouped</p></div>
                  </div>
                  <div className="responsibility-list">
                    {workspaceTeams.length === 0 ? (
                      <p className="empty-state">No teams yet.</p>
                    ) : (
                      workspaceTeams.map((team) => (
                        <div className="responsibility-row" key={team.id}>
                          <div className="responsibility-main">
                            <strong>{team.name}</strong>
                            <span>{team.department?.name ?? 'Unassigned department'}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
              {canEditOrg && (
                <OrgSettingsPanel
                  people={people}
                  departments={initialDepartments.map((department) => ({
                    id: department.id,
                    name: department.name,
                    color: department.color,
                    ownerId: null,
                  }))}
                  teams={workspaceTeams}
                  roles={workspaceRoles}
                />
              )}
              <section className="panel" style={{ marginTop: 18 }}>
                <div className="panel-heading">
                    <div><h2>Your alert preferences</h2><p>These also live on your profile page and in the profile menu</p></div>
                </div>
                <form
                  className="notification-preferences settings-preferences"
                  action={async (formData) => {
                    startTransition(async () => {
                      await updateNotificationPreferences(formData)
                      router.refresh()
                    })
                  }}
                >
                  <label><input type="checkbox" name="deadlineAlerts" defaultChecked={Boolean(initialNotificationPreferences.deadlineAlerts)} /> Deadline alerts</label>
                  <label><input type="checkbox" name="escalationAlerts" defaultChecked={Boolean(initialNotificationPreferences.escalationAlerts)} /> Escalation alerts</label>
                  <label><input type="checkbox" name="approvalAlerts" defaultChecked={Boolean(initialNotificationPreferences.approvalAlerts)} /> Approval alerts</label>
                  <label><input type="checkbox" name="managementRequestAlerts" defaultChecked={Boolean(initialNotificationPreferences.managementRequestAlerts)} /> Management request alerts</label>
                  <label><input type="checkbox" name="dailySummary" defaultChecked={Boolean(initialNotificationPreferences.dailySummary)} /> Daily and periodic summaries</label>
                  <button className="create-button" type="submit">Save preferences</button>
                </form>
              </section>
            </>
          )}
        </div>

      {activeNav === 'Departments' && showsDepartmentGrid && selectedDepartment && (
        <DepartmentDrawer
          key={selectedDepartment.id}
          department={selectedDepartment}
          posture={posture}
          people={departmentPeople}
          projects={departmentProjects}
          tasks={departmentStandaloneTasks}
          onClose={() => nav('Departments')}
          onOpenProject={canViewProjects ? (id) => nav('Projects', { project: id }) : undefined}
          onOpenTask={(id) => {
            const task = tasks.find((entry) => entry.id === id)
            if (task) setSelectedTask(task)
          }}
          onInvite={canInvitePeople ? () => setShowInvite(true) : undefined}
          onEditPerson={
            canManagePeople
              ? (personId) => {
                  const target = people.find((entry) => entry.id === personId) ?? null
                  if (target) setEditPersonTarget(target)
                }
              : undefined
          }
          onRemovePerson={
            canManagePeople
              ? (personId) => {
                  const target = people.find((entry) => entry.id === personId) ?? null
                  if (target && target.id !== currentUserId) setRemovePersonTarget(target)
                }
              : undefined
          }
          onToggleStatus={canManagePeople ? handleToggleUserStatus : undefined}
          onResendInvite={canInvitePeople ? handleResendInvite : undefined}
          onCancelInvite={canInvitePeople ? handleCancelInvite : undefined}
          onAssignTask={canAssignDepartmentWork ? openCreateTaskFromDepartment : undefined}
          busy={isPending}
        />
      )}

      {selectedTask && (
        <TaskDetailSheet
          task={selectedTask}
          people={pickerPeople}
          departments={pickerDepartments}
          otherTasks={tasks.filter((entry) => entry.id !== selectedTask.id).map((entry) => ({ id: entry.id, title: entry.title }))}
          currentUserId={currentUserId}
          canEdit={canEditSelected}
          canProgress={canProgressSelected}
          isPending={isPending}
          detailsSaving={detailsSaving}
          detailsError={detailsError}
          detailsSaved={detailsSaved}
          detailTab={detailTab}
          onTabChange={setDetailTab}
          onClose={() => setSelectedTask(null)}
          onPatch={(patch) =>
            setSelectedTask((current) => (current?.id === selectedTask.id ? { ...current, ...patch } : current))
          }
          onSave={handleSaveTaskDetails}
          onStatusChange={(status) => handleStatusChange(selectedTask.id, status)}
          onProgressCommit={(progress) => handleProgressChange(selectedTask.id, progress)}
          projects={projects.map((project) => ({
            id: project.id,
            title: project.title,
            departmentId: project.departmentId,
            department: project.department,
            contributingDepartmentIds: project.contributingDepartments?.map((entry) => entry.id) ?? [],
            teamUserIds: project.team?.map((member) => member.id) ?? [],
            milestones: project.milestones?.map((milestone) => ({ id: milestone.id, title: milestone.title })) ?? [],
          }))}
          canCreateWork={canCreateWork}
          currentUserDepartmentId={currentUser?.departmentId ?? ''}
          onSetPlacement={handleSetTaskPlacement}
          commentText={commentText}
          commentError={commentError}
          onCommentText={(value) => { setCommentText(value); setCommentError(null) }}
          onAddComment={() => handleAddComment(selectedTask.id)}
          onDeleteComment={handleDeleteComment}
          attachLabel={attachLabel}
          attachUrl={attachUrl}
          showAttachForm={showAttachForm}
          attachError={attachError}
          onAttachLabel={setAttachLabel}
          onAttachUrl={setAttachUrl}
          onShowAttachForm={setShowAttachForm}
          onPersistAttachment={(file) =>
            persistAttachment(selectedTask.id, {
              label: file.label,
              url: file.url,
              publicId: file.publicId,
              bytes: file.bytes,
              mimeType: file.mimeType,
              originalName: file.originalName,
            })
          }
          onAddLink={() => handleAddAttachment(selectedTask.id)}
          deletingAttachmentId={deletingAttachmentId}
          onDeleteAttachment={handleDeleteAttachment}
          approvalReason={approvalReason}
          approvalError={approvalError}
          onApprovalReason={setApprovalReason}
          onApprove={handleApproveCurrentTask}
          onReject={handleRejectCurrentTask}
          onRequestRevision={handleRequestRevisionCurrentTask}
          deliverableTitle={deliverableTitle}
          deliverableDescription={deliverableDescription}
          deliverableError={deliverableError}
          onDeliverableTitle={setDeliverableTitle}
          onDeliverableDescription={setDeliverableDescription}
          onCreateDeliverable={handleCreateDeliverable}
          deliverableEvidenceById={deliverableEvidenceById}
          deliverableEvidenceMetaById={deliverableEvidenceMetaById}
          deliverableNotesById={deliverableNotesById}
          deliverableDecisionById={deliverableDecisionById}
          setDeliverableEvidenceById={setDeliverableEvidenceById}
          setDeliverableEvidenceMetaById={setDeliverableEvidenceMetaById}
          setDeliverableNotesById={setDeliverableNotesById}
          setDeliverableDecisionById={setDeliverableDecisionById}
          onCreateDeliverableSubmit={handleSubmitDeliverable}
          onVerifyDeliverable={handleVerifyDeliverable}
          onApproveDeliverable={handleApproveDeliverable}
          onRejectDeliverable={handleRejectDeliverable}
          dependencyBlockingTaskId={dependencyBlockingTaskId}
          onDependencyBlockingTaskId={setDependencyBlockingTaskId}
          onCreateDependency={handleCreateDependency}
          onDeleteDependency={handleDeleteDependency}
          onDeleteTask={() => handleDeleteTaskById(selectedTask.id)}
          onReportsChange={(reports) => mergeTaskReports(selectedTask.id, reports)}
        />
      )}

      {bulkDeleteConfirm ? (
        <ConfirmDialog
          title={`Delete ${selectedCount} task${selectedCount === 1 ? '' : 's'}?`}
          description="Selected tasks and their comments, files, reports, and links will be permanently deleted. This cannot be undone."
          confirmLabel={`Delete ${selectedCount} task${selectedCount === 1 ? '' : 's'}`}
          pending={isPending}
          onCancel={() => {
            setBulkDeleteConfirm(false)
            setBulkDeleteError(null)
          }}
          onConfirm={handleBulkDeleteTasks}
        >
          {bulkDeleteError ? <p className="form-error">{bulkDeleteError}</p> : null}
        </ConfirmDialog>
      ) : null}

      {deleteTaskConfirm ? (
       <ConfirmDialog
       title="Delete this task?"
       description={`“${deleteTaskConfirm.title}” and all associated comments, files, and links will be permanently deleted. This action cannot be undone.`}
       confirmLabel="Delete task"
       pending={isPending}
       onCancel={() => {
         setDeleteTaskConfirm(null)
         setDeleteError(null)
       }}
       onConfirm={() => handleDeleteTaskById(deleteTaskConfirm.id)}
     >
          {deleteError ? <p className="form-error">{deleteError}</p> : null}
        </ConfirmDialog>
      ) : null}

      {canCreateWork && showCreate && (
        <CreateTaskDialog
          key={`create-${createAssigneeId}-${selectedDepartmentId ?? ''}-${createTaskMilestoneId}`}
          people={activePeople}
          directory={pickerPeople}
          currentUserId={currentUserId}
          currentUserDepartmentId={currentUser?.departmentId ?? ''}
          canAssignAcrossDepartments={isManagement}
          canAssignOthers={canAssignDepartmentWork}
          departments={pickerDepartments}
          projects={projects.map((project) => ({
            id: project.id,
            title: project.title,
            departmentId: project.departmentId,
            department: project.department,
            contributingDepartmentIds: project.contributingDepartments?.map((entry) => entry.id) ?? [],
            teamUserIds: project.team?.map((member) => member.id) ?? [],
            milestones: project.milestones?.map((milestone) => ({ id: milestone.id, title: milestone.title })) ?? [],
          }))}
          defaultDepartmentId={selectedProject?.departmentId ?? selectedDepartmentId ?? ''}
          defaultAssigneeId={createAssigneeId}
          defaultProjectId={selectedProject?.id ?? ''}
          defaultMilestoneId={createTaskMilestoneId}
          lockDepartment={createFromDepartment || Boolean(selectedDepartmentId && !selectedProject)}
          onClose={() => {
            setShowCreate(false)
            setCreateTaskMilestoneId('')
            setCreateAssigneeId('')
            setCreateFromDepartment(false)
            router.refresh()
          }}
        />
      )}

      {canLogOwnTask && showSelfTask && (
        <CreateSelfTaskDialog
          sponsorName={sponsorName}
          projects={mySelfTaskProjects}
          onClose={() => {
            setShowSelfTask(false)
            router.refresh()
          }}
        />
      )}

      {canCreateWork && showCreateProject && (
        <CreateProjectDialog
          people={activePeople}
          directory={pickerPeople}
          currentUserId={currentUserId}
          departments={pickerDepartments}
          lockLeadToSelf={isMemberCreator}
          onClose={(projectId) => {
            setShowCreateProject(false)
            if (projectId) nav('Projects', { project: projectId })
            else router.refresh()
          }}
        />
      )}

      {canCreateWork && showCreateResp && (
        <CreateResponsibilityDialog
          people={activePeople}
          currentUserId={currentUserId}
          departments={initialDepartments.map((d) => ({ id: d.id, name: d.name }))}
          onClose={() => {
            setShowCreateResp(false)
            router.refresh()
          }}
        />
      )}
      {canInvitePeople && showInvite && (
        <InviteEmployeeDialog
          people={activePeople}
          departments={initialDepartments.map((department) => ({
            id: department.id,
            name: department.name,
            slug: department.slug,
          }))}
          roles={inviteRoles.length > 0 ? inviteRoles : workspaceRoles}
          lockDepartmentId={!isManagement && isDepartmentLeader ? currentUser?.departmentId ?? null : null}
          defaultDepartmentId={selectedDepartmentId}
          onClose={() => {
            setShowInvite(false)
            router.refresh()
          }}
        />
      )}
      {canManagePeople && removePersonTarget && (
        <RemovePersonDialog
          person={removePersonTarget}
          people={activePeople}
          onClose={() => setRemovePersonTarget(null)}
          onRemoved={() => router.refresh()}
        />
      )}
      {canManagePeople && editPersonTarget && (
        <EditPersonDialog
          person={editPersonTarget}
          people={people}
          departments={initialDepartments.map((department) => ({
            id: department.id,
            name: department.name,
            slug: department.slug,
          }))}
          teams={workspaceTeams.map((team) => ({
            id: team.id,
            name: team.name,
            departmentId: team.departmentId ?? null,
          }))}
          roles={inviteRoles.length > 0 ? inviteRoles : workspaceRoles}
          onClose={() => setEditPersonTarget(null)}
          onSaved={() => router.refresh()}
        />
      )}
      {canEditOrg && showCreateDepartment && (
        <CreateDepartmentDialog
          people={activePeople}
          onClose={() => setShowCreateDepartment(false)}
          onCreated={(departmentId) => {
            router.refresh()
            if (departmentId) nav('Departments', { department: departmentId })
          }}
        />
      )}
    </WorkhubShell>
  )
}

function ViewHeading({
  eyebrow,
  title,
  description,
  action,
  actionLabel = 'Create task',
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  action?: () => void
  actionLabel?: string
  actions?: { label: string; onClick: () => void; variant?: 'primary' | 'outline' }[]
}) {
  const resolvedActions =
    actions ??
    (action
      ? [{ label: actionLabel, onClick: action, variant: 'primary' as const }]
      : [])

  return (
    <div className="welcome-row">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>
          {title}
          <span>.</span>
        </h1>
        <p className="subhead">{description}</p>
      </div>
      {resolvedActions.length > 0 ? (
        <div className="welcome-actions">
          {resolvedActions.map((entry) =>
            entry.variant === 'outline' ? (
              <Button key={entry.label} variant="outline" onClick={entry.onClick}>
                <Plus data-icon="inline-start" /> {entry.label}
              </Button>
            ) : (
              <Button key={entry.label} className="create-button" onClick={entry.onClick}>
                {entry.label.toLowerCase().includes('download') ? (
                  <Download data-icon="inline-start" />
                ) : (
                  <Plus data-icon="inline-start" />
                )}{' '}
                {entry.label}
              </Button>
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

function MetricCard({
  label,
  value,
  footer,
  icon,
  tone,
  featured,
  trend,
  negative,
  onClick,
}: {
  label: string
  value: string
  footer: string
  icon: ReactNode
  tone: string
  featured?: boolean
  trend?: boolean
  negative?: boolean
  onClick?: () => void
}) {
  const content = (
    <>
      <div className="metric-top">
        <span className={`metric-icon ${tone}`}>{icon}</span>
        {trend && <span className={`metric-trend ${negative ? 'negative' : 'positive'}`}><ArrowUpRight aria-hidden="true" /></span>}
      </div>
      <div className="metric-number">{value}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-footer"><span>{footer}</span></div>
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={`metric-card metric-clickable ${featured ? 'metric-feature' : ''}`} onClick={onClick}>
        {content}
      </button>
    )
  }
  return (
    <article className={`metric-card ${featured ? 'metric-feature' : ''}`}>
      {content}
    </article>
  )
}

function DeadlinesPanel({
  upcoming,
  onOpen,
  onOpenTask,
  compact = false,
}: {
  upcoming: DbTask[]
  onOpen: () => void
  onOpenTask?: (task: DbTask) => void
  compact?: boolean
}) {
  const shown = compact ? upcoming.slice(0, 6) : upcoming
  const hiddenCount = Math.max(0, upcoming.length - shown.length)
  return (
    <section className={`panel deadlines-panel ${compact ? 'deadlines-panel-compact' : ''}`}>
      <div className="panel-heading">
        <div>
          <h2>Upcoming deadlines</h2>
          <p>{compact ? 'Next 7 days' : 'The next 7 days'}</p>
        </div>
        <CalendarDays aria-hidden="true" className="heading-icon" />
      </div>
      <div className="deadline-list">
        {shown.map((task, index) => {
          const due = task.dueDate ? new Date(task.dueDate) : null
          const day = due ? due.getDate() : 0
          const month = due ? due.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase() : ''
          const urgent = task.status === 'blocked' || task.status === 'pending_approval'
          return (
            <button
              type="button"
              key={task.id}
              className={`deadline-item ${urgent || index === 0 ? 'urgent' : ''}`}
              onClick={() => onOpenTask?.(task)}
            >
              <div className="date-tile"><strong>{day}</strong><span>{month}</span></div>
              <div>
                <strong>{task.title}</strong>
                <span>{formatDue(task.dueDate)} · {task.department?.name ?? 'General'}</span>
              </div>
              {urgent ? <CircleAlert aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
          )
        })}
        {shown.length === 0 ? <p className="empty-state empty-state-compact">No deadlines in the next week.</p> : null}
      </div>
      {hiddenCount > 0 ? (
        <p className="deadline-more">{hiddenCount} more this week</p>
      ) : null}
      <button className="panel-link" onClick={onOpen}>Open calendar <ArrowUpRight aria-hidden="true" /></button>
    </section>
  )
}

function DepartmentPanel({ departments, onOpen }: { departments: DbDepartment[]; onOpen?: (id: string) => void }) {
  return (
    <section className="panel department-panel">
      <div className="panel-heading">
        <div><h2>Department progress</h2><p>Completion across active work</p></div>
      </div>
      <div className="department-list">
        {departments.map((department) => (
          <button type="button" className="department-row" key={department.id} onClick={() => onOpen?.(department.id)}>
            <div className={`department-icon department-${department.color}`}>{department.name.slice(0, 1)}</div>
            <div className="department-name">
              <strong>{department.name}</strong>
              <span>{department.owner ? ledBy(fullName(department.owner)) : 'No lead assigned'}</span>
            </div>
            <div className="progress-track">
              <div className={`progress-fill fill-${department.color}`} style={{ width: `${department.progress}%` }} />
            </div>
            <strong className="progress-number">{department.progress}%</strong>
            <span className="task-count">{department.completed} / {department.total}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function ActivityPanel({ events, full = false }: { events: DbActivityEvent[]; full?: boolean }) {
  return (
    <div className={full ? 'activity-panel activity-panel-full' : 'panel activity-panel'}>
      <div className="panel-heading">
        <div><h2>Recent activity</h2><p>Latest updates from your team</p></div>
      </div>
      <div className="activity-list">
        {events.map((event) => (
          <div className="activity-row" key={event.id}>
            <UserAvatar
              initials={event.actor?.initials ?? 'G'}
              url={event.actor?.avatarUrl}
              color={event.actor?.avatarColor}
              size="sm"
            />
            <div>
              <strong>
                {event.actor ? fullName(event.actor) : 'Workspace'} <span>{event.action}</span>
              </strong>
              <p>{event.summary}</p>
              <small>{formatRelative(new Date(event.createdAt))}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectCard({
  title,
  description,
  owner,
  progress,
  completionRate,
  status,
  risk,
  overdueCount,
  blockedCount,
  nextMilestone,
  tasks,
  department,
  contributingDepartments,
  participation,
  onOpen,
}: DbProject & { onOpen?: () => void }) {
  return (
    <article className="panel project-card project-card-interactive" onClick={onOpen} onKeyDown={(event) => event.key === 'Enter' && onOpen?.()} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}>
      <div className="project-card-top">
        <span className="project-icon"><BriefcaseBusiness aria-hidden="true" /></span>
        <div className="project-card-badges">
          {participation === 'contributing' ? <StatusBadge status="Contributing" /> : null}
          {participation === 'home' ? <StatusBadge status="Home" /> : null}
          <StatusBadge status={status} />
          <StatusBadge status={risk} />
        </div>
      </div>
      <h2>{title}</h2>
      <p>{ledBy(owner)}{department ? ` · ${department}` : ''}</p>
      {contributingDepartments && contributingDepartments.length > 0 ? (
        <p className="project-card-summary">With {contributingDepartments.map((entry) => entry.name).join(', ')}</p>
      ) : null}
      {description ? <p className="project-card-summary">{description}</p> : null}
      <div className="project-progress">
        <strong>{completionRate}%</strong>
        <span>completion</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill fill-teal" style={{ width: `${progress}%` }} />
      </div>
      <div className="project-meta">
        <span>{tasks} tasks</span>
        <span>{overdueCount} overdue</span>
        <span>{blockedCount} blocked</span>
      </div>
      <div className="project-risk">
        <CircleAlert aria-hidden="true" />
        <span>Next milestone: {nextMilestone}</span>
      </div>
      <div className="project-footer">
        <strong>{progress}%</strong>
        <span>tracked progress</span>
        <ArrowUpRight aria-hidden="true" />
      </div>
    </article>
  )
}
