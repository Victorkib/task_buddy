export type RoleKey =
  | 'admin'
  | 'managing_director'
  | 'department_head'
  | 'manager'
  | 'employee'
  | 'volunteer'

export type Actor = {
  id: string
  departmentId?: string | null
  managerId?: string | null
  department?: { id?: string; slug?: string; name?: string } | null
  roles?: { role: { key: string } }[]
} | null

export function getRoleKeys(user: Actor) {
  return user?.roles?.map((entry) => entry.role.key) ?? []
}

export function hasRole(user: Actor, roleKeys: string[]) {
  const keys = new Set(getRoleKeys(user))
  return roleKeys.some((key) => keys.has(key))
}

export function isAdmin(user: Actor) {
  return hasRole(user, ['admin'])
}

export function isManagingDirector(user: Actor) {
  return hasRole(user, ['managing_director'])
}

export function isManagement(user: Actor) {
  return hasRole(user, ['admin', 'managing_director'])
}

export function isDepartmentHead(user: Actor) {
  return hasRole(user, ['department_head']) && Boolean(user?.departmentId)
}

export function isManager(user: Actor) {
  return hasRole(user, ['manager']) && Boolean(user?.departmentId)
}

export function isDepartmentLeader(user: Actor) {
  return isDepartmentHead(user) || isManager(user)
}

export function isVolunteer(user: Actor) {
  return hasRole(user, ['volunteer'])
}

/** Staff desks that own assigned work but do not create company structure. */
export function isIndividualContributor(user: Actor) {
  return hasRole(user, ['employee', 'volunteer'])
}

export function canManageOrg(user: Actor) {
  return isAdmin(user)
}

export function canManageUsers(user: Actor) {
  return isManagement(user)
}

export function canCreateWork(user: Actor) {
  return hasRole(user, ['admin', 'managing_director', 'department_head', 'manager', 'employee'])
}

/** Full company-wide create (projects across depts, org structure work). */
export function canCreateCompanyWork(user: Actor) {
  return hasRole(user, ['admin', 'managing_director', 'department_head', 'manager'])
}

/** Assign work onto colleagues — leaders and management only, not ICs. */
export function canAssignDepartmentWork(user: Actor) {
  return isManagement(user) || isDepartmentLeader(user)
}

export function canCreateProjects(user: Actor) {
  return canCreateWork(user)
}

/** Employees may create work only inside their own department. */
export function isDepartmentMemberCreator(user: Actor) {
  return hasRole(user, ['employee']) && Boolean(user?.departmentId) && !canCreateCompanyWork(user)
}

export function canViewCompanyReports(user: Actor) {
  return isManagement(user)
}

export function canViewDepartmentReports(user: Actor) {
  return isDepartmentLeader(user)
}

export function canSubmitLeadershipRequest(user: Actor) {
  return isManagement(user) || isDepartmentLeader(user)
}

export function canSubmitWorkRequest(user: Actor) {
  return Boolean(user) && !canCreateWork(user)
}

export function inviteableRoleKeys(user: Actor): RoleKey[] {
  if (!user) return []
  if (isAdmin(user)) {
    return ['admin', 'managing_director', 'department_head', 'manager', 'employee', 'volunteer']
  }
  if (isManagingDirector(user)) return ['department_head', 'manager', 'employee', 'volunteer']
  if (isDepartmentHead(user)) return ['manager', 'employee', 'volunteer']
  return []
}

export function canInvite(
  user: Actor,
  input: { roleKey: string; departmentId?: string | null },
) {
  const allowed = inviteableRoleKeys(user)
  if (!allowed.includes(input.roleKey as RoleKey)) return false
  if (isAdmin(user) || isManagingDirector(user)) return true
  if (isDepartmentHead(user)) {
    return Boolean(user?.departmentId) && input.departmentId === user?.departmentId
  }
  return false
}

export type TaskAccess = {
  assigneeId?: string | null
  createdById?: string | null
  departmentId?: string | null
  projectId?: string | null
  assigneeDepartmentId?: string | null
  projectHomeDepartmentId?: string | null
  projectOwnerId?: string | null
  projectTeamUserIds?: string[]
  contributingDepartmentIds?: string[]
}

export type ProjectAccess = {
  ownerId: string
  departmentId?: string | null
  teamUserIds?: string[]
  contributingDepartmentIds?: string[]
}

function isOwnDepartmentSlice(user: Actor, task: TaskAccess) {
  if (!user?.departmentId) return false
  return task.departmentId === user.departmentId || task.assigneeDepartmentId === user.departmentId
}

function isHomeDepartmentOfTaskProject(user: Actor, task: TaskAccess) {
  return Boolean(user?.departmentId && task.projectHomeDepartmentId === user.departmentId)
}

function isContributingDepartmentOnTask(user: Actor, task: TaskAccess) {
  return Boolean(user?.departmentId && task.contributingDepartmentIds?.includes(user.departmentId))
}

export function canSeeTask(user: Actor, task: TaskAccess) {
  if (!user) return false
  if (isManagement(user)) return true
  if (task.assigneeId === user.id) return true
  if (isDepartmentLeader(user) && isOwnDepartmentSlice(user, task)) return true
  if (isDepartmentLeader(user) && isHomeDepartmentOfTaskProject(user, task)) return true
  if (isDepartmentLeader(user) && isContributingDepartmentOnTask(user, task) && isOwnDepartmentSlice(user, task)) {
    return true
  }
  return false
}

export function canProgressTask(user: Actor, task: TaskAccess) {
  return canSeeTask(user, task)
}

export function canEditTask(user: Actor, task: TaskAccess) {
  if (!user) return false
  if (isManagement(user)) return true
  if (task.assigneeId === user.id) return true
  if (isDepartmentLeader(user) && isOwnDepartmentSlice(user, task)) return true
  if (isDepartmentLeader(user) && isHomeDepartmentOfTaskProject(user, task)) return true
  return false
}

export function canDeleteTask(user: Actor, task: TaskAccess) {
  if (!user) return false
  if (isManagement(user) || isDepartmentLeader(user)) return canEditTask(user, task)
  // Individual contributors may remove work they originated — not lead-assigned work.
  if (task.createdById && task.createdById !== user.id) return false
  if (task.assigneeId !== user.id) return false
  return true
}

export function canEditTaskActor(user: Actor, task: TaskAccess) {
  return canEditTask(user, task)
}

export function canSeeProject(user: Actor & { id?: string } | null, project: ProjectAccess) {
  if (!user) return false
  if (isManagement(user)) return true
  if (project.ownerId === user.id) return true
  if (user.id && project.teamUserIds?.includes(user.id)) return true
  if (isDepartmentLeader(user) && user.departmentId && project.departmentId === user.departmentId) return true
  if (isDepartmentLeader(user) && user.departmentId && project.contributingDepartmentIds?.includes(user.departmentId)) {
    return true
  }
  return false
}

export function canManageProject(user: Actor & { id: string } | null, project: ProjectAccess) {
  if (!user) return false
  if (isManagement(user)) return true
  if (project.ownerId === user.id) return true
  if (isDepartmentLeader(user) && user.departmentId && project.departmentId === user.departmentId) {
    return true
  }
  return false
}

export function canChangeResponsibilityOwner(
  user: Actor,
  responsibility: { ownerId: string; departmentId?: string | null },
) {
  if (!user) return false
  if (isManagement(user)) return true
  if (isDepartmentLeader(user) && user.departmentId && responsibility.departmentId === user.departmentId) {
    return true
  }
  return responsibility.ownerId === user.id
}

export function canDeactivateUser(actor: Actor, target: Actor, remainingAdminCount: number) {
  if (!actor || !target) return false
  if (actor.id === target.id) return false
  if (!canManageUsers(actor)) return false
  if (isAdmin(target) && !isAdmin(actor)) return false
  if (isAdmin(target) && remainingAdminCount <= 1) return false
  return true
}

/** Who may edit another person's profile, placement, and primary role. */
export function canEditPerson(actor: Actor, target: Actor) {
  if (!actor || !target) return false
  if (!canManageUsers(actor)) return false
  if (isAdmin(target) && !isAdmin(actor)) return false
  return true
}

export function assignableRoleKeys(actor: Actor): RoleKey[] {
  return inviteableRoleKeys(actor)
}

export function denied(message = 'You are not allowed to do that.') {
  return { error: message }
}
