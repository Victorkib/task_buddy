import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { ACTIVE_TASK_STATUSES } from '@/lib/constants'
import { getAuthSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db'
import {
  activityEvents,
  companies,
  departments,
  responsibilities,
  projects,
  responsibilityAssignees,
  roles,
  taskComments,
  tasks,
  users,
  teams,
  notifications,
  notificationPreferences,
  managementRequests,
} from '@/lib/db/schema'
import { isOverdue } from '@/lib/format'
import type { CurrentUser } from '@/lib/types'
import { ensureNotificationPreferences, syncDeadlineAlertsForUser } from '@/lib/notifications/sync-alerts'
import {
  canCreateWork,
  canManageOrg,
  canSeeProject,
  canSeeTask,
  isDepartmentLeader,
  isManagement,
} from '@/lib/auth/permissions'
import { buildReport } from '@/lib/reporting/build-report'
import { projectAccessFromRow, taskAccessFromRow } from '@/lib/db/task-access'


export async function getCompany() {
  const [company] = await getDb().select().from(companies).limit(1)
  return company ?? null
}

export async function getUserById(id: string) {
  return getDb().query.users.findFirst({
    where: eq(users.id, id),
    with: {
      department: true,
      manager: true,
      roles: { with: { role: true } },
    },
  })
}

export async function getUserByEmail(email: string) {
  return getDb().query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
    with: {
      department: true,
      manager: true,
      roles: { with: { role: true } },
    },
  })
}


export async function getCurrentUser() {
  const session = await getAuthSession()
  const userId = session?.user?.id
  if (!userId) return null
  const user = await getUserById(userId)
  if (!user || user.status !== 'active') return null
  return user
}

export async function getWorkspaceContext() {
  const company = await getCompany()
  const currentUser = await getCurrentUser()
  const people = currentUser ? await listPeople(currentUser) : []
  const directory = currentUser ? await listDirectory(currentUser) : []
  const departmentDirectory = currentUser ? await listDepartmentDirectory(currentUser) : []
  return { company, currentUser, people, directory, departmentDirectory }
}

export async function listPeople(viewer?: CurrentUser | null) {
  const rows = await getDb().query.users.findMany({
    where:
      viewer && isManagement(viewer)
        ? undefined
        : or(eq(users.status, 'active'), eq(users.status, 'invited')),
    with: {
      department: true,
      team: true,
      manager: true,
      roles: { with: { role: true } },
    },
    orderBy: [asc(users.firstName), asc(users.lastName)],
  })

  if (!viewer) return []
  if (isManagement(viewer)) return rows
  if (isDepartmentLeader(viewer) && viewer.departmentId) {
    return rows.filter((row) => row.departmentId === viewer.departmentId)
  }
  return rows.filter((row) => row.id === viewer.id && row.status === 'active')
}

export async function listDirectory(viewer?: CurrentUser | null) {
  if (!viewer || !canCreateWork(viewer)) {
    return (await listPeople(viewer)).filter((row) => row.status === 'active')
  }
  if (isManagement(viewer)) {
    return getDb().query.users.findMany({
      where: eq(users.status, 'active'),
      with: {
        department: true,
        manager: true,
      },
      orderBy: [asc(users.firstName), asc(users.lastName)],
    })
  }

  return getDb().query.users.findMany({
    where: eq(users.status, 'active'),
    with: {
      department: true,
      manager: true,
    },
    orderBy: [asc(users.firstName), asc(users.lastName)],
  })
}

export async function listDepartmentDirectory(viewer?: CurrentUser | null) {
  const rows = await getDb().query.departments.findMany({
    with: { owner: true },
    orderBy: [asc(departments.name)],
  })
  if (!viewer) return []
  if (isManagement(viewer) || canCreateWork(viewer)) return rows
  if (viewer.departmentId) return rows.filter((row) => row.id === viewer.departmentId)
  return []
}

export async function listTasks(options?: { assigneeId?: string; departmentId?: string; viewer?: CurrentUser | null }) {
  const rows = await getDb().query.tasks.findMany({
    where: and(
      options?.assigneeId ? eq(tasks.assigneeId, options.assigneeId) : undefined,
      options?.departmentId ? eq(tasks.departmentId, options.departmentId) : undefined,
    ),
    with: {
      assignee: true,
      department: true,
      project: {
        with: {
          teams: true,
          projectDepartments: true,
        },
      },
      comments: { with: { user: true } },
      attachments: { with: { user: true } },
      reports: { with: { author: true, emailedTo: true }, orderBy: (table, { desc: d }) => [d(table.createdAt)] },
      approvals: { with: { requestor: true, approver: true } },
      deliverables: true,
      milestoneLinks: { with: { milestone: true } },
      blockingDependencies: { with: { blockedTask: true } },
      blockedByDependencies: { with: { blockingTask: true } },
    },
    orderBy: [asc(tasks.dueDate), desc(tasks.createdAt)],
  })

  const withAccess = rows.map((task) => {
    const access = taskAccessFromRow(task)
    const link =
      task.milestoneLinks.find((entry) => !task.projectId || entry.milestone.projectId === task.projectId) ??
      task.milestoneLinks[0] ??
      null
    return {
      ...task,
      ...access,
      projectId: task.projectId,
      projectTitle: task.project?.title ?? null,
      milestoneId: link?.milestoneId ?? null,
      milestoneTitle: link?.milestone.title ?? null,
    }
  })

  if (!options?.viewer) return withAccess
  return withAccess.filter((task) => canSeeTask(options.viewer ?? null, task))
}

export async function listDepartments(viewer?: CurrentUser | null) {
  const db = getDb()
  const rows = await db.query.departments.findMany({
    with: { owner: true, teams: true },
    orderBy: [asc(departments.name)],
  })

  const stats = await db
    .select({
      departmentId: tasks.departmentId,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
      active: sql<number>`count(*) filter (where ${tasks.status} not in ('completed', 'cancelled'))::int`,
      blocked: sql<number>`count(*) filter (where ${tasks.status} in ('blocked', 'pending_approval'))::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < current_date and ${tasks.status} not in ('completed', 'cancelled'))::int`,
    })
    .from(tasks)
    .groupBy(tasks.departmentId)

  const byId = new Map(stats.map((row) => [row.departmentId, row]))

  const scopedRows = rows
    .map((department) => {
    const stat = byId.get(department.id)
    const total = stat?.total ?? 0
    const completed = stat?.completed ?? 0
    const active = stat?.active ?? 0
    const blocked = stat?.blocked ?? 0
    const overdue = stat?.overdue ?? 0
    const progress = total === 0 ? 0 : Math.round((completed / total) * 100)
    return { ...department, total, completed, active, blocked, overdue, progress }
  })

  if (!viewer) return []
  if (isManagement(viewer)) return scopedRows
  if (viewer.departmentId) return scopedRows.filter((department) => department.id === viewer.departmentId)
  return []
}

export async function getDepartmentBySlug(slug: string) {
  const department = await getDb().query.departments.findFirst({
    where: eq(departments.slug, slug),
    with: { owner: true, teams: true, users: true },
  })
  if (!department) return null

  const currentUser = await getCurrentUser()
  const departmentTasks = await listTasks({ departmentId: department.id, viewer: currentUser })
  const total = departmentTasks.length
  const completed = departmentTasks.filter((task) => task.status === 'completed').length
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100)

  return { ...department, tasks: departmentTasks, total, completed, progress }
}

export async function listResponsibilities(options?: { ownerId?: string; viewer?: CurrentUser | null }) {
  const rows = await getDb().query.responsibilities.findMany({
    where: options?.ownerId ? eq(responsibilities.ownerId, options.ownerId) : undefined,
    with: {
      owner: true,
      department: true,
      assignees: { with: { user: true } },
    },
    orderBy: [asc(responsibilities.title)],
  })

  const viewer = options?.viewer ?? null
  if (!viewer) return rows
  if (isManagement(viewer)) return rows
  if (isDepartmentLeader(viewer) && viewer.departmentId) {
    return rows.filter((row) => row.departmentId === viewer.departmentId || row.ownerId === viewer.id)
  }
  return rows.filter((row) => row.ownerId === viewer.id)
}

export async function listActivity(limit = 12, viewer?: CurrentUser | null) {
  const fetchLimit = viewer && !isManagement(viewer) ? Math.min(Math.max(limit * 8, 80), 240) : limit
  const rows = await getDb().query.activityEvents.findMany({
    with: { actor: true },
    orderBy: [desc(activityEvents.createdAt)],
    limit: fetchLimit,
  })

  if (!viewer || isManagement(viewer)) return rows.slice(0, limit)

  const taskIds = [...new Set(rows.filter((row) => row.entityType === 'task' && row.entityId).map((row) => row.entityId!))]
  const projectIds = [
    ...new Set(rows.filter((row) => row.entityType === 'project' && row.entityId).map((row) => row.entityId!)),
  ]
  const [taskRows, projectRows] = await Promise.all([
    taskIds.length
      ? getDb().select({ id: tasks.id, departmentId: tasks.departmentId, assigneeId: tasks.assigneeId }).from(tasks).where(inArray(tasks.id, taskIds))
      : Promise.resolve([]),
    projectIds.length
      ? getDb()
          .query.projects.findMany({
            where: inArray(projects.id, projectIds),
            with: { projectDepartments: true, teams: true },
          })
      : Promise.resolve([]),
  ])
  const taskById = new Map(taskRows.map((row) => [row.id, row]))
  const projectById = new Map(projectRows.map((row) => [row.id, row]))

  const visible = rows.filter((row) => {
    if (row.actorId === viewer.id) return true
    if (isDepartmentLeader(viewer) && viewer.departmentId) {
      if (row.actor?.departmentId === viewer.departmentId) return true
      const task = row.entityType === 'task' && row.entityId ? taskById.get(row.entityId) : null
      if (task && canSeeTask(viewer, task)) return true
      const project = row.entityType === 'project' && row.entityId ? projectById.get(row.entityId) : null
      if (project && canSeeProject(viewer, projectAccessFromRow(project))) return true
      return false
    }
    const task = row.entityType === 'task' && row.entityId ? taskById.get(row.entityId) : null
    return Boolean(task && canSeeTask(viewer, task))
  })

  return visible.slice(0, limit)
}

export async function getDashboardData(user: CurrentUser) {
  const company = await getCompany()
  if (company) {
    await ensureNotificationPreferences(user.id)
    await syncDeadlineAlertsForUser(user, company.id)
  }

  const overview = await getOverviewData(user)
  const [responsibilities, allActivity, allTasks, notificationsList, unreadNotificationCount, managementRequestsList, notificationPrefs] =
    await Promise.all([
      listResponsibilities({ viewer: user }),
      listActivity(20, user),
      listTasks({ viewer: user }),
      listNotifications(user.id, 25),
      getUnreadNotificationCount(user.id),
      listManagementRequests(user),
      getNotificationPreferences(user.id),
    ])

  const myTasks = allTasks.filter((task) => task.assigneeId === user.id)
  const myActive = myTasks.filter(
    (task) => task.status !== 'completed' && task.status !== 'cancelled',
  )
  const myCompleted = myTasks.filter((task) => task.status === 'completed')
  const myInProgress = myTasks.filter((task) => task.status === 'in_progress')

  const projects = await listProjects({ viewer: user })

  return {
    ...overview,
    responsibilities,
    allActivity,
    allTasks,
    myTasks,
    myMetrics: {
      assigned: myActive.length,
      inProgress: myInProgress.length,
      completed: myCompleted.length,
    },
    projects,
    reportMetrics: buildReport({
      tasks: allTasks,
      departments: overview.departments,
      projects,
      people: overview.people,
    }),
    notifications: notificationsList,
    unreadNotificationCount,
    managementRequests: managementRequestsList,
    notificationPreferences: notificationPrefs,
  }
}

export async function listProjects(options?: { limit?: number; viewer?: CurrentUser | null }) {
  const rows = await getDb().query.projects.findMany({
    with: {
      owner: { with: { department: true } },
      partner: true,
      department: true,
      teams: { with: { user: true } },
      projectDepartments: { with: { department: true } },
      tasks: true,
      milestones: {
        with: {
          milestoneTasks: {
            with: { task: true },
          },
        },
      },
    },
    orderBy: [desc(projects.updatedAt)],
    limit: options?.limit,
  })

  const filteredRows = rows.filter((project) => {
    if (project.status === 'archived') return false
    const viewer = options?.viewer ?? null
    if (!viewer) return true
    return canSeeProject(viewer, projectAccessFromRow(project))
  })

  const projectIds = filteredRows.map((project) => project.id)
  const linkedTaskIds = [
    ...new Set(
      filteredRows.flatMap((project) =>
        project.milestones.flatMap((milestone) => milestone.milestoneTasks.map((entry) => entry.task.id)),
      ),
    ),
  ]
  const activityRows =
    projectIds.length === 0
      ? []
      : await getDb().query.activityEvents.findMany({
          where: or(
            and(eq(activityEvents.entityType, 'project'), inArray(activityEvents.entityId, projectIds)),
            linkedTaskIds.length
              ? and(eq(activityEvents.entityType, 'task'), inArray(activityEvents.entityId, linkedTaskIds))
              : and(eq(activityEvents.entityType, 'project'), inArray(activityEvents.entityId, projectIds)),
          ),
          with: { actor: true },
          orderBy: [desc(activityEvents.createdAt)],
          limit: 400,
        })

  return filteredRows.map((project) => {
    const milestoneTaskMap = new Map(
      project.milestones.flatMap((milestone) =>
        milestone.milestoneTasks.map((entry) => [entry.task.id, entry.task]),
      ),
    )
    const projectTasks = [
      ...project.tasks,
      ...[...milestoneTaskMap.values()].filter((task) => !project.tasks.some((entry) => entry.id === task.id)),
    ].filter((task) => task.status !== 'cancelled')
    const allMilestoneTasks = project.milestones
      .flatMap((m) => m.milestoneTasks)
      .filter((mt) => mt.task.status !== 'cancelled')
    const total = projectTasks.length
    const completed = projectTasks.filter((task) => task.status === 'completed').length
    const progressValues = projectTasks.map((task) => task.progress ?? 0)
    const progress =
      total === 0 ? project.progress : Math.round(progressValues.reduce((sum, value) => sum + value, 0) / total)
    const overdueCount = projectTasks.filter((task) => isOverdue(task.dueDate, task.status)).length
    const blockedCount = projectTasks.filter(
      (task) => task.status === 'blocked' || task.status === 'pending_approval',
    ).length
    const health =
      total === 0
        ? 'No linked work'
        : overdueCount > 0 && progress < 90
          ? 'At risk'
          : progress >= 70 && overdueCount === 0
            ? 'On track'
            : progress >= 40
              ? 'At risk'
              : 'Needs review'
    const risk =
      overdueCount > 0 ? 'High risk' : blockedCount > 0 ? 'Medium risk' : progress < 50 ? 'Watch closely' : 'Low risk'
    const nextMilestone = [...project.milestones]
      .filter((milestone) => milestone.dueDate)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0]
    const contributingDepartments = project.projectDepartments
      .filter((entry) => entry.role === 'contributing')
      .map((entry) => ({ id: entry.department.id, name: entry.department.name }))
    const viewer = options?.viewer ?? null
    const participation: 'home' | 'contributing' | 'member' =
      viewer && viewer.departmentId && project.departmentId === viewer.departmentId
        ? 'home'
        : viewer &&
            viewer.departmentId &&
            contributingDepartments.some((entry) => entry.id === viewer.departmentId)
          ? 'contributing'
          : 'member'
    const taskIdSet = new Set(projectTasks.map((task) => task.id))
    const activity = activityRows
      .filter(
        (event) =>
          (event.entityType === 'project' && event.entityId === project.id) ||
          (event.entityType === 'task' && event.entityId !== null && taskIdSet.has(event.entityId)),
      )
      .slice(0, 12)
      .map((event) => ({
        id: event.id,
        action: event.action,
        summary: event.summary,
        createdAt: event.createdAt,
        actor: event.actor
          ? {
              initials: event.actor.initials,
              firstName: event.actor.firstName,
              lastName: event.actor.lastName,
              avatarUrl: event.actor.avatarUrl,
              avatarColor: event.actor.avatarColor,
            }
          : null,
      }))

    return {
      id: project.id,
      title: project.title,
      description: project.description,
      owner: project.owner ? `${project.owner.firstName} ${project.owner.lastName}` : 'Unassigned',
      ownerId: project.ownerId,
      partnerId: project.partnerId ?? null,
      partner: project.partner ? `${project.partner.firstName} ${project.partner.lastName}` : null,
      departmentId: project.departmentId ?? project.owner?.departmentId ?? null,
      department: project.department?.name ?? project.owner?.department?.name ?? null,
      projectStatus: project.status,
      progress,
      completionRate: progress,
      status: health === 'No linked work' ? 'On track' : health,
      health,
      risk,
      overdueCount,
      blockedCount,
      milestoneCount: project.milestones.length,
      nextMilestone: nextMilestone?.title ?? 'No milestone scheduled',
      nextMilestoneDue: nextMilestone?.dueDate ?? null,
      tasks: `${completed} / ${total}`,
      taskIds: projectTasks.map((task) => task.id),
      unscheduledTaskIds: projectTasks
        .filter((task) => !allMilestoneTasks.some((entry) => entry.task.id === task.id))
        .map((task) => task.id),
      contributingDepartments,
      participation,
      activity,
      milestones: project.milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        startDate: milestone.startDate,
        dueDate: milestone.dueDate,
        progress: milestone.progress,
        taskIds: milestone.milestoneTasks.map((entry) => entry.task.id),
      })),
      team: project.teams.map((entry) => ({
        id: entry.user.id,
        firstName: entry.user.firstName,
        lastName: entry.user.lastName,
        initials: entry.user.initials,
        avatarUrl: entry.user.avatarUrl,
        avatarColor: entry.user.avatarColor,
      })),
    }
  })
}

export async function getOverviewData(user: CurrentUser) {
  const [allTasks, departmentRows, activity, myResponsibilities, people] = await Promise.all([
    listTasks({ viewer: user }),
    listDepartments(user),
    listActivity(6, user),
    listResponsibilities({ ownerId: user.id, viewer: user }),
    listPeople(user),
  ])

  const report = buildReport({
    tasks: allTasks,
    departments: departmentRows,
    projects: [],
    people,
  })
  const upcoming = [...allTasks]
    .filter((task) => task.dueDate && ACTIVE_TASK_STATUSES.includes(task.status as (typeof ACTIVE_TASK_STATUSES)[number]))
    .sort((a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')))
    .slice(0, 4)

  return {
    metrics: {
      active: report.active,
      departments: departmentRows.length,
      dueThisWeek: report.dueThisWeek,
      dueToday: report.dueToday,
      attention: report.attention,
      overdue: report.overdue,
      blocked: report.blocked,
      completionRate: report.completionRate,
    },
    tasks: allTasks,
    departments: departmentRows,
    activity,
    upcoming,
    myResponsibilityCount: myResponsibilities.length,
    myTaskCount: allTasks.filter((task) => task.assigneeId === user.id && task.status !== 'completed' && task.status !== 'cancelled').length,
    people,
  }
}

export async function listRoles() {
  return getDb().select().from(roles).orderBy(asc(roles.rank))
}

export async function getSettingsData(viewer?: CurrentUser | null) {
  const currentUser = viewer ?? (await getCurrentUser())
  if (!currentUser) {
    return { company: null, people: [], roles: [], departments: [], teams: [] }
  }

  const canSeeStructure = isManagement(currentUser) || isDepartmentLeader(currentUser) || canManageOrg(currentUser)
  if (!canSeeStructure) {
    return { company: null, people: [], roles: [], departments: [], teams: [] }
  }

  const [company, people, roleRows, departmentRows, teamRows] = await Promise.all([
    getCompany(),
    listPeople(currentUser),
    listRoles(),
    getDb().query.departments.findMany({ with: { owner: true }, orderBy: [asc(departments.name)] }),
    getDb().query.teams.findMany({ with: { department: true }, orderBy: [asc(teams.name)] }),
  ])

  const departmentsScoped = isManagement(currentUser)
    ? departmentRows
    : departmentRows.filter((row) => row.id === currentUser.departmentId)
  const teamsScoped = isManagement(currentUser)
    ? teamRows
    : teamRows.filter((row) => row.departmentId === currentUser.departmentId)

  return {
    company,
    people,
    roles: roleRows,
    departments: departmentsScoped,
    teams: teamsScoped,
  }
}

export async function listNotifications(userId: string, limit = 20) {
  return getDb().query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: [desc(notifications.createdAt)],
    limit,
  })
}

export async function getUnreadNotificationCount(userId: string) {
  const rows = await getDb()
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

  return rows.length
}

export async function getNotificationPreferences(userId: string) {
  const [prefs] = await getDb()
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1)

  return (
    prefs ?? {
      userId,
      deadlineAlerts: 1,
      escalationAlerts: 1,
      approvalAlerts: 1,
      managementRequestAlerts: 1,
      dailySummary: 1,
      updatedAt: new Date(),
    }
  )
}

export async function listManagementRequests(viewer: CurrentUser) {
  const rows = await getDb().query.managementRequests.findMany({
    with: {
      requestor: true,
      assignee: true,
    },
    orderBy: [desc(managementRequests.createdAt)],
    limit: 20,
  })

  if (isManagement(viewer)) return rows
  if (isDepartmentLeader(viewer)) {
    return rows.filter(
      (row) =>
        row.requestorId === viewer.id ||
        row.assigneeId === viewer.id ||
        row.requestor?.departmentId === viewer.departmentId,
    )
  }
  return rows.filter((row) => row.requestorId === viewer.id || row.assigneeId === viewer.id)
}

export { or, and, eq, gte, lte, ne, inArray, isNull, sql, taskComments, responsibilityAssignees }
