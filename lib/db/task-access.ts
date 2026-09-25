import { and, eq } from 'drizzle-orm'
import type { TaskAccess } from '@/lib/auth/permissions'
import { getDb } from '@/lib/db'
import { projectDepartments, projects, tasks } from '@/lib/db/schema'

type ProjectBits = {
  ownerId: string
  departmentId?: string | null
  teams?: Array<{ userId: string }>
  projectDepartments?: Array<{ departmentId: string; role: string }>
}

export function taskAccessFromRow(task: {
  assigneeId?: string | null
  createdById?: string | null
  departmentId?: string | null
  projectId?: string | null
  assignee?: { departmentId?: string | null } | null
  project?: ProjectBits | null
}): TaskAccess {
  const contributingDepartmentIds =
    task.project?.projectDepartments
      ?.filter((entry) => entry.role === 'contributing')
      .map((entry) => entry.departmentId) ?? []

  return {
    assigneeId: task.assigneeId,
    createdById: task.createdById ?? null,
    departmentId: task.departmentId,
    projectId: task.projectId,
    assigneeDepartmentId: task.assignee?.departmentId ?? null,
    projectHomeDepartmentId: task.project?.departmentId ?? null,
    projectOwnerId: task.project?.ownerId ?? null,
    projectTeamUserIds: task.project?.teams?.map((entry) => entry.userId) ?? [],
    contributingDepartmentIds,
  }
}

export function projectAccessFromRow(project: {
  ownerId: string
  departmentId?: string | null
  teams?: Array<{ userId: string }>
  projectDepartments?: Array<{ departmentId: string; role: string }>
}) {
  return {
    ownerId: project.ownerId,
    departmentId: project.departmentId,
    teamUserIds: project.teams?.map((entry) => entry.userId) ?? [],
    contributingDepartmentIds:
      project.projectDepartments
        ?.filter((entry) => entry.role === 'contributing')
        .map((entry) => entry.departmentId) ?? [],
  }
}

export async function loadTaskAccess(taskId: string) {
  const task = await getDb().query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    with: {
      assignee: true,
      project: {
        with: {
          teams: true,
          projectDepartments: true,
        },
      },
    },
  })
  if (!task) return null
  return { task, access: taskAccessFromRow(task) }
}

export async function loadProjectAccess(projectId: string) {
  const project = await getDb().query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: {
      teams: true,
      projectDepartments: true,
    },
  })
  if (!project) return null
  return { project, access: projectAccessFromRow(project) }
}

export async function syncProjectHomeDepartment(projectId: string, departmentId: string) {
  const rows = await getDb()
    .select()
    .from(projectDepartments)
    .where(eq(projectDepartments.projectId, projectId))

  for (const row of rows) {
    if (row.departmentId === departmentId) continue
    if (row.role === 'home') {
      await getDb()
        .update(projectDepartments)
        .set({ role: 'contributing' })
        .where(
          and(
            eq(projectDepartments.projectId, projectId),
            eq(projectDepartments.departmentId, row.departmentId),
          ),
        )
    }
  }

  const home = rows.find((row) => row.departmentId === departmentId)
  if (home) {
    if (home.role !== 'home') {
      await getDb()
        .update(projectDepartments)
        .set({ role: 'home' })
        .where(
          and(
            eq(projectDepartments.projectId, projectId),
            eq(projectDepartments.departmentId, departmentId),
          ),
        )
    }
    return
  }

  await getDb().insert(projectDepartments).values({ projectId, departmentId, role: 'home' })
}

export async function ensureContributingDepartment(projectId: string, departmentId: string | null | undefined) {
  if (!departmentId) return { created: false }
  const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return { created: false }
  if (project.departmentId === departmentId) return { created: false }

  const existing = await getDb().query.projectDepartments.findFirst({
    where: and(
      eq(projectDepartments.projectId, projectId),
      eq(projectDepartments.departmentId, departmentId),
    ),
  })
  if (existing) return { created: false }

  await getDb().insert(projectDepartments).values({
    projectId,
    departmentId,
    role: 'contributing',
  })
  return { created: true }
}
