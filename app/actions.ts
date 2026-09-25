'use server'

import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import {
  canChangeResponsibilityOwner,
  canCreateWork,
  canDeactivateUser,
  canDeleteTask,
  canEditPerson,
  canEditTask,
  canInvite,
  canManageOrg,
  canManageProject,
  canProgressTask,
  canSeeProject,
  canSeeTask,
  canSubmitLeadershipRequest,
  canSubmitWorkRequest,
  canViewCompanyReports,
  canViewDepartmentReports,
  denied,
  isDepartmentLeader,
  isDepartmentMemberCreator,
  isManagement,
} from '@/lib/auth/permissions'
import { canSelfCreateTask } from '@/lib/auth/sponsored'
import { provisionAuthIdentity, revokeAuthSessions } from '@/lib/auth/provision-user'
import { getDb } from '@/lib/db'
import { getCompany, getCurrentUser, getUserById, listTasks } from '@/lib/db/queries'
import {
  ensureContributingDepartment,
  loadProjectAccess,
  loadTaskAccess,
  syncProjectHomeDepartment,
  taskAccessFromRow,
} from '@/lib/db/task-access'
import { tasksToCsv } from '@/lib/reporting/build-report'
import {
  authUser,
  activityEvents,
  departments,
  deliverables,
  projectDepartments,
  projectMilestones,
  projectMilestoneTasks,
  projectTeams,
  projects,
  taskDependencies,
  taskApprovals,
  responsibilities,
  responsibilityAssignees,
  taskAttachments,
  taskComments,
  taskReports,
  tasks,
  users,
  roles,
  userRoles,
  notifications,
  notificationPreferences,
  managementRequests,
  teams,
  managementRequestKindEnum,
} from '@/lib/db/schema'
import type {
  projectStatusEnum,
  responsibilityStatusEnum,
  taskCategoryEnum,
  taskPriorityEnum,
  taskStatusEnum,
  managementRequestPriorityEnum,
  managementRequestStatusEnum,
} from '@/lib/db/schema'
import { resolveCategoryInput } from '@/lib/category'
import { AVATAR_COLORS } from '@/lib/constants'
import { PRODUCT_NAME } from '@/lib/branding'
import { fullName, makeInitials, statusLabel, toDateInputValue } from '@/lib/format'
import { destroyCloudinaryAsset, isOurCloudinaryUrl, purgeCloudinaryPublicIds } from '@/lib/uploads/cloudinary'

function refreshWorkhub() {
  revalidatePath('/')
  revalidatePath('/profile')
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48)
}

async function syncProjectProgress(projectId: string) {
  const row = await getDb().query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: {
      tasks: true,
      milestones: {
        with: { milestoneTasks: { with: { task: true } } },
      },
    },
  })
  if (!row) return

  for (const milestone of row.milestones) {
    const total = milestone.milestoneTasks.length
    const avg =
      total === 0
        ? 0
        : Math.round(
            milestone.milestoneTasks.reduce((sum, entry) => sum + (entry.task.progress ?? 0), 0) / total,
          )
    await getDb()
      .update(projectMilestones)
      .set({
        progress: avg,
        updatedAt: new Date(),
      })
      .where(eq(projectMilestones.id, milestone.id))
  }

  const byId = new Map(row.tasks.map((task) => [task.id, task]))
  for (const milestone of row.milestones) {
    for (const entry of milestone.milestoneTasks) {
      if (!byId.has(entry.task.id)) byId.set(entry.task.id, entry.task)
    }
  }
  const all = [...byId.values()].filter((task) => task.status !== 'cancelled')
  const total = all.length
  const progress =
    total === 0 ? 0 : Math.round(all.reduce((sum, task) => sum + (task.progress ?? 0), 0) / total)
  await getDb()
    .update(projects)
    .set({
      progress,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
}

async function syncProjectsForTask(taskId: string) {
  const [task] = await getDb().select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1)
  const links = await getDb().query.projectMilestoneTasks.findMany({
    where: eq(projectMilestoneTasks.taskId, taskId),
    with: { milestone: true },
  })
  const projectIds = [...new Set([task?.projectId, ...links.map((link) => link.milestone.projectId)].filter((id): id is string => Boolean(id)))]
  for (const projectId of projectIds) {
    await syncProjectProgress(projectId)
  }
}

async function requireManageableProject(projectId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' as const }
  const loaded = await loadProjectAccess(projectId)
  if (!loaded) return { error: 'Project not found.' as const }
  if (!canManageProject(currentUser, loaded.access)) {
    return { error: 'You are not allowed to change this project.' as const }
  }
  return { currentUser, project: loaded.project, access: loaded.access }
}

async function requireVisibleProject(projectId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' as const }
  const loaded = await loadProjectAccess(projectId)
  if (!loaded) return { error: 'Project not found.' as const }
  if (!canSeeProject(currentUser, loaded.access)) {
    return { error: 'You are not allowed to use this project.' as const }
  }
  return { currentUser, project: loaded.project, access: loaded.access }
}

async function notifyDepartmentJoined(project: { id: string; companyId: string; title: string }, departmentId: string, actorId: string) {
  const department = await getDb().query.departments.findFirst({
    where: eq(departments.id, departmentId),
  })
  if (!department?.ownerId || department.ownerId === actorId) return
  await getDb().insert(notifications).values({
    companyId: project.companyId,
    userId: department.ownerId,
    type: 'reminder',
    title: 'Brought into a project',
    body: `${department.name} is now contributing on “${project.title}”.`,
    entityType: 'project',
    entityId: project.id,
  })
}

async function clearTaskMilestoneLinks(taskId: string) {
  await getDb().delete(projectMilestoneTasks).where(eq(projectMilestoneTasks.taskId, taskId))
}

async function createProjectShell(input: {
  companyId: string
  ownerId: string
  partnerId?: string | null
  actorId: string
  departmentId: string
  title: string
  description?: string | null
  startDate?: string | Date | null
  dueDate?: string | Date | null
  milestoneTitle: string
}) {
  const created = await getDb()
    .insert(projects)
    .values({
      companyId: input.companyId,
      ownerId: input.ownerId,
      partnerId: input.partnerId || null,
      departmentId: input.departmentId,
      title: input.title,
      description: input.description ?? null,
      status: 'active',
      progress: 0,
    })
    .returning()
  const project = created[0]
  if (!project) return { error: 'Unable to create the project.' as const }

  await getDb().insert(projectTeams).values({ projectId: project.id, userId: input.ownerId })
  if (input.partnerId && input.partnerId !== input.ownerId) {
    await getDb().insert(projectTeams).values({ projectId: project.id, userId: input.partnerId })
  }
  await syncProjectHomeDepartment(project.id, input.departmentId)

  const [milestone] = await getDb()
    .insert(projectMilestones)
    .values({
      projectId: project.id,
      title: input.milestoneTitle,
      status: 'active',
      startDate: toDateInputValue(input.startDate) || null,
      dueDate: toDateInputValue(input.dueDate) || null,
      progress: 0,
    })
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: input.companyId,
    actorId: input.actorId,
    entityType: 'project',
    entityId: project.id,
    action: 'created',
    summary: `created project ${input.title}`,
  })

  return { project, milestone: milestone ?? null }
}

async function placeTaskOnMilestone(taskId: string, milestoneId: string) {
  const milestone = await getDb().query.projectMilestones.findFirst({
    where: eq(projectMilestones.id, milestoneId),
  })
  if (!milestone) return { error: 'Milestone not found.' as const }

  const [existing] = await getDb().select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1)
  const previousProjectId = existing?.projectId ?? null

  await clearTaskMilestoneLinks(taskId)
  await getDb().insert(projectMilestoneTasks).values({ milestoneId, taskId })
  await getDb().update(tasks).set({ projectId: milestone.projectId, updatedAt: new Date() }).where(eq(tasks.id, taskId))
  await syncProjectProgress(milestone.projectId)
  if (previousProjectId && previousProjectId !== milestone.projectId) {
    await syncProjectProgress(previousProjectId)
  }
  return { milestone }
}

export async function switchUser(userId: string) {
  return { error: `Switch user is disabled. Sign in with a real account instead of selecting ${userId}.` }
}

export async function logout() {
  return { redirectTo: `/api/auth/logout?redirect=${encodeURIComponent('/login?signedOut=1')}&t=${Date.now()}` }
}

async function taskAccessFor(task: {
  id: string
  assigneeId?: string | null
  departmentId?: string | null
  projectId?: string | null
}) {
  const loaded = await loadTaskAccess(task.id)
  return loaded?.access ?? taskAccessFromRow(task)
}

export async function createTask(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'A task name is required.' }

  const [currentUser, company] = await Promise.all([getCurrentUser(), getCompany()])
  if (!currentUser) return { error: 'Your session expired. Sign in again, then add the task.' }
  if (!company) return { error: 'Workspace is not ready yet.' }

  const selfServe = canSelfCreateTask(currentUser) && !canCreateWork(currentUser)
  if (!canCreateWork(currentUser) && !selfServe) {
    return denied('You are not allowed to create tasks for the workspace.')
  }

  const memberCreator = isDepartmentMemberCreator(currentUser)
  const placement = String(formData.get('placement') ?? 'independent')
  let assigneeId = String(formData.get('assigneeId') ?? currentUser.id)
  if (selfServe || memberCreator) {
    // ICs log their own work — assigning colleagues is a leader action.
    assigneeId = currentUser.id
  }
  if (selfServe) {
    if (placement === 'new') {
      return denied('Ask your supervisor or department lead to open a project. You can log your own tasks.')
    }
  }

  const assignee = assigneeId === currentUser.id ? currentUser : await getUserById(assigneeId)
  if (memberCreator) {
    if (!currentUser.departmentId) {
      return denied('Join a department before creating work.')
    }
  }
  const resolvedCategory = resolveCategoryInput(formData)
  if ('error' in resolvedCategory) return { error: resolvedCategory.error }
  const category = resolvedCategory.category
  const categoryCustom = resolvedCategory.custom
  const priority = (String(formData.get('priority') || 'medium') ||
    'medium') as (typeof taskPriorityEnum.enumValues)[number]
  const startDate = String(formData.get('startDate') ?? '') || null
  const dueDate = String(formData.get('dueDate') ?? '') || null
  const description = String(formData.get('description') ?? '').trim() || null
  let departmentId =
    String(formData.get('departmentId') ?? '') ||
    assignee?.departmentId ||
    currentUser.departmentId ||
    null

  let projectId = String(formData.get('projectId') ?? '') || null
  let milestoneId = String(formData.get('milestoneId') ?? '') || null
  let milestoneForTask: { id: string; projectId: string; title: string } | null = null
  let createdProjectId: string | null = null

  if (placement === 'new') {
    const projectTitle = String(formData.get('newProjectTitle') ?? '').trim()
    if (!projectTitle) return { error: 'A project name is required for this task.' }
    let homeDepartmentId = String(formData.get('newProjectDepartmentId') ?? '') || currentUser.departmentId || null
    if ((isDepartmentLeader(currentUser) || memberCreator) && !isManagement(currentUser)) {
      homeDepartmentId = currentUser.departmentId
    }
    if (!homeDepartmentId) return { error: 'Select the home department for the new project.' }

    const created = await createProjectShell({
      companyId: company.id,
      ownerId: currentUser.id,
      partnerId: String(formData.get('partnerId') ?? '') || null,
      actorId: currentUser.id,
      departmentId: homeDepartmentId,
      title: projectTitle,
      startDate,
      dueDate,
      milestoneTitle: String(formData.get('newProjectMilestone') ?? '').trim() || 'Delivery',
    })
    if ('error' in created) return { error: created.error }
    projectId = created.project.id
    createdProjectId = created.project.id
    if (created.milestone) {
      milestoneId = created.milestone.id
      milestoneForTask = created.milestone
    }
  } else if (placement === 'project' || projectId) {
    if (!projectId) return { error: 'Select a project for this task, or mark it independent.' }
    const visible = await requireVisibleProject(projectId)
    if ('error' in visible) return { error: visible.error }
    if (selfServe) {
      const loaded = await loadProjectAccess(projectId)
      const onTeam = Boolean(
        loaded?.access.teamUserIds?.includes(currentUser.id) || loaded?.access.ownerId === currentUser.id,
      )
      if (!onTeam) {
        return denied('You can only attach self-logged work to projects you already belong to.')
      }
    }
    projectId = visible.project.id
    if (milestoneId) {
      const milestone = await getDb().query.projectMilestones.findFirst({
        where: eq(projectMilestones.id, milestoneId),
      })
      if (!milestone || milestone.projectId !== projectId) return { error: 'Milestone not found.' }
      milestoneForTask = milestone
    }
  } else {
    projectId = null
    milestoneId = null
  }

  const leaderLocked = (isDepartmentLeader(currentUser) || memberCreator) && !isManagement(currentUser)
  if (!projectId && leaderLocked) {
    departmentId = currentUser.departmentId
    if (assignee?.departmentId && assignee.departmentId !== currentUser.departmentId) {
      return denied('Independent tasks stay in your department. Put cross-department work on a project first.')
    }
  } else if (projectId) {
    departmentId = assignee?.departmentId || departmentId
  }

  if (selfServe || memberCreator) {
    departmentId = currentUser.departmentId || departmentId
  }

  if (projectId && assignee?.departmentId && assignee.departmentId !== departmentId) {
    departmentId = assignee.departmentId
  }

  const [task] = await getDb()
    .insert(tasks)
    .values({
      companyId: company.id,
      title,
      description,
      assigneeId,
      createdById: currentUser.id,
      departmentId,
      projectId,
      category,
      categoryCustom,
      priority,
      status: 'not_started',
      startDate,
      dueDate,
    })
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: company.id,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: task.id,
    action: 'created',
    summary: selfServe ? `logged personal task ${title}` : `created ${title}`,
  })

  if (assigneeId && assigneeId !== currentUser.id) {
    await getDb().insert(notifications).values({
      companyId: company.id,
      userId: assigneeId,
      type: 'reminder',
      title: 'New task assigned',
      body: `${currentUser.firstName} ${currentUser.lastName} assigned you “${title}”.`,
      entityType: 'task',
      entityId: task.id,
    })
  }

  if (selfServe) {
    let sponsorId = currentUser.managerId ?? null
    if (!sponsorId && currentUser.departmentId) {
      const [dept] = await getDb().select().from(departments).where(eq(departments.id, currentUser.departmentId)).limit(1)
      sponsorId = dept?.ownerId ?? null
    }
    if (sponsorId && sponsorId !== currentUser.id) {
      await getDb().insert(notifications).values({
        companyId: company.id,
        userId: sponsorId,
        type: 'reminder',
        title: 'Team member logged a task',
        body: `${currentUser.firstName} ${currentUser.lastName} added “${title}” to their queue.`,
        entityType: 'task',
        entityId: task.id,
      })
    }
  }

  if (projectId && assignee?.departmentId) {
    const added = await ensureContributingDepartment(projectId, assignee.departmentId)
    if (added.created) {
      const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1)
      if (project) await notifyDepartmentJoined(project, assignee.departmentId, currentUser.id)
    }
  }

  if (milestoneForTask) {
    const placed = await placeTaskOnMilestone(task.id, milestoneForTask.id)
    if ('error' in placed) return { error: placed.error }
    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: currentUser.id,
      entityType: 'project',
      entityId: milestoneForTask.projectId,
      action: 'task_linked',
      summary: `linked ${title} to ${milestoneForTask.title}`,
    })
  } else if (projectId) {
    await syncProjectProgress(projectId)
  }

  refreshWorkhub()
  return { ok: true, projectId: createdProjectId ?? projectId }
}

export async function createResponsibility(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'A responsibility name is required.' }

  const [currentUser, company] = await Promise.all([getCurrentUser(), getCompany()])
  if (!currentUser || !company) return { error: 'Workspace is not ready yet.' }
  if (!canCreateWork(currentUser)) {
    return denied('You are not allowed to create responsibilities.')
  }

  const ownerId = String(formData.get('ownerId') ?? currentUser.id)
  const resolvedCategory = resolveCategoryInput(formData)
  if ('error' in resolvedCategory) return { error: resolvedCategory.error }
  const category =
    resolvedCategory.category === 'other'
      ? resolvedCategory.custom ?? 'other'
      : resolvedCategory.category
  const status = (String(formData.get('status') || 'active') ||
    'active') as (typeof responsibilityStatusEnum.enumValues)[number]
  const description = String(formData.get('description') ?? '').trim() || null
  const departmentId = String(formData.get('departmentId') ?? '') || null

  const [resp] = await getDb()
    .insert(responsibilities)
    .values({
      companyId: company.id,
      title,
      description,
      ownerId,
      departmentId,
      category,
      status,
    })
    .returning()

  await getDb().insert(responsibilityAssignees).values({
    responsibilityId: resp.id,
    userId: ownerId,
  })

  await getDb().insert(activityEvents).values({
    companyId: company.id,
    actorId: currentUser.id,
    entityType: 'responsibility',
    entityId: resp.id,
    action: 'created',
    summary: `created responsibility ${title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function updateResponsibilityOwner(responsibilityId: string, ownerId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [responsibility] = await getDb()
    .select()
    .from(responsibilities)
    .where(eq(responsibilities.id, responsibilityId))
    .limit(1)
  if (!responsibility) return { error: 'Responsibility not found.' }
  if (!canChangeResponsibilityOwner(currentUser, responsibility)) {
    return { error: 'You are not allowed to change this responsibility owner.' }
  }

  await getDb()
    .update(responsibilities)
    .set({ ownerId })
    .where(eq(responsibilities.id, responsibilityId))

  await getDb().insert(activityEvents).values({
    companyId: responsibility.companyId,
    actorId: currentUser.id,
    entityType: 'responsibility',
    entityId: responsibilityId,
    action: 'ownership_changed',
    summary: `changed owner for ${responsibility.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function createProject(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'A project name is required.' }

  const [currentUser, company] = await Promise.all([getCurrentUser(), getCompany()])
  if (!currentUser || !company) return { error: 'Workspace is not ready yet.' }
  if (!canCreateWork(currentUser)) return denied('You are not allowed to create projects.')

  const memberCreator = isDepartmentMemberCreator(currentUser)
  let ownerId = String(formData.get('ownerId') ?? currentUser.id)
  if (memberCreator) {
    ownerId = currentUser.id
  }
  const partnerId = String(formData.get('partnerId') ?? '') || null
  if (partnerId && partnerId === ownerId) {
    return { error: 'Lead partner must be different from the project lead.' }
  }
  if (memberCreator && partnerId) {
    const partner = await getUserById(partnerId)
    if (!partner || partner.departmentId !== currentUser.departmentId) {
      return denied('Choose a lead partner from your own department.')
    }
  }
  const description = String(formData.get('description') ?? '').trim() || null

  let departmentId = String(formData.get('departmentId') ?? '') || null
  if ((isDepartmentLeader(currentUser) || memberCreator) && !isManagement(currentUser)) {
    departmentId = currentUser.departmentId
  }
  if (!departmentId) return { error: 'Select a department to scope the project.' }

  const milestoneTitle = String(formData.get('milestoneTitle') ?? '').trim() || 'Delivery'
  const startDate = String(formData.get('startDate') ?? '') || null
  const dueDate = String(formData.get('dueDate') ?? '') || null

  const created = await createProjectShell({
    companyId: company.id,
    ownerId,
    partnerId,
    actorId: currentUser.id,
    departmentId,
    title,
    description,
    startDate,
    dueDate,
    milestoneTitle,
  })
  if ('error' in created) return { error: created.error }
  const project = created.project

  const teamUserIds = formData.getAll('teamUserIds').map((v) => String(v)).filter(Boolean)
  const teamSet = new Set<string>([ownerId, ...(partnerId ? [partnerId] : []), ...teamUserIds])
  const existingTeam = await getDb()
    .select({ userId: projectTeams.userId })
    .from(projectTeams)
    .where(eq(projectTeams.projectId, project.id))
  const existingIds = new Set(existingTeam.map((row) => row.userId))
  const toInsert = [...teamSet].filter((userId) => !existingIds.has(userId))
  if (toInsert.length > 0) {
    await getDb().insert(projectTeams).values(toInsert.map((userId) => ({ projectId: project.id, userId })))
  }

  const contributingIds = formData.getAll('contributingDepartmentIds').map((value) => String(value)).filter(Boolean)
  for (const contributingId of contributingIds) {
    if (contributingId === departmentId) continue
    const added = await ensureContributingDepartment(project.id, contributingId)
    if (added.created) await notifyDepartmentJoined(project, contributingId, currentUser.id)
  }

  for (const userId of teamSet) {
    const member = await getUserById(userId)
    if (member?.departmentId) {
      const added = await ensureContributingDepartment(project.id, member.departmentId)
      if (added.created) await notifyDepartmentJoined(project, member.departmentId, currentUser.id)
    }
  }

  refreshWorkhub()
  return { ok: true as const, projectId: project.id, id: project.id }
}

export async function updateProjectDetails(input: {
  projectId: string
  title: string
  description: string
  status: (typeof projectStatusEnum.enumValues)[number]
  ownerId: string
  partnerId?: string | null
  departmentId: string
}) {
  const loaded = await requireManageableProject(input.projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded

  const title = input.title.trim()
  if (!title) return { error: 'A project name is required.' }
  if (!input.departmentId) return { error: 'Select a department to scope the project.' }

  let ownerId = input.ownerId
  let partnerId = input.partnerId || null
  let departmentId = input.departmentId
  if (isDepartmentMemberCreator(currentUser)) {
    if (project.ownerId !== currentUser.id) {
      return denied('You can only edit projects you lead.')
    }
    ownerId = currentUser.id
    departmentId = currentUser.departmentId ?? project.departmentId ?? departmentId
    if (partnerId) {
      const partner = await getUserById(partnerId)
      if (!partner || partner.departmentId !== currentUser.departmentId) {
        return denied('Choose a lead partner from your own department.')
      }
    }
  }
  if (!ownerId) return { error: 'Select who leads this project.' }
  if (partnerId && partnerId === ownerId) {
    return { error: 'Lead partner must be different from the project lead.' }
  }

  await getDb()
    .update(projects)
    .set({
      title,
      description: input.description.trim() || null,
      status: input.status,
      ownerId,
      partnerId,
      departmentId,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id))

  const existingTeam = await getDb()
    .select({ userId: projectTeams.userId })
    .from(projectTeams)
    .where(eq(projectTeams.projectId, project.id))
  if (!existingTeam.some((row) => row.userId === ownerId)) {
    await getDb().insert(projectTeams).values({ projectId: project.id, userId: ownerId })
  }
  if (partnerId && !existingTeam.some((row) => row.userId === partnerId)) {
    await getDb().insert(projectTeams).values({ projectId: project.id, userId: partnerId })
  }

  await syncProjectHomeDepartment(project.id, departmentId)

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'edited',
    summary: `updated project ${title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function addProjectMilestone(formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '')
  const loaded = await requireManageableProject(projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded

  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'A milestone name is required.' }
  const startDate = String(formData.get('startDate') ?? '') || null
  const dueDate = String(formData.get('dueDate') ?? '') || null
  if (startDate && dueDate && dueDate < startDate) {
    return { error: 'Due date cannot be before the start date.' }
  }

  const [milestone] = await getDb()
    .insert(projectMilestones)
    .values({
      projectId: project.id,
      title,
      status: 'planned',
      startDate,
      dueDate,
      progress: 0,
    })
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'milestone_added',
    summary: `added milestone ${milestone.title}`,
  })

  refreshWorkhub()
  return { ok: true, id: milestone.id }
}

export async function updateProjectMilestone(input: {
  milestoneId: string
  title: string
  status: 'planned' | 'active' | 'completed'
  startDate: string | null
  dueDate: string | null
}) {
  const milestone = await getDb().query.projectMilestones.findFirst({
    where: eq(projectMilestones.id, input.milestoneId),
  })
  if (!milestone) return { error: 'Milestone not found.' }
  const loaded = await requireManageableProject(milestone.projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded

  const title = input.title.trim()
  if (!title) return { error: 'A milestone name is required.' }
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
    return { error: 'Due date cannot be before the start date.' }
  }

  await getDb()
    .update(projectMilestones)
    .set({
      title,
      status: input.status,
      startDate: input.startDate || null,
      dueDate: input.dueDate || null,
      updatedAt: new Date(),
    })
    .where(eq(projectMilestones.id, milestone.id))

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'milestone_updated',
    summary: `updated milestone ${title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function deleteProjectMilestone(milestoneId: string, rehomeMilestoneId?: string | null) {
  const milestone = await getDb().query.projectMilestones.findFirst({
    where: eq(projectMilestones.id, milestoneId),
    with: { milestoneTasks: true },
  })
  if (!milestone) return { error: 'Milestone not found.' }
  const loaded = await requireManageableProject(milestone.projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded

  const siblings = await getDb()
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, project.id))
  const otherIds = siblings.map((row) => row.id).filter((id) => id !== milestone.id)

  if (rehomeMilestoneId) {
    if (!otherIds.includes(rehomeMilestoneId)) {
      return { error: 'Choose another milestone on this project to keep the linked work.' }
    }
    for (const entry of milestone.milestoneTasks) {
      const placed = await placeTaskOnMilestone(entry.taskId, rehomeMilestoneId)
      if ('error' in placed) return { error: placed.error }
    }
  }

  await getDb().delete(projectMilestones).where(eq(projectMilestones.id, milestone.id))
  await syncProjectProgress(project.id)

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'milestone_removed',
    summary: rehomeMilestoneId
      ? `removed milestone ${milestone.title} and kept linked work on this project`
      : `removed milestone ${milestone.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function addProjectTeamMember(projectId: string, userId: string) {
  const loaded = await requireManageableProject(projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded
  if (!userId) return { error: 'Select a teammate.' }

  const already = await getDb().query.projectTeams.findFirst({
    where: and(eq(projectTeams.projectId, project.id), eq(projectTeams.userId, userId)),
  })
  if (already) return { ok: true }

  await getDb().insert(projectTeams).values({ projectId: project.id, userId })
  const member = await getUserById(userId)
  if (member?.departmentId) {
    const added = await ensureContributingDepartment(project.id, member.departmentId)
    if (added.created) await notifyDepartmentJoined(project, member.departmentId, currentUser.id)
  }

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'team_added',
    summary: `added a teammate to ${project.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function addProjectDepartment(projectId: string, departmentId: string) {
  const loaded = await requireManageableProject(projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded
  if (!departmentId) return { error: 'Select a department.' }
  if (departmentId === project.departmentId) return { error: 'That department already owns this project.' }

  const added = await ensureContributingDepartment(project.id, departmentId)
  if (added.created) {
    await notifyDepartmentJoined(project, departmentId, currentUser.id)
    const department = await getDb().query.departments.findFirst({ where: eq(departments.id, departmentId) })
    await getDb().insert(activityEvents).values({
      companyId: project.companyId,
      actorId: currentUser.id,
      entityType: 'project',
      entityId: project.id,
      action: 'department_added',
      summary: `brought ${department?.name ?? 'a department'} in as a contributing function`,
    })
  }

  refreshWorkhub()
  return { ok: true }
}

export async function removeProjectDepartment(projectId: string, departmentId: string) {
  const loaded = await requireManageableProject(projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded
  if (departmentId === project.departmentId) {
    return { error: 'The home department stays on the project.' }
  }

  await getDb()
    .delete(projectDepartments)
    .where(and(eq(projectDepartments.projectId, project.id), eq(projectDepartments.departmentId, departmentId)))

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'department_removed',
    summary: `removed a contributing department from ${project.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function removeProjectTeamMember(projectId: string, userId: string) {
  const loaded = await requireManageableProject(projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded
  if (userId === project.ownerId) {
    return { error: 'The project lead stays on the team. Change the lead first.' }
  }

  await getDb()
    .delete(projectTeams)
    .where(and(eq(projectTeams.projectId, project.id), eq(projectTeams.userId, userId)))

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'team_removed',
    summary: `removed a teammate from ${project.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function linkTaskToMilestone(milestoneId: string, taskId: string) {
  const milestone = await getDb().query.projectMilestones.findFirst({
    where: eq(projectMilestones.id, milestoneId),
  })
  if (!milestone) return { error: 'Milestone not found.' }
  const visible = await requireVisibleProject(milestone.projectId)
  if ('error' in visible) return { error: visible.error }
  const { currentUser, project } = visible

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canEditTask(currentUser, await taskAccessFor(task))) {
    return denied('You are not allowed to move this task.')
  }
  if (task.projectId && task.projectId !== milestone.projectId) {
    return { error: 'This task already belongs to another project. Move it from the task details.' }
  }

  const placed = await placeTaskOnMilestone(taskId, milestoneId)
  if ('error' in placed) return { error: placed.error }

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'task_linked',
    summary: `linked ${task.title} to ${milestone.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function unlinkTaskFromMilestone(milestoneId: string, taskId: string) {
  const milestone = await getDb().query.projectMilestones.findFirst({
    where: eq(projectMilestones.id, milestoneId),
  })
  if (!milestone) return { error: 'Milestone not found.' }
  const loaded = await requireManageableProject(milestone.projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { currentUser, project } = loaded

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)

  await getDb()
    .delete(projectMilestoneTasks)
    .where(
      and(eq(projectMilestoneTasks.milestoneId, milestoneId), eq(projectMilestoneTasks.taskId, taskId)),
    )

  await syncProjectProgress(project.id)

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: project.id,
    action: 'task_unlinked',
    summary: `unlinked ${task?.title ?? 'a task'} from ${milestone.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function setTaskPlacement(input: {
  taskId: string
  projectId: string | null
  milestoneId?: string | null
  newProjectTitle?: string | null
  newProjectDepartmentId?: string | null
  newProjectMilestone?: string | null
}) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const loaded = await loadTaskAccess(input.taskId)
  if (!loaded) return { error: 'Task not found.' }
  const { task, access } = loaded
  if (!canEditTask(currentUser, access)) {
    return denied('You are not allowed to change where this task lives.')
  }

  const company = await getCompany()
  if (!company) return { error: 'Workspace is not ready yet.' }

  const previousProjectId = task.projectId
  let nextProjectId = input.projectId?.trim() || null
  let nextMilestoneId = input.milestoneId?.trim() || null
  let nextProjectTitle: string | null = task.project?.title ?? null
  let nextMilestoneTitle: string | null = null
  const creatingProject = Boolean(input.newProjectTitle?.trim()) && !nextProjectId

  if (creatingProject) {
    if (!canCreateWork(currentUser)) return denied('You are not allowed to create projects.')
    let homeDepartmentId = input.newProjectDepartmentId?.trim() || currentUser.departmentId || null
    if (isDepartmentLeader(currentUser) && !isManagement(currentUser)) {
      homeDepartmentId = currentUser.departmentId
    }
    if (!homeDepartmentId) return { error: 'Select the home department for the new project.' }

    const created = await createProjectShell({
      companyId: company.id,
      ownerId: currentUser.id,
      actorId: currentUser.id,
      departmentId: homeDepartmentId,
      title: input.newProjectTitle!.trim(),
      startDate: task.startDate,
      dueDate: task.dueDate,
      milestoneTitle: input.newProjectMilestone?.trim() || 'Delivery',
    })
    if ('error' in created) return { error: created.error }
    nextProjectId = created.project.id
    nextProjectTitle = created.project.title
    if (created.milestone) {
      nextMilestoneId = created.milestone.id
      nextMilestoneTitle = created.milestone.title
    }
  }

  if (!nextProjectId) {
    const assignee = task.assigneeId ? await getUserById(task.assigneeId) : null
    if (isDepartmentLeader(currentUser) && !isManagement(currentUser)) {
      if (assignee?.departmentId && assignee.departmentId !== currentUser.departmentId) {
        return denied('Independent tasks stay in your department. Keep cross-department work on a project.')
      }
      if (task.departmentId && currentUser.departmentId && task.departmentId !== currentUser.departmentId) {
        return denied('Independent tasks stay in your department. Keep cross-department work on a project.')
      }
    }

    await clearTaskMilestoneLinks(task.id)
    await getDb().update(tasks).set({ projectId: null, updatedAt: new Date() }).where(eq(tasks.id, task.id))
    if (previousProjectId) await syncProjectProgress(previousProjectId)

    await getDb().insert(activityEvents).values({
      companyId: task.companyId,
      actorId: currentUser.id,
      entityType: 'task',
      entityId: task.id,
      action: 'edited',
      summary: `made ${task.title} independent of a project`,
    })

    refreshWorkhub()
    return { ok: true as const, projectId: null, projectTitle: null, milestoneId: null, milestoneTitle: null }
  }

  const visible = await requireVisibleProject(nextProjectId)
  if ('error' in visible) return { error: visible.error }
  nextProjectId = visible.project.id
  nextProjectTitle = visible.project.title

  if (nextMilestoneId) {
    const milestone = await getDb().query.projectMilestones.findFirst({
      where: eq(projectMilestones.id, nextMilestoneId),
    })
    if (!milestone || milestone.projectId !== nextProjectId) return { error: 'Milestone not found.' }
    const placed = await placeTaskOnMilestone(task.id, milestone.id)
    if ('error' in placed) return { error: placed.error }
    nextMilestoneTitle = milestone.title
  } else {
    await clearTaskMilestoneLinks(task.id)
    await getDb().update(tasks).set({ projectId: nextProjectId, updatedAt: new Date() }).where(eq(tasks.id, task.id))
    await syncProjectProgress(nextProjectId)
    if (previousProjectId && previousProjectId !== nextProjectId) {
      await syncProjectProgress(previousProjectId)
    }
  }

  const assignee = task.assigneeId ? await getUserById(task.assigneeId) : null
  if (assignee?.departmentId) {
    const added = await ensureContributingDepartment(nextProjectId, assignee.departmentId)
    if (added.created) await notifyDepartmentJoined(visible.project, assignee.departmentId, currentUser.id)
  }

  const moved = Boolean(previousProjectId && previousProjectId !== nextProjectId)
  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: nextProjectId,
    action: moved ? 'task_moved' : 'task_linked',
    summary: nextMilestoneTitle
      ? `${moved ? 'moved' : 'linked'} ${task.title} to ${nextProjectTitle} · ${nextMilestoneTitle}`
      : `${moved ? 'moved' : 'linked'} ${task.title} to ${nextProjectTitle}`,
  })

  refreshWorkhub()
  return {
    ok: true as const,
    projectId: nextProjectId,
    projectTitle: nextProjectTitle,
    milestoneId: nextMilestoneId,
    milestoneTitle: nextMilestoneTitle,
  }
}

export async function addComment(taskId: string, body: string) {
  const trimmed = body.trim()
  if (!trimmed) return { error: 'Comment cannot be empty.' }

  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canProgressTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to comment on this task.')

  const [comment] = await getDb()
    .insert(taskComments)
    .values({
      taskId,
      userId: currentUser.id,
      body: trimmed,
    })
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: taskId,
    action: 'commented',
    summary: `commented on ${task.title}`,
  })

  refreshWorkhub()
  return {
    ok: true as const,
    comment: {
      ...comment,
      user: {
        initials: currentUser.initials,
        firstName: currentUser.firstName,
        lastName: currentUser.lastName,
        avatarUrl: currentUser.avatarUrl,
        avatarColor: currentUser.avatarColor,
      },
    },
  }
}

export async function deleteComment(commentId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [comment] = await getDb().select().from(taskComments).where(eq(taskComments.id, commentId)).limit(1)
  if (!comment) return { error: 'Comment not found.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, comment.taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (comment.userId !== currentUser.id && !canEditTask(currentUser, await taskAccessFor(task))) {
    return denied('You can only remove your own comments.')
  }

  await getDb().delete(taskComments).where(eq(taskComments.id, commentId))
  refreshWorkhub()
  return { ok: true as const }
}

export async function updateTaskDetails(input: {
  taskId: string
  title: string
  description: string
  assigneeId: string
  priority: (typeof taskPriorityEnum.enumValues)[number]
  category?: (typeof taskCategoryEnum.enumValues)[number]
  categoryCustom?: string | null
  startDate: string | null
  dueDate: string | null
}) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canEditTask(currentUser, await taskAccessFor(task))) {
    return denied('You are not allowed to edit this task.')
  }

  if (input.category === 'other' && !input.categoryCustom?.trim()) {
    return { error: 'Type a custom category, or pick one from the list.' }
  }

  const title = input.title.trim()
  if (!title) return { error: 'Task title is required.' }

  const nextDescription = input.description.trim() || null
  const nextStartDate = input.startDate || null
  const nextDueDate = input.dueDate || null

  const changedAssignment = task.assigneeId !== input.assigneeId
  const nextAssignee = changedAssignment ? await getUserById(input.assigneeId) : null
  const nextDepartmentId =
    changedAssignment && nextAssignee?.departmentId ? nextAssignee.departmentId : task.departmentId
  const changedFields =
    task.title !== title ||
    (task.description ?? null) !== nextDescription ||
    task.priority !== input.priority ||
    (input.category ? task.category !== input.category : false) ||
    (task.startDate ?? null) !== nextStartDate ||
    (task.dueDate ?? null) !== nextDueDate

  await getDb()
    .update(tasks)
    .set({
      title,
      description: nextDescription,
      assigneeId: input.assigneeId,
      departmentId: nextDepartmentId,
      priority: input.priority,
      ...(input.category
        ? {
            category: input.category,
            categoryCustom: input.category === 'other' ? input.categoryCustom || null : null,
          }
        : {}),
      startDate: nextStartDate,
      dueDate: nextDueDate,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, input.taskId))

  if (task.projectId && nextAssignee?.departmentId) {
    const added = await ensureContributingDepartment(task.projectId, nextAssignee.departmentId)
    if (added.created) {
      const [project] = await getDb().select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      if (project) await notifyDepartmentJoined(project, nextAssignee.departmentId, currentUser.id)
    }
  }

  if (changedAssignment) {
    await getDb().insert(activityEvents).values({
      companyId: task.companyId,
      actorId: currentUser.id,
      entityType: 'task',
      entityId: input.taskId,
      action: 'assignment_changed',
      summary: `reassigned ${title}`,
    })
  }

  if (changedFields) {
    await getDb().insert(activityEvents).values({
      companyId: task.companyId,
      actorId: currentUser.id,
      entityType: 'task',
      entityId: input.taskId,
    action: 'edited',
    summary: `updated task details for ${title}`,
  })
  }

  await syncProjectsForTask(input.taskId)
  refreshWorkhub()
  return { ok: true }
}

export async function addAttachment(input: {
  taskId: string
  label: string
  url: string
  publicId?: string | null
  bytes?: number | null
  mimeType?: string | null
  originalName?: string | null
}) {
  const label = input.label.trim()
  const url = input.url.trim()
  if (!label || !url) return { error: 'A file or document link is required.' }
  if (!isSafeAttachmentUrl(url)) return { error: 'Use an https link, or upload a file from this device.' }

  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canProgressTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to attach files to this task.')

  const [attachment] = await getDb()
    .insert(taskAttachments)
    .values({
      taskId: input.taskId,
      userId: currentUser.id,
      label,
      url,
      publicId: input.publicId?.trim() || null,
      bytes: input.bytes ?? null,
      mimeType: input.mimeType?.trim() || null,
      originalName: input.originalName?.trim() || null,
    })
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: input.taskId,
    action: 'attached',
    summary: `attached ${label} to ${task.title}`,
  })

  refreshWorkhub()
  return { ok: true as const, attachment }
}

export async function deleteAttachment(attachmentId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [attachment] = await getDb().select().from(taskAttachments).where(eq(taskAttachments.id, attachmentId)).limit(1)
  if (!attachment) return { error: 'Attachment not found.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, attachment.taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  const mayDelete = attachment.userId === currentUser.id || canEditTask(currentUser, await taskAccessFor(task))
  if (!mayDelete) return denied('You are not allowed to remove this attachment.')

  if (attachment.publicId) {
    try {
      await destroyCloudinaryAsset(attachment.publicId)
    } catch {
      return { error: 'Stored file could not be removed. The attachment was left in place.' }
    }
  }

  await getDb().delete(taskAttachments).where(eq(taskAttachments.id, attachmentId))
  refreshWorkhub()
  return { ok: true as const }
}

function isSafeAttachmentUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return isOurCloudinaryUrl(url) || parsed.hostname.length > 0
  } catch {
    return false
  }
}

export async function updateTaskProgress(taskId: string, progress: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)))
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canProgressTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to update this task.')

  const updates: Record<string, unknown> = { progress: clamped, updatedAt: new Date() }
  if (clamped === 100 && task.status !== 'completed') updates.status = 'completed'
  if (clamped < 100 && task.status === 'completed') updates.status = 'in_progress'
  const shouldRecalculateUnblocked =
    clamped === 100 && task.status !== 'completed'

  await getDb().update(tasks).set(updates).where(eq(tasks.id, taskId))

  if (currentUser) {
    await getDb().insert(activityEvents).values({
      companyId: task.companyId,
      actorId: currentUser.id,
      entityType: 'task',
      entityId: taskId,
      action: 'progress_updated',
      summary: `updated ${task.title} progress to ${clamped}%`,
    })
  }

  if (shouldRecalculateUnblocked) {
    await recalculateUnblockedTasks(taskId, task.companyId, currentUser?.id ?? null)
  }

  await syncProjectsForTask(taskId)
  refreshWorkhub()
  return { ok: true }
}

async function maybeUnblockTask(
  blockedTaskId: string,
  companyId: string,
  actorId: string | null,
  summary: string,
) {
  const [blockedTask] = await getDb().select().from(tasks).where(eq(tasks.id, blockedTaskId)).limit(1)
  if (!blockedTask || blockedTask.status !== 'blocked') return

  const remaining = await getDb()
    .select({ blockingTaskId: taskDependencies.blockingTaskId })
    .from(taskDependencies)
    .where(and(eq(taskDependencies.companyId, companyId), eq(taskDependencies.blockedTaskId, blockedTaskId)))

  let ready = remaining.length === 0
  if (!ready) {
    const blockingTasks = await getDb()
      .select()
      .from(tasks)
      .where(inArray(tasks.id, remaining.map((row) => row.blockingTaskId)))
    ready = blockingTasks.every((task) => task.status === 'completed')
  }
  if (!ready) return

  const newStatus = blockedTask.progress > 0 ? 'in_progress' : 'not_started'
  await getDb()
    .update(tasks)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(tasks.id, blockedTaskId))

  if (actorId) {
    await getDb().insert(activityEvents).values({
      companyId,
      actorId,
      entityType: 'task',
      entityId: blockedTaskId,
      action: 'dependency_satisfied',
      summary,
    })
  }
}

async function recalculateUnblockedTasks(
  completedTaskId: string,
  companyId: string,
  actorId: string | null,
) {
  const dependents = await getDb()
    .select({ blockedTaskId: taskDependencies.blockedTaskId })
    .from(taskDependencies)
    .where(and(eq(taskDependencies.companyId, companyId), eq(taskDependencies.blockingTaskId, completedTaskId)))

  for (const dependent of dependents) {
    const [blockedTask] = await getDb().select().from(tasks).where(eq(tasks.id, dependent.blockedTaskId)).limit(1)
    await maybeUnblockTask(
      dependent.blockedTaskId,
      companyId,
      actorId,
      blockedTask ? `unblocked ${blockedTask.title} after dependency completion` : 'unblocked a waiting task',
    )
  }
}

async function collectTaskMediaPublicIds(taskIds: string[]) {
  if (taskIds.length === 0) return []
  const attachments = await getDb()
    .select({ publicId: taskAttachments.publicId })
    .from(taskAttachments)
    .where(inArray(taskAttachments.taskId, taskIds))
  const evidence = await getDb()
    .select({ publicId: deliverables.evidencePublicId })
    .from(deliverables)
    .where(inArray(deliverables.taskId, taskIds))
  return [...attachments.map((row) => row.publicId), ...evidence.map((row) => row.publicId)]
}

async function purgeTaskMediaThenDelete(taskIds: string[]) {
  const uniqueIds = [...new Set(taskIds.filter(Boolean))]
  if (uniqueIds.length === 0) return { ok: true as const }

  const mediaIds = await collectTaskMediaPublicIds(uniqueIds)
  try {
    await purgeCloudinaryPublicIds(mediaIds)
  } catch {
    return { error: 'Stored files could not be removed. Nothing was deleted.' }
  }

  try {
    await getDb().delete(tasks).where(inArray(tasks.id, uniqueIds))
  } catch {
    return {
      error:
        'Files were removed from storage, but the records could not be deleted. Refresh and try again, or contact an admin.',
    }
  }

  return { ok: true as const }
}

export async function createTaskDependency(blockingTaskId: string, blockedTaskId: string) {
  if (blockingTaskId === blockedTaskId) return { error: 'A task cannot depend on itself.' }

  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [blockingTask] = await getDb().select().from(tasks).where(eq(tasks.id, blockingTaskId)).limit(1)
  const [blockedTask] = await getDb().select().from(tasks).where(eq(tasks.id, blockedTaskId)).limit(1)

  if (!blockingTask || !blockedTask) return { error: 'One or both tasks not found.' }
  if (blockingTask.companyId !== blockedTask.companyId) return { error: 'Tasks must belong to the same workspace.' }
  if (!canEditTask(currentUser, await taskAccessFor(blockingTask)) || !canEditTask(currentUser, await taskAccessFor(blockedTask))) {
    return denied('You are not allowed to set dependencies on these tasks.')
  }

  let inserted: { id: string } | undefined
  try {
    const [row] = await getDb()
      .insert(taskDependencies)
      .values({
        companyId: blockingTask.companyId,
        blockingTaskId,
        blockedTaskId,
      })
      .returning({ id: taskDependencies.id })
    inserted = row
  } catch {
    return { error: 'That dependency already exists.' }
  }

  // If the blocking task isn't completed, mark the blocked task as blocked for visibility.
  if (blockingTask.status !== 'completed' && blockedTask.status !== 'completed' && blockedTask.status !== 'cancelled') {
    await getDb()
      .update(tasks)
      .set({ status: 'blocked', updatedAt: new Date() })
      .where(eq(tasks.id, blockedTaskId))
  }

  await getDb().insert(activityEvents).values({
    companyId: blockingTask.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: blockedTaskId,
    action: 'dependency_created',
    summary: `set dependency: ${blockingTask.title} → ${blockedTask.title}`,
  })

  refreshWorkhub()
  return { ok: true as const, id: inserted?.id ?? null }
}

export async function deleteTaskDependency(dependencyId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [dependency] = await getDb()
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.id, dependencyId))
    .limit(1)
  if (!dependency) return { error: 'Dependency not found.' }

  const [blockingTask] = await getDb().select().from(tasks).where(eq(tasks.id, dependency.blockingTaskId)).limit(1)
  const [blockedTask] = await getDb().select().from(tasks).where(eq(tasks.id, dependency.blockedTaskId)).limit(1)
  if (!blockingTask || !blockedTask) return { error: 'One or both tasks not found.' }
  if (!canEditTask(currentUser, await taskAccessFor(blockingTask)) && !canEditTask(currentUser, await taskAccessFor(blockedTask))) {
    return denied('You are not allowed to remove this dependency.')
  }

  await getDb().delete(taskDependencies).where(eq(taskDependencies.id, dependencyId))
  await maybeUnblockTask(
    blockedTask.id,
    blockedTask.companyId,
    currentUser.id,
    `unblocked ${blockedTask.title} after a dependency was removed`,
  )

  await getDb().insert(activityEvents).values({
    companyId: blockedTask.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: blockedTask.id,
    action: 'dependency_removed',
    summary: `removed dependency: ${blockingTask.title} → ${blockedTask.title}`,
  })

  refreshWorkhub()
  return { ok: true as const }
}

export async function deleteTask(taskId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canDeleteTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to delete this task.')

  const dependents = await getDb()
    .select({ blockedTaskId: taskDependencies.blockedTaskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.blockingTaskId, taskId))
  const linkedProjects = await getDb()
    .select({ projectId: projectMilestones.projectId })
    .from(projectMilestoneTasks)
    .innerJoin(projectMilestones, eq(projectMilestoneTasks.milestoneId, projectMilestones.id))
    .where(eq(projectMilestoneTasks.taskId, taskId))

  const purged = await purgeTaskMediaThenDelete([taskId])
  if ('error' in purged) return purged

  for (const dependent of dependents) {
    await maybeUnblockTask(
      dependent.blockedTaskId,
      task.companyId,
      currentUser.id,
      'unblocked a waiting task after a blocker was deleted',
    )
  }
  for (const projectId of [...new Set(linkedProjects.map((row) => row.projectId))]) {
    await syncProjectProgress(projectId)
  }

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: taskId,
    action: 'deleted',
    summary: `deleted task ${task.title}`,
  })

  refreshWorkhub()
  return { ok: true as const }
}

export async function deleteTasks(taskIds: string[]) {
  const ids = [...new Set(taskIds.map((id) => String(id).trim()).filter(Boolean))]
  if (ids.length === 0) return { error: 'Select at least one task to delete.' }

  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const rows = await getDb().select().from(tasks).where(inArray(tasks.id, ids))
  if (rows.length === 0) return { error: 'No matching tasks found.' }

  const allowed: typeof rows = []
  for (const task of rows) {
    if (canDeleteTask(currentUser, await taskAccessFor(task))) allowed.push(task)
  }
  if (allowed.length === 0) return denied('You are not allowed to delete the selected tasks.')

  const allowedIds = allowed.map((task) => task.id)
  const dependents = await getDb()
    .select({ blockedTaskId: taskDependencies.blockedTaskId, blockingTaskId: taskDependencies.blockingTaskId })
    .from(taskDependencies)
    .where(inArray(taskDependencies.blockingTaskId, allowedIds))
  const linkedProjects = await getDb()
    .select({ projectId: projectMilestones.projectId })
    .from(projectMilestoneTasks)
    .innerJoin(projectMilestones, eq(projectMilestoneTasks.milestoneId, projectMilestones.id))
    .where(inArray(projectMilestoneTasks.taskId, allowedIds))

  const purged = await purgeTaskMediaThenDelete(allowedIds)
  if ('error' in purged) return purged

  for (const dependent of dependents) {
    const blocker = allowed.find((task) => task.id === dependent.blockingTaskId)
    if (!blocker) continue
    await maybeUnblockTask(
      dependent.blockedTaskId,
      blocker.companyId,
      currentUser.id,
      'unblocked a waiting task after a blocker was deleted',
    )
  }
  for (const projectId of [...new Set(linkedProjects.map((row) => row.projectId))]) {
    await syncProjectProgress(projectId)
  }

  await getDb().insert(activityEvents).values({
    companyId: allowed[0]!.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: allowedIds[0]!,
    action: 'deleted',
    summary: `deleted ${allowedIds.length} task${allowedIds.length === 1 ? '' : 's'}`,
  })

  refreshWorkhub()
  return { ok: true as const, deletedCount: allowedIds.length }
}

export async function createTaskReport(formData: FormData) {
  const taskId = String(formData.get('taskId') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  const emailToSupervisor = String(formData.get('emailToSupervisor') ?? '') === '1'
  if (!taskId) return { error: 'Task is required.' }
  if (!title) return { error: 'Give the report a title.' }
  if (!body) return { error: 'Write the report before saving.' }

  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  const loaded = await loadTaskAccess(taskId)
  if (!loaded) return { error: 'Task not found.' }
  if (!canProgressTask(currentUser, loaded.access)) {
    return denied('You are not allowed to report on this task.')
  }

  let emailedToUserId: string | null = null
  let emailedAt: Date | null = null
  if (emailToSupervisor) {
    emailedToUserId = currentUser.managerId ?? null
    if (!emailedToUserId && currentUser.departmentId) {
      const [dept] = await getDb().select().from(departments).where(eq(departments.id, currentUser.departmentId)).limit(1)
      emailedToUserId = dept?.ownerId ?? null
    }
    if (!emailedToUserId) {
      return { error: 'No supervisor is set on your profile. Ask leadership to set Reports to, then try again.' }
    }
  }

  const [report] = await getDb()
    .insert(taskReports)
    .values({
      taskId,
      authorId: currentUser.id,
      title,
      body,
      emailedToUserId,
      emailedAt: emailToSupervisor ? new Date() : null,
    })
    .returning()

  if (emailToSupervisor && emailedToUserId) {
    const recipient = await getUserById(emailedToUserId)
    const company = await getCompany()
    if (recipient?.email) {
      try {
        const { sendMail, getPublicAppUrl } = await import('@/lib/mail/send')
        const { taskReportEmail } = await import('@/lib/mail/templates')
        const message = taskReportEmail({
          recipientFirstName: recipient.firstName,
          authorName: fullName(currentUser),
          taskTitle: loaded.task.title,
          reportTitle: title,
          reportBody: body,
          taskUrl: `${getPublicAppUrl()}/?view=My%20tasks&task=${taskId}`,
          companyName: company?.name ?? 'Globecon Convergence Solutions',
        })
        await sendMail({ to: recipient.email, ...message })
        emailedAt = new Date()
        await getDb().update(taskReports).set({ emailedAt }).where(eq(taskReports.id, report.id))
        await getDb().insert(notifications).values({
          companyId: loaded.task.companyId,
          userId: emailedToUserId,
          type: 'reminder',
          title: 'Task report shared with you',
          body: `${currentUser.firstName} ${currentUser.lastName} sent a report on “${loaded.task.title}”.`,
          entityType: 'task',
          entityId: taskId,
        })
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? `Report saved, but email failed: ${error.message}`
              : 'Report saved, but email could not be sent.',
          reportId: report.id,
        }
      }
    }
  }

  await getDb().insert(activityEvents).values({
    companyId: loaded.task.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: taskId,
    action: 'reported',
    summary: `filed report “${title}” on ${loaded.task.title}`,
  })

  refreshWorkhub()
  return { ok: true as const, reportId: report.id, emailed: Boolean(emailedAt) }
}

export async function deleteProject(projectId: string, options?: { deleteLinkedTasks?: boolean }) {
  const loaded = await requireManageableProject(projectId)
  if ('error' in loaded) return loaded
  const { currentUser, project } = loaded

  const milestones = await getDb()
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
  const milestoneIds = milestones.map((row) => row.id)
  const milestoneTaskIds =
    milestoneIds.length === 0
      ? []
      : (
          await getDb()
            .select({ taskId: projectMilestoneTasks.taskId })
            .from(projectMilestoneTasks)
            .where(inArray(projectMilestoneTasks.milestoneId, milestoneIds))
        ).map((row) => row.taskId)
  const projectTaskIds = (
    await getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId))
  ).map((row) => row.id)
  const linkedTaskIds = [...new Set([...milestoneTaskIds, ...projectTaskIds])]

  const deleteLinkedTasks = Boolean(options?.deleteLinkedTasks) && linkedTaskIds.length > 0
  if (deleteLinkedTasks) {
    const dependents = await getDb()
      .select({ blockedTaskId: taskDependencies.blockedTaskId, blockingTaskId: taskDependencies.blockingTaskId })
      .from(taskDependencies)
      .where(inArray(taskDependencies.blockingTaskId, linkedTaskIds))
    const outsideDependents = [
      ...new Set(
        dependents
          .filter((row) => !linkedTaskIds.includes(row.blockedTaskId))
          .map((row) => row.blockedTaskId),
      ),
    ]

    const purged = await purgeTaskMediaThenDelete(linkedTaskIds)
    if ('error' in purged) return purged

    for (const blockedTaskId of outsideDependents) {
      await maybeUnblockTask(
        blockedTaskId,
        project.companyId,
        currentUser.id,
        'unblocked a waiting task after linked project work was deleted',
      )
    }
  }

  try {
    await getDb().delete(projects).where(eq(projects.id, projectId))
  } catch {
    return {
      error: deleteLinkedTasks
        ? 'Linked files and tasks were removed, but the project record could not be deleted. Refresh and try again.'
        : 'The project could not be deleted. Refresh and try again.',
    }
  }

  await getDb().insert(activityEvents).values({
    companyId: project.companyId,
    actorId: currentUser.id,
    entityType: 'project',
    entityId: projectId,
    action: 'deleted',
    summary: deleteLinkedTasks
      ? `deleted project ${project.title} and ${linkedTaskIds.length} linked ${linkedTaskIds.length === 1 ? 'task' : 'tasks'}`
      : `deleted project ${project.title}`,
  })

  refreshWorkhub()
  return { ok: true as const, deletedTaskIds: deleteLinkedTasks ? linkedTaskIds : [] }
}

async function getTaskApproverForDepartment(departmentId: string | null) {
  if (!departmentId) return null
  const [dept] = await getDb().select().from(departments).where(eq(departments.id, departmentId)).limit(1)
  return dept?.ownerId ?? null
}

async function canDecideApproval(userId: string) {
  const privileged = await getDb()
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))

  return privileged.some((r) => r.key === 'admin' || r.key === 'managing_director')
}

async function requestTaskApproval(taskId: string, requesterId: string) {
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }

  const [open] = await getDb()
    .select()
    .from(taskApprovals)
    .where(and(eq(taskApprovals.taskId, taskId), eq(taskApprovals.status, 'requested')))
    .limit(1)
  if (open) return { ok: true }

  const approverId = await getTaskApproverForDepartment(task.departmentId)
  const resolvedApproverId = approverId ?? requesterId

  await getDb().insert(taskApprovals).values({
    companyId: task.companyId,
    taskId,
    requestorId: requesterId,
    approverId: resolvedApproverId,
    status: 'requested',
  })

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: requesterId,
    entityType: 'task',
    entityId: taskId,
    action: 'approval_requested',
    summary: `requested approval for ${task.title}`,
  })

  return { ok: true }
}

export async function approveTask(taskId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [approval] = await getDb()
    .select()
    .from(taskApprovals)
    .where(and(eq(taskApprovals.taskId, taskId), eq(taskApprovals.status, 'requested')))
    .orderBy(desc(taskApprovals.createdAt))
    .limit(1)

  if (!approval) return { error: 'No pending approval found for this task.' }

  const allowed = approval.approverId === currentUser.id || (await canDecideApproval(currentUser.id))
  if (!allowed) return { error: 'You are not allowed to approve this request.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canSeeTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to approve this request.')

  await getDb()
    .update(taskApprovals)
    .set({ status: 'approved', decidedAt: new Date(), decisionReason: null })
    .where(eq(taskApprovals.id, approval.id))

  const newStatus = task.progress >= 100 ? 'completed' : 'in_progress'
  await getDb().update(tasks).set({ status: newStatus, updatedAt: new Date() }).where(eq(tasks.id, taskId))

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: taskId,
    action: 'approved',
    summary: `approved ${task.title}`,
  })

  await syncProjectsForTask(taskId)
  refreshWorkhub()
  return { ok: true }
}

export async function rejectTask(taskId: string, reason: string) {
  const trimmed = reason.trim()
  if (!trimmed) return { error: 'Rejection reason is required.' }

  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [approval] = await getDb()
    .select()
    .from(taskApprovals)
    .where(and(eq(taskApprovals.taskId, taskId), eq(taskApprovals.status, 'requested')))
    .orderBy(desc(taskApprovals.createdAt))
    .limit(1)

  if (!approval) return { error: 'No pending approval found for this task.' }

  const allowed = approval.approverId === currentUser.id || (await canDecideApproval(currentUser.id))
  if (!allowed) return { error: 'You are not allowed to reject this request.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }

  await getDb()
    .update(taskApprovals)
    .set({ status: 'rejected', decidedAt: new Date(), decisionReason: trimmed })
    .where(eq(taskApprovals.id, approval.id))

  await getDb()
    .update(tasks)
    .set({ status: 'blocked', updatedAt: new Date() })
    .where(eq(tasks.id, taskId))

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: taskId,
    action: 'rejected',
    summary: `rejected ${task.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function requestTaskRevision(taskId: string, reason: string) {
  const trimmed = reason.trim()
  if (!trimmed) return { error: 'Revision reason is required.' }

  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [approval] = await getDb()
    .select()
    .from(taskApprovals)
    .where(and(eq(taskApprovals.taskId, taskId), eq(taskApprovals.status, 'requested')))
    .orderBy(desc(taskApprovals.createdAt))
    .limit(1)

  if (!approval) return { error: 'No pending approval found for this task.' }

  const allowed = approval.approverId === currentUser.id || (await canDecideApproval(currentUser.id))
  if (!allowed) return { error: 'You are not allowed to request revisions.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }

  await getDb()
    .update(taskApprovals)
    .set({ status: 'revision_requested', decidedAt: new Date(), decisionReason: trimmed })
    .where(eq(taskApprovals.id, approval.id))

  await getDb()
    .update(tasks)
    .set({ status: 'waiting', updatedAt: new Date() })
    .where(eq(tasks.id, taskId))

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'task',
    entityId: taskId,
    action: 'revision_requested',
    summary: `requested revision for ${task.title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function createDeliverable(taskId: string, title: string, description: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const trimmedTitle = title.trim()
  if (!trimmedTitle) return { error: 'Deliverable title is required.' }

  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canProgressTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to add deliverables to this task.')

  const [deliverable] = await getDb().insert(deliverables).values({
    companyId: task.companyId,
    taskId,
    title: trimmedTitle,
    description: description.trim() || null,
    status: 'draft',
  }).returning()

  await getDb().insert(activityEvents).values({
    companyId: task.companyId,
    actorId: currentUser.id,
    entityType: 'deliverable',
    entityId: deliverable.id,
    action: 'created',
    summary: `created deliverable ${trimmedTitle}`,
  })

  refreshWorkhub()
  return { ok: true, deliverable }
}

export async function submitDeliverable(
  deliverableId: string,
  evidenceUrl: string,
  notes: string,
  evidence?: {
    publicId?: string | null
    bytes?: number | null
    mimeType?: string | null
    originalName?: string | null
  },
) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const trimmedEvidenceUrl = evidenceUrl.trim()
  if (!trimmedEvidenceUrl) return { error: 'Upload evidence or paste an https link before submitting.' }
  if (!isSafeAttachmentUrl(trimmedEvidenceUrl)) {
    return { error: 'Evidence must be an uploaded file or an https link.' }
  }

  const [deliverable] = await getDb()
    .select()
    .from(deliverables)
    .where(eq(deliverables.id, deliverableId))
    .limit(1)

  if (!deliverable) return { error: 'Deliverable not found.' }
  const [taskForSubmit] = await getDb().select().from(tasks).where(eq(tasks.id, deliverable.taskId)).limit(1)
  if (!taskForSubmit || !canProgressTask(currentUser, await taskAccessFor(taskForSubmit))) {
    return denied('You are not allowed to submit this deliverable.')
  }

  const [updated] = await getDb()
    .update(deliverables)
    .set({
      status: 'submitted',
      evidenceUrl: trimmedEvidenceUrl,
      evidencePublicId: evidence?.publicId?.trim() || null,
      evidenceBytes: evidence?.bytes ?? null,
      evidenceMimeType: evidence?.mimeType?.trim() || null,
      evidenceOriginalName: evidence?.originalName?.trim() || null,
      submissionNotes: notes.trim() || null,
      submittedById: currentUser.id,
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliverables.id, deliverableId))
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: deliverable.companyId,
    actorId: currentUser.id,
    entityType: 'deliverable',
    entityId: deliverableId,
    action: 'submitted',
    summary: `submitted deliverable ${deliverable.title}`,
  })

  refreshWorkhub()
  return { ok: true, deliverable: updated }
}

async function getDeliverableTaskAndDepartment(deliverableId: string) {
  return getDb()
    .select({
      deliverable: deliverables,
      task: tasks,
      departmentOwnerId: departments.ownerId,
    })
    .from(deliverables)
    .innerJoin(tasks, eq(tasks.id, deliverables.taskId))
    .leftJoin(departments, eq(departments.id, tasks.departmentId))
    .where(eq(deliverables.id, deliverableId))
    .limit(1)
}

export async function verifyDeliverable(deliverableId: string, reason: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const trimmedReason = reason.trim() || null

  const [row] = await getDeliverableTaskAndDepartment(deliverableId)
  if (!row) return { error: 'Deliverable not found.' }

  const allowed =
    (await canDecideApproval(currentUser.id)) ||
    (row.departmentOwnerId ? row.departmentOwnerId === currentUser.id : false)

  if (!allowed) return { error: 'You are not allowed to verify this deliverable.' }

  const [updated] = await getDb()
    .update(deliverables)
    .set({
      status: 'verified',
      decisionReason: trimmedReason,
      verifiedById: currentUser.id,
      verifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliverables.id, deliverableId))
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: row.deliverable.companyId,
    actorId: currentUser.id,
    entityType: 'deliverable',
    entityId: deliverableId,
    action: 'verified',
    summary: `verified deliverable ${row.deliverable.title}`,
  })

  refreshWorkhub()
  return { ok: true, deliverable: updated }
}

export async function approveDeliverable(deliverableId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  if (!(await canDecideApproval(currentUser.id))) return { error: 'Only management can approve deliverables.' }

  const [row] = await getDb()
    .select({ deliverable: deliverables })
    .from(deliverables)
    .where(eq(deliverables.id, deliverableId))
    .limit(1)

  if (!row) return { error: 'Deliverable not found.' }

  const [updated] = await getDb()
    .update(deliverables)
    .set({
      status: 'approved',
      approvedById: currentUser.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliverables.id, deliverableId))
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: row.deliverable.companyId,
    actorId: currentUser.id,
    entityType: 'deliverable',
    entityId: deliverableId,
    action: 'approved',
    summary: `approved deliverable ${row.deliverable.title}`,
  })

  refreshWorkhub()
  return { ok: true, deliverable: updated }
}

export async function rejectDeliverable(deliverableId: string, reason: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const trimmedReason = reason.trim()
  if (!trimmedReason) return { error: 'Rejection reason is required.' }

  const [row] = await getDeliverableTaskAndDepartment(deliverableId)
  if (!row) return { error: 'Deliverable not found.' }

  const allowed =
    (await canDecideApproval(currentUser.id)) ||
    (row.departmentOwnerId ? row.departmentOwnerId === currentUser.id : false)

  if (!allowed) return { error: 'You are not allowed to reject this deliverable.' }

  const [updated] = await getDb()
    .update(deliverables)
    .set({
      status: 'rejected',
      decisionReason: trimmedReason,
      rejectedById: currentUser.id,
      rejectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deliverables.id, deliverableId))
    .returning()

  await getDb().insert(activityEvents).values({
    companyId: row.deliverable.companyId,
    actorId: currentUser.id,
    entityType: 'deliverable',
    entityId: deliverableId,
    action: 'rejected',
    summary: `rejected deliverable ${row.deliverable.title}`,
  })

  refreshWorkhub()
  return { ok: true, deliverable: updated }
}

export async function toggleUserStatus(userId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const target = await getUserById(userId)
  if (!target) return { error: 'User not found.' }

  const adminRole = await getDb().select().from(roles).where(eq(roles.key, 'admin')).limit(1)
  const adminIds =
    adminRole[0]
      ? await getDb().select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, adminRole[0].id))
      : []
  if (!canDeactivateUser(currentUser, target, adminIds.length)) {
    return denied('You are not allowed to change this person’s status.')
  }

  const newStatus =
    target.status === 'active' || target.status === 'invited' ? 'inactive' : 'active'
  if (newStatus === 'active' && !target.passwordHash) {
    return { error: 'This person has not set a password yet. Resend their invite instead.' }
  }
  await getDb()
    .update(users)
    .set({
      status: newStatus,
      ...(target.status === 'invited' ? { mustChangePassword: false } : {}),
    })
    .where(eq(users.id, userId))
  if (newStatus === 'inactive') {
    await revokeAuthSessions(userId)
  }

  const company = await getCompany()
  if (company) {
    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: currentUser.id,
      entityType: 'user',
      entityId: userId,
      action: newStatus === 'active' ? 'activated' : 'deactivated',
      summary: `${newStatus === 'active' ? 'activated' : 'deactivated'} ${target.firstName} ${target.lastName}`,
    })
  }

  refreshWorkhub()
  return { ok: true, status: newStatus }
}

export async function completeTask(taskId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canProgressTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to complete this task.')
  const shouldRecalculateUnblocked = task.status !== 'completed'

  await getDb()
    .update(tasks)
    .set({ status: 'completed', progress: 100, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))

  if (currentUser) {
    await getDb().insert(activityEvents).values({
      companyId: task.companyId,
      actorId: currentUser.id,
      entityType: 'task',
      entityId: task.id,
      action: 'completed',
      summary: `completed ${task.title}`,
    })
  }

  if (shouldRecalculateUnblocked) {
    await recalculateUnblockedTasks(taskId, task.companyId, currentUser?.id ?? null)
  }

  await syncProjectsForTask(taskId)
  refreshWorkhub()
  return { ok: true }
}

export async function updateTaskStatus(
  taskId: string,
  status: (typeof taskStatusEnum.enumValues)[number],
) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return { error: 'Task not found.' }
  if (!canProgressTask(currentUser, await taskAccessFor(task))) return denied('You are not allowed to change this task status.')
  const shouldRecalculateUnblocked = status === 'completed' && task.status !== 'completed'
  const shouldRequestApproval = status === 'pending_approval'

  await getDb()
    .update(tasks)
    .set({
      status,
      progress: status === 'completed' ? 100 : task.progress,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))

  if (currentUser) {
    await getDb().insert(activityEvents).values({
      companyId: task.companyId,
      actorId: currentUser.id,
      entityType: 'task',
      entityId: task.id,
      action: 'status_changed',
      summary: `moved ${task.title} to ${statusLabel(status)}`,
    })
  }

  if (currentUser && shouldRequestApproval) {
    await requestTaskApproval(taskId, currentUser.id)
  }

  if (shouldRecalculateUnblocked) {
    await recalculateUnblockedTasks(taskId, task.companyId, currentUser?.id ?? null)
  }

  await syncProjectsForTask(taskId)
  refreshWorkhub()
  return { ok: true }
}

export async function markNotificationRead(notificationId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [notification] = await getDb()
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, currentUser.id)))
    .limit(1)

  if (!notification) return { error: 'Notification not found.' }

  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.id, notificationId))

  refreshWorkhub()
  return { ok: true }
}

export async function markAllNotificationsRead() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, currentUser.id), isNull(notifications.readAt)))

  refreshWorkhub()
  return { ok: true }
}

export async function updateNotificationPreferences(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const values = {
    deadlineAlerts: formData.get('deadlineAlerts') === 'on' ? 1 : 0,
    escalationAlerts: formData.get('escalationAlerts') === 'on' ? 1 : 0,
    approvalAlerts: formData.get('approvalAlerts') === 'on' ? 1 : 0,
    managementRequestAlerts: formData.get('managementRequestAlerts') === 'on' ? 1 : 0,
    dailySummary: formData.get('dailySummary') === 'on' ? 1 : 0,
    updatedAt: new Date(),
  }

  await getDb()
    .insert(notificationPreferences)
    .values({ userId: currentUser.id, ...values })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: values,
    })

  refreshWorkhub()
  return { ok: true }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function updateOwnProfile(input: {
  firstName: string
  lastName: string
  jobTitle: string
  email: string
  avatarColor: string
}) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  const jobTitle = input.jobTitle.trim()
  const email = input.email.trim().toLowerCase()
  const avatarColor = AVATAR_COLORS.includes(input.avatarColor as (typeof AVATAR_COLORS)[number])
    ? input.avatarColor
    : currentUser.avatarColor

  if (!firstName || !lastName) return { error: 'First and last name are required.' }
  if (!jobTitle) return { error: 'A job title is required.' }
  if (!EMAIL_PATTERN.test(email)) return { error: 'Enter a valid work email.' }

  if (email !== currentUser.email) {
    const taken = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, currentUser.id)))
      .limit(1)
    if (taken.length > 0) return { error: 'That email is already used in this workspace.' }

    const authTaken = await getDb()
      .select({ id: authUser.id })
      .from(authUser)
      .where(and(eq(authUser.email, email), ne(authUser.id, currentUser.id)))
      .limit(1)
    if (authTaken.length > 0) return { error: 'That email is already used in this workspace.' }
  }

  const initials = makeInitials(firstName, lastName)
  await getDb()
    .update(users)
    .set({ firstName, lastName, jobTitle, email, initials, avatarColor })
    .where(eq(users.id, currentUser.id))

  await getDb()
    .update(authUser)
    .set({ name: `${firstName} ${lastName}`, email, updatedAt: new Date() })
    .where(eq(authUser.id, currentUser.id))

  await getDb().insert(activityEvents).values({
    companyId: currentUser.companyId,
    actorId: currentUser.id,
    entityType: 'user',
    entityId: currentUser.id,
    action: 'profile_updated',
    summary: 'updated their profile',
  })

  refreshWorkhub()
  return { ok: true as const, initials }
}

export async function changeOwnPassword(input: {
  currentPassword: string
  nextPassword: string
  confirmPassword: string
}) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const currentPassword = input.currentPassword
  const nextPassword = input.nextPassword
  const confirmPassword = input.confirmPassword
  if (!currentPassword || !nextPassword) return { error: 'Enter your current and new password.' }
  if (nextPassword.length < 8) return { error: 'New password must be at least 8 characters.' }
  if (nextPassword !== confirmPassword) return { error: 'New password and confirmation do not match.' }
  if (!currentUser.passwordHash) return { error: `This account cannot change a password from ${PRODUCT_NAME}.` }

  const matches = await bcrypt.compare(currentPassword, currentUser.passwordHash)
  if (!matches) return { error: 'Current password is incorrect.' }
  const same = await bcrypt.compare(nextPassword, currentUser.passwordHash)
  if (same) return { error: 'Choose a password that is different from the current one.' }

  const passwordHash = await bcrypt.hash(nextPassword, 10)
  await getDb()
    .update(users)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(users.id, currentUser.id))
  await provisionAuthIdentity({
    userId: currentUser.id,
    email: currentUser.email,
    name: fullName(currentUser),
    passwordHash,
  })

  refreshWorkhub()
  return { ok: true as const }
}

export async function setOwnAvatar(input: { url: string; publicId: string }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const url = input.url.trim()
  const publicId = input.publicId.trim()
  if (!url || !publicId) return { error: 'The photo did not finish uploading.' }
  if (!isOurCloudinaryUrl(url)) return { error: 'That photo is not stored in this workspace.' }

  const previousPublicId = currentUser.avatarPublicId
  try {
    await getDb()
      .update(users)
      .set({ avatarUrl: url, avatarPublicId: publicId })
      .where(eq(users.id, currentUser.id))
    await getDb().update(authUser).set({ image: url, updatedAt: new Date() }).where(eq(authUser.id, currentUser.id))
  } catch {
    try {
      await destroyCloudinaryAsset(publicId)
    } catch {
      // The new file may remain in Cloudinary; the profile was not changed.
    }
    return { error: 'The photo could not be saved. Nothing on your profile changed.' }
  }

  if (previousPublicId && previousPublicId !== publicId) {
    try {
      await destroyCloudinaryAsset(previousPublicId)
    } catch {
      // New photo is live. The previous file may remain in Cloudinary.
    }
  }

  refreshWorkhub()
  return { ok: true as const, avatarUrl: url }
}

export async function removeOwnAvatar() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  if (!currentUser.avatarUrl && !currentUser.avatarPublicId) return { ok: true as const }

  if (currentUser.avatarPublicId) {
    try {
      await destroyCloudinaryAsset(currentUser.avatarPublicId)
    } catch {
      return { error: 'The stored photo could not be removed. Your profile picture was left in place.' }
    }
  }

  await getDb().update(users).set({ avatarUrl: null, avatarPublicId: null }).where(eq(users.id, currentUser.id))
  await getDb().update(authUser).set({ image: null, updatedAt: new Date() }).where(eq(authUser.id, currentUser.id))

  refreshWorkhub()
  return { ok: true as const }
}

export async function createManagementRequest(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { error: 'A request title is required.' }

  const [currentUser, company] = await Promise.all([getCurrentUser(), getCompany()])
  if (!currentUser || !company) return { error: 'Workspace is not ready yet.' }

  const wantsWork = String(formData.get('kind') ?? '') === 'work'
  let kind: (typeof managementRequestKindEnum.enumValues)[number] = 'leadership'
  if (canSubmitWorkRequest(currentUser)) {
    kind = 'work'
  } else if (canSubmitLeadershipRequest(currentUser)) {
    kind = wantsWork ? 'work' : 'leadership'
  } else {
    return denied('You are not allowed to submit this request.')
  }

  const description = String(formData.get('description') ?? '').trim() || null
  let assigneeId = String(formData.get('assigneeId') ?? '') || null
  if (kind === 'work') {
    // Sponsored desks: prefer personal supervisor, then department head.
    assigneeId = currentUser.managerId ?? null
    if (!assigneeId && currentUser.departmentId) {
      const [dept] = await getDb().select().from(departments).where(eq(departments.id, currentUser.departmentId)).limit(1)
      assigneeId = dept?.ownerId ?? null
    }
  }
  const priority = (String(formData.get('priority') || 'medium') ||
    'medium') as (typeof managementRequestPriorityEnum.enumValues)[number]

  const [request] = await getDb()
    .insert(managementRequests)
    .values({
      companyId: company.id,
      requestorId: currentUser.id,
      assigneeId,
      title,
      description,
      kind,
      priority,
      status: 'open',
    })
    .returning()

  if (assigneeId) {
    await getDb().insert(notifications).values({
      companyId: company.id,
      userId: assigneeId,
      type: 'management_request',
      title: kind === 'work' ? 'New work request' : 'New management request',
      body:
        kind === 'work'
          ? `${currentUser.firstName} ${currentUser.lastName} asked for help with “${title}”.`
          : `${currentUser.firstName} ${currentUser.lastName} submitted "${title}".`,
      entityType: 'management_request',
      entityId: request.id,
    })
  }

  await getDb().insert(activityEvents).values({
    companyId: company.id,
    actorId: currentUser.id,
    entityType: 'management_request',
    entityId: request.id,
    action: 'created',
    summary: `submitted management request ${title}`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function updateManagementRequestStatus(
  requestId: string,
  status: (typeof managementRequestStatusEnum.enumValues)[number],
  responseNotes?: string,
) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const [request] = await getDb()
    .select()
    .from(managementRequests)
    .where(eq(managementRequests.id, requestId))
    .limit(1)

  if (!request) return { error: 'Management request not found.' }

  const requestor = await getUserById(request.requestorId)
  const canUpdate =
    isManagement(currentUser) ||
    request.assigneeId === currentUser.id ||
    request.requestorId === currentUser.id ||
    Boolean(
      isDepartmentLeader(currentUser) &&
        currentUser.departmentId &&
        requestor?.departmentId === currentUser.departmentId,
    )

  if (!canUpdate) return { error: 'You are not allowed to update this request.' }

  await getDb()
    .update(managementRequests)
    .set({
      status,
      responseNotes: responseNotes?.trim() || request.responseNotes,
      respondedAt: ['resolved', 'cancelled'].includes(status) ? new Date() : request.respondedAt,
      updatedAt: new Date(),
    })
    .where(eq(managementRequests.id, requestId))

  if (request.requestorId !== currentUser.id) {
    await getDb().insert(notifications).values({
      companyId: request.companyId,
      userId: request.requestorId,
      type: 'management_request',
      title: 'Management request updated',
      body: `Your request "${request.title}" is now ${status.replaceAll('_', ' ')}.`,
      entityType: 'management_request',
      entityId: request.id,
    })
  }

  refreshWorkhub()
  return { ok: true }
}

export async function sendWorkspaceReminder(input: { userId: string; message: string; taskId?: string }) {
  const currentUser = await getCurrentUser()
  const company = await getCompany()
  if (!currentUser || !company) return { error: 'Workspace is not ready yet.' }
  if (!isManagement(currentUser) && !canCreateWork(currentUser)) {
    return denied('You are not allowed to send reminders.')
  }

  const message = input.message.trim()
  if (!message) return { error: 'Reminder message is required.' }

  await getDb().insert(notifications).values({
    companyId: company.id,
    userId: input.userId,
    type: 'reminder',
    title: `${PRODUCT_NAME} reminder`,
    body: message,
    entityType: input.taskId ? 'task' : 'user',
    entityId: input.taskId ?? null,
  })

  await getDb().insert(activityEvents).values({
    companyId: company.id,
    actorId: currentUser.id,
    entityType: 'notification',
    entityId: null,
    action: 'reminder_sent',
    summary: `sent a reminder to a team member`,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function exportReportCsv() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  if (!canViewCompanyReports(currentUser) && !canViewDepartmentReports(currentUser)) {
    return denied('You are not allowed to export this report.')
  }
  const scopedTasks = await listTasks({ viewer: currentUser })
  const csv = tasksToCsv(scopedTasks)
  const scope = canViewCompanyReports(currentUser) ? 'company' : 'department'
  return { ok: true as const, csv, filename: `gcs-workhub-${scope}-${new Date().toISOString().slice(0, 10)}.csv` }
}

export async function promoteWorkRequest(requestId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  if (!canCreateWork(currentUser)) return denied('You are not allowed to turn this into a task.')

  const [request] = await getDb().select().from(managementRequests).where(eq(managementRequests.id, requestId)).limit(1)
  if (!request) return { error: 'Request not found.' }
  if (request.kind !== 'work') return { error: 'Only work requests can be promoted to tasks.' }
  if (request.status === 'resolved' || request.status === 'cancelled') {
    return { error: 'This request is already closed.' }
  }

  const requestor = await getUserById(request.requestorId)
  if (
    !isManagement(currentUser) &&
    request.assigneeId !== currentUser.id &&
    !(isDepartmentLeader(currentUser) && currentUser.departmentId && requestor?.departmentId === currentUser.departmentId)
  ) {
    return denied('You are not allowed to promote this request.')
  }

  const formData = new FormData()
  formData.set('title', request.title)
  formData.set('description', request.description ?? '')
  formData.set('assigneeId', request.requestorId)
  formData.set('priority', request.priority === 'urgent' ? 'high' : request.priority)
  formData.set('category', 'operational')
  if (requestor?.departmentId) formData.set('departmentId', requestor.departmentId)
  const created = await createTask(formData)
  if (created && 'error' in created && created.error) return created

  await getDb()
    .update(managementRequests)
    .set({ status: 'resolved', responseNotes: 'Promoted to a task.', respondedAt: new Date(), updatedAt: new Date() })
    .where(eq(managementRequests.id, requestId))

  await getDb().insert(notifications).values({
    companyId: request.companyId,
    userId: request.requestorId,
    type: 'management_request',
    title: 'Work request accepted',
    body: `"${request.title}" is now a task on your list.`,
    entityType: 'management_request',
    entityId: request.id,
  })

  refreshWorkhub()
  return { ok: true }
}

export async function createDepartment(formData: FormData) {
  const currentUser = await getCurrentUser()
  const company = await getCompany()
  if (!currentUser || !company) return { error: 'Workspace is not ready yet.' }
  if (!canManageOrg(currentUser)) return denied('Only an admin can change company structure.')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Department name is required.' }
  const color = String(formData.get('color') ?? 'teal').trim() || 'teal'
  const ownerId = String(formData.get('ownerId') ?? '') || null
  let slug = slugify(String(formData.get('slug') ?? name))
  if (!slug) slug = `dept-${Date.now().toString(36)}`

  const existing = await getDb()
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.companyId, company.id), eq(departments.slug, slug)))
    .limit(1)
  if (existing[0]) {
    return { error: 'A department with a similar name already exists.' }
  }

  const [created] = await getDb()
    .insert(departments)
    .values({ companyId: company.id, name, slug, color, ownerId })
    .returning()

  await getDb().insert(teams).values({ departmentId: created.id, name: `${name} Desk` })

  if (ownerId) {
    const owner = await getUserById(ownerId)
    if (owner) {
      await getDb()
        .update(users)
        .set({ departmentId: created.id })
        .where(eq(users.id, ownerId))
      const ownerKeys = owner.roles?.map((entry) => entry.role.key) ?? []
      const keepRole =
        ownerKeys.includes('admin') ||
        ownerKeys.includes('managing_director') ||
        ownerKeys.includes('department_head')
      if (!keepRole) {
        const [headRole] = await getDb().select().from(roles).where(eq(roles.key, 'department_head')).limit(1)
        if (headRole) {
          await getDb().delete(userRoles).where(eq(userRoles.userId, ownerId))
          await getDb().insert(userRoles).values({ userId: ownerId, roleId: headRole.id })
        }
      }
    }
  }

  await getDb().insert(activityEvents).values({
    companyId: company.id,
    actorId: currentUser.id,
    entityType: 'department',
    entityId: created.id,
    action: 'created',
    summary: `created department ${name}`,
  })
  refreshWorkhub()
  return { ok: true as const, departmentId: created.id }
}

export async function updateDepartment(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  if (!canManageOrg(currentUser)) return denied('Only an admin can change company structure.')

  const departmentId = String(formData.get('departmentId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!departmentId || !name) return { error: 'Department and name are required.' }
  const color = String(formData.get('color') ?? 'teal').trim() || 'teal'
  const ownerId = String(formData.get('ownerId') ?? '') || null

  await getDb()
    .update(departments)
    .set({ name, color, ownerId, slug: slugify(name) })
    .where(eq(departments.id, departmentId))
  refreshWorkhub()
  return { ok: true }
}

export async function createTeam(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  if (!canManageOrg(currentUser)) return denied('Only an admin can change company structure.')

  const name = String(formData.get('name') ?? '').trim()
  const departmentId = String(formData.get('departmentId') ?? '')
  if (!name || !departmentId) return { error: 'Team name and department are required.' }

  const [created] = await getDb().insert(teams).values({ name, departmentId }).returning()
  const company = await getCompany()
  if (company) {
    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: currentUser.id,
      entityType: 'team',
      entityId: created.id,
      action: 'created',
      summary: `created team ${name}`,
    })
  }
  refreshWorkhub()
  return { ok: true }
}

export async function updateTeam(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  if (!canManageOrg(currentUser)) return denied('Only an admin can change company structure.')
  const teamId = String(formData.get('teamId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!teamId || !name) return { error: 'Team and name are required.' }
  await getDb().update(teams).set({ name }).where(eq(teams.id, teamId))
  refreshWorkhub()
  return { ok: true }
}

export async function updateUserPlacement(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const userId = String(formData.get('userId') ?? '')
  if (!userId) return { error: 'Choose a person.' }
  const target = await getUserById(userId)
  if (!target) return { error: 'Person not found.' }
  if (!canEditPerson(currentUser, target)) return denied('You are not allowed to edit this person.')

  const departmentId = String(formData.get('departmentId') ?? '') || null
  const teamId = String(formData.get('teamId') ?? '') || null
  const managerId = String(formData.get('managerId') ?? '') || null
  const roleKey = String(formData.get('roleKey') ?? '').trim()

  if (managerId === userId) return { error: 'A person cannot report to themselves.' }

  await getDb()
    .update(users)
    .set({ departmentId, teamId, managerId })
    .where(eq(users.id, userId))

  if (roleKey) {
    if (!canInvite(currentUser, { roleKey, departmentId })) {
      return denied('You cannot grant that role.')
    }
    const [role] = await getDb().select().from(roles).where(eq(roles.key, roleKey)).limit(1)
    if (!role) return { error: 'Choose a valid role.' }
    if ((roleKey === 'department_head' || roleKey === 'manager') && !departmentId) {
      return { error: 'Department heads and managers need a department.' }
    }
    const targetIsAdmin = Boolean(target.roles?.some((entry) => entry.role.key === 'admin'))
    if (targetIsAdmin && roleKey !== 'admin') {
      const adminRole = await getDb().select().from(roles).where(eq(roles.key, 'admin')).limit(1)
      const adminIds =
        adminRole[0]
          ? await getDb().select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, adminRole[0].id))
          : []
      if (adminIds.length <= 1) {
        return { error: 'You cannot remove the last workspace admin role.' }
      }
    }
    await getDb().delete(userRoles).where(eq(userRoles.userId, userId))
    await getDb().insert(userRoles).values({ userId, roleId: role.id })
  }

  refreshWorkhub()
  return { ok: true }
}

