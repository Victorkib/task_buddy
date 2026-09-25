import {
  canAssignDepartmentWork,
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
  inviteableRoleKeys,
  isDepartmentMemberCreator,
  type Actor,
} from './permissions'
import {
  canSelfCreateTask,
  isSponsoredContributor,
  requiresSponsor,
  sponsoredDeskLabel,
} from './sponsored'

function actor(id: string, role: string, departmentId: string | null = 'dept-1'): NonNullable<Actor> {
  return {
    id,
    departmentId,
    roles: [{ role: { key: role } }],
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

const admin = actor('admin', 'admin', null)
const md = actor('md', 'managing_director', null)
const head = actor('head', 'department_head', 'dept-1')
const manager = actor('mgr', 'manager', 'dept-1')
const employee = actor('emp', 'employee', 'dept-1')
const volunteer = actor('vol', 'volunteer', 'dept-vol')
const otherEmployee = actor('emp-2', 'employee', 'dept-2')
const otherHead = actor('head-2', 'department_head', 'dept-2')
const ownTask = { assigneeId: 'emp', createdById: 'emp', departmentId: 'dept-1' }
const assignedByLead = { assigneeId: 'emp', createdById: 'head', departmentId: 'dept-1' }
const deptTask = { assigneeId: 'emp-2', createdById: 'head', departmentId: 'dept-1' }
const otherDeptTask = { assigneeId: 'emp-2', createdById: 'head-2', departmentId: 'dept-2' }
const collabTask = {
  assigneeId: 'emp-2',
  departmentId: 'dept-2',
  assigneeDepartmentId: 'dept-2',
  projectId: 'proj-1',
  projectHomeDepartmentId: 'dept-1',
  contributingDepartmentIds: ['dept-2'],
}
const homeProject = { ownerId: 'head', departmentId: 'dept-1', contributingDepartmentIds: ['dept-2'] }
const contributingProject = {
  ownerId: 'head',
  departmentId: 'dept-1',
  contributingDepartmentIds: ['dept-2'],
  teamUserIds: ['emp-2'],
}

assert(canManageOrg(admin) && !canManageOrg(md), 'only admin manages org')
assert(canViewCompanyReports(md) && !canViewCompanyReports(head), 'company reports are management-only')
assert(canViewDepartmentReports(head) && canViewDepartmentReports(manager), 'leaders get department reports')
assert(!canViewDepartmentReports(employee), 'employees do not get department reports')

assert(canSeeTask(employee, ownTask) && !canSeeTask(employee, deptTask), 'employee sees own tasks only')
assert(canSeeTask(head, deptTask) && !canSeeTask(head, otherDeptTask), 'head is department-scoped')
assert(canSeeTask(md, otherDeptTask), 'md sees all tasks')

assert(!canProgressTask(employee, otherDeptTask), 'employee cannot progress unseen tasks')
assert(canProgressTask(employee, ownTask), 'employee can progress own tasks')
assert(canEditTask(manager, deptTask), 'manager can edit department tasks')
assert(!canEditTask(manager, otherDeptTask), 'manager cannot edit other departments')
assert(canEditTask(employee, ownTask) && !canEditTask(employee, deptTask), 'employee edits own details only')
assert(canDeleteTask(employee, ownTask) && !canDeleteTask(employee, deptTask), 'employee deletes own-created tasks only')
assert(!canDeleteTask(employee, assignedByLead), 'employee cannot delete lead-assigned work')
assert(canDeleteTask(head, deptTask) && !canDeleteTask(head, otherDeptTask), 'head deletes department tasks only')
assert(canAssignDepartmentWork(head) && canAssignDepartmentWork(manager) && canAssignDepartmentWork(md), 'leaders assign department work')
assert(!canAssignDepartmentWork(employee) && !canAssignDepartmentWork(volunteer), 'ICs cannot assign colleagues')

assert(canSeeTask(head, collabTask), 'home department head sees contributing work on their project')
assert(canEditTask(head, collabTask), 'home department head can edit contributing tasks on their project')
assert(canSeeTask(otherHead, collabTask), 'contributing head sees their slice')
assert(canEditTask(otherHead, collabTask), 'contributing head can edit their slice')
assert(
  !canSeeTask(otherHead, {
    ...collabTask,
    assigneeId: 'emp',
    departmentId: 'dept-1',
    assigneeDepartmentId: 'dept-1',
  }),
  'contributing head does not see home-department tasks',
)
assert(canSeeProject(otherHead, contributingProject), 'contributing head can see the project')
assert(!canManageProject(otherHead, contributingProject), 'contributing head cannot reconfigure the project')
assert(canManageProject(head, homeProject), 'home department head manages the project')
assert(canSeeProject(otherEmployee, contributingProject), 'teammate can see the project')

assert(canInvite(md, { roleKey: 'employee', departmentId: 'dept-1' }), 'md can invite staff')
assert(!canInvite(md, { roleKey: 'admin', departmentId: null }), 'md cannot invite admin')
assert(canInvite(head, { roleKey: 'employee', departmentId: 'dept-1' }), 'head can invite into own dept')
assert(!canInvite(head, { roleKey: 'employee', departmentId: 'dept-2' }), 'head cannot invite other depts')
assert(!canInvite(manager, { roleKey: 'employee', departmentId: 'dept-1' }), 'manager cannot invite')
assert(inviteableRoleKeys(admin).includes('admin'), 'admin can grant admin')
assert(inviteableRoleKeys(admin).includes('volunteer'), 'admin can grant volunteer')
assert(canInvite(md, { roleKey: 'volunteer', departmentId: 'dept-1' }), 'md can invite volunteer')
assert(canInvite(head, { roleKey: 'volunteer', departmentId: 'dept-1' }), 'head can invite volunteer into own dept')
assert(!canInvite(head, { roleKey: 'volunteer', departmentId: 'dept-2' }), 'head cannot invite volunteer other depts')

assert(canSubmitLeadershipRequest(head) && !canSubmitLeadershipRequest(employee), 'leadership requests')
assert(canSubmitWorkRequest(volunteer) && !canSubmitWorkRequest(head), 'volunteers request work')
assert(!canSubmitWorkRequest(employee), 'employees create work directly now')

assert(canSelfCreateTask(volunteer) && !canSelfCreateTask(employee), 'volunteers self-create; employees use full create')
assert(canCreateWork(employee) && !canCreateWork(volunteer), 'employees create department work')
assert(isDepartmentMemberCreator(employee) && !isDepartmentMemberCreator(head), 'employee is department member creator')
assert(!canSelfCreateTask(head) && !canSelfCreateTask(admin), 'leaders use full create, not self-create')
assert(isSponsoredContributor(volunteer), 'volunteer role is sponsored')
assert(
  isSponsoredContributor({
    ...employee,
    department: { id: 'dept-int', slug: 'interns', name: 'Interns' },
  }),
  'interns department is sponsored',
)
assert(
  !isSponsoredContributor({
    ...employee,
    department: { id: 'dept-1', slug: 'operations', name: 'Ops' },
  }),
  'ops employee is not sponsored by dept alone',
)
assert(requiresSponsor({ roleKey: 'volunteer' }), 'volunteer requires sponsor')
assert(requiresSponsor({ departmentSlug: 'attachees' }), 'attachees require sponsor')
assert(!requiresSponsor({ roleKey: 'employee', departmentSlug: 'operations' }), 'ops employee no sponsor required')
assert(sponsoredDeskLabel({ roleKey: 'volunteer' }) === 'Volunteer', 'volunteer desk label')
assert(sponsoredDeskLabel({ departmentSlug: 'interns' }) === 'Intern', 'intern desk label')

assert(!canDeactivateUser(md, admin, 1), 'md cannot deactivate admin')
assert(!canDeactivateUser(admin, admin, 1), 'cannot deactivate self')
assert(!canDeactivateUser(admin, actor('a2', 'admin', null), 1), 'cannot deactivate last admin')
assert(canDeactivateUser(admin, actor('a2', 'admin', null), 2), 'can deactivate extra admin')
assert(canDeactivateUser(md, employee, 1), 'md can deactivate employees')

assert(canEditPerson(admin, employee), 'admin can edit employees')
assert(canEditPerson(admin, md), 'admin can edit md')
assert(!canEditPerson(md, admin), 'md cannot edit admin')
assert(canEditPerson(md, employee), 'md can edit employees')
assert(!canEditPerson(employee, employee), 'employees cannot edit people')
assert(!canEditPerson(head, employee), 'department head cannot edit people access')

console.log('permissions tests passed')
