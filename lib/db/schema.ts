import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'invited'])
export const userInvitePurposeEnum = pgEnum('user_invite_purpose', ['setup', 'password_reset'])
export const taskStatusEnum = pgEnum('task_status', [
  'not_started',
  'in_progress',
  'waiting',
  'blocked',
  'pending_approval',
  'completed',
  'cancelled',
])
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'medium', 'high'])
export const taskCategoryEnum = pgEnum('task_category', [
  'operational',
  'technical',
  'administrative',
  'marketing',
  'finance',
  'business_development',
  'support',
  'project',
  'other',
])
export const responsibilityStatusEnum = pgEnum('responsibility_status', [
  'active',
  'paused',
  'completed',
])

export const projectStatusEnum = pgEnum('project_status', ['active', 'paused', 'completed', 'archived'])

export const projectDepartmentRoleEnum = pgEnum('project_department_role', ['home', 'contributing'])

export const projectMilestoneStatusEnum = pgEnum('project_milestone_status', [
  'planned',
  'active',
  'completed',
])

export const notificationTypeEnum = pgEnum('notification_type', [
  'deadline_7d',
  'deadline_3d',
  'deadline_1d',
  'deadline_today',
  'overdue',
  'escalation_department',
  'escalation_management',
  'approval_request',
  'approval_decision',
  'management_request',
  'daily_summary',
  'weekly_summary',
  'monthly_summary',
  'reminder',
  'system',
])

export const managementRequestKindEnum = pgEnum('management_request_kind', ['leadership', 'work'])

export const managementRequestStatusEnum = pgEnum('management_request_status', [
  'open',
  'in_progress',
  'resolved',
  'cancelled',
])

export const managementRequestPriorityEnum = pgEnum('management_request_priority', [
  'low',
  'medium',
  'high',
  'urgent',
])

export const companies = pgTable('companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  tagline: text('tagline'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull().default('teal'),
    ownerId: uuid('owner_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('departments_company_slug_idx').on(table.companyId, table.slug),
    index('departments_owner_idx').on(table.ownerId),
  ],
)

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('teams_department_idx').on(table.departmentId)],
)

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    rank: integer('rank').notNull().default(0),
  },
)

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    managerId: uuid('manager_id'),
    email: text('email').notNull().unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    jobTitle: text('job_title').notNull(),
    passwordHash: text('password_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    initials: text('initials').notNull(),
    avatarColor: text('avatar_color').notNull().default('teal'),
    avatarUrl: text('avatar_url'),
    avatarPublicId: text('avatar_public_id'),
    status: userStatusEnum('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('users_department_idx').on(table.departmentId),
    index('users_manager_idx').on(table.managerId),
  ],
)

export const userInvites = pgTable(
  'user_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    invitedById: uuid('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    purpose: userInvitePurposeEnum('purpose').notNull().default('setup'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_invites_token_hash_uidx').on(table.tokenHash),
    index('user_invites_user_idx').on(table.userId),
    index('user_invites_expires_idx').on(table.expiresAt),
  ],
)

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('user_roles_pk').on(table.userId, table.roleId)],
)

export const responsibilities = pgTable(
  'responsibilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category').notNull().default('operational'),
    status: responsibilityStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('responsibilities_owner_idx').on(table.ownerId),
    index('responsibilities_department_idx').on(table.departmentId),
  ],
)

export const responsibilityAssignees = pgTable(
  'responsibility_assignees',
  {
    responsibilityId: uuid('responsibility_id')
      .notNull()
      .references(() => responsibilities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('responsibility_assignees_pk').on(table.responsibilityId, table.userId)],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    category: taskCategoryEnum('category').notNull().default('operational'),
    categoryCustom: text('category_custom'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    status: taskStatusEnum('status').notNull().default('not_started'),
    progress: integer('progress').notNull().default(0),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('tasks_assignee_idx').on(table.assigneeId),
    index('tasks_department_idx').on(table.departmentId),
    index('tasks_project_idx').on(table.projectId),
    index('tasks_status_idx').on(table.status),
    index('tasks_due_date_idx').on(table.dueDate),
  ],
)

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('task_comments_task_idx').on(table.taskId)],
)

export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    url: text('url').notNull(),
    publicId: text('public_id'),
    bytes: integer('bytes'),
    mimeType: text('mime_type'),
    originalName: text('original_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('task_attachments_task_idx').on(table.taskId)],
)

export const taskReports = pgTable(
  'task_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    emailedToUserId: uuid('emailed_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('task_reports_task_idx').on(table.taskId),
    index('task_reports_author_idx').on(table.authorId),
  ],
)

export const taskApprovalStatusEnum = pgEnum('task_approval_status', [
  'requested',
  'approved',
  'rejected',
  'revision_requested',
])

export const taskApprovals = pgTable(
  'task_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    requestorId: uuid('requestor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    approverId: uuid('approver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: taskApprovalStatusEnum('status').notNull().default('requested'),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    index('task_approvals_task_idx').on(table.taskId),
    index('task_approvals_approver_idx').on(table.approverId),
  ],
)

export const deliverableStatusEnum = pgEnum('deliverable_status', [
  'draft',
  'submitted',
  'verified',
  'approved',
  'rejected',
])

export const deliverables = pgTable(
  'deliverables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: deliverableStatusEnum('status').notNull().default('draft'),
    evidenceUrl: text('evidence_url'),
    evidencePublicId: text('evidence_public_id'),
    evidenceBytes: integer('evidence_bytes'),
    evidenceMimeType: text('evidence_mime_type'),
    evidenceOriginalName: text('evidence_original_name'),
    submissionNotes: text('submission_notes'),
    submittedById: uuid('submitted_by_id').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    verifiedById: uuid('verified_by_id').references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    approvedById: uuid('approved_by_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedById: uuid('rejected_by_id').references(() => users.id, { onDelete: 'set null' }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('deliverables_task_idx').on(table.taskId),
    index('deliverables_status_idx').on(table.status),
  ],
)

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    blockingTaskId: uuid('blocking_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    blockedTaskId: uuid('blocked_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('task_dependencies_pk').on(table.blockingTaskId, table.blockedTaskId),
    index('task_dependencies_blocked_idx').on(table.blockedTaskId),
    index('task_dependencies_blocking_idx').on(table.blockingTaskId),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notifications_user_idx').on(table.userId),
    index('notifications_user_read_idx').on(table.userId, table.readAt),
    index('notifications_created_idx').on(table.createdAt),
  ],
)

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  deadlineAlerts: integer('deadline_alerts').notNull().default(1),
  escalationAlerts: integer('escalation_alerts').notNull().default(1),
  approvalAlerts: integer('approval_alerts').notNull().default(1),
  managementRequestAlerts: integer('management_request_alerts').notNull().default(1),
  dailySummary: integer('daily_summary').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const deadlineAlertLog = pgTable(
  'deadline_alert_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    alertType: notificationTypeEnum('alert_type').notNull(),
    alertDate: date('alert_date').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('deadline_alert_log_user_idx').on(table.userId),
    index('deadline_alert_log_date_idx').on(table.alertDate),
  ],
)

export const managementRequests = pgTable(
  'management_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    requestorId: uuid('requestor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    priority: managementRequestPriorityEnum('priority').notNull().default('medium'),
    kind: managementRequestKindEnum('kind').notNull().default('leadership'),
    status: managementRequestStatusEnum('status').notNull().default('open'),
    responseNotes: text('response_notes'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('management_requests_status_idx').on(table.status),
    index('management_requests_assignee_idx').on(table.assigneeId),
    index('management_requests_requestor_idx').on(table.requestorId),
  ],
)

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('activity_events_company_idx').on(table.companyId),
    index('activity_events_created_idx').on(table.createdAt),
  ],
)

export const companiesRelations = relations(companies, ({ many }) => ({
  departments: many(departments),
  users: many(users),
  tasks: many(tasks),
  responsibilities: many(responsibilities),
  activityEvents: many(activityEvents),
}))

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  company: one(companies, { fields: [departments.companyId], references: [companies.id] }),
  owner: one(users, { fields: [departments.ownerId], references: [users.id] }),
  teams: many(teams),
  users: many(users),
  tasks: many(tasks),
  responsibilities: many(responsibilities),
  projects: many(projects),
}))

export const teamsRelations = relations(teams, ({ one, many }) => ({
  department: one(departments, { fields: [teams.departmentId], references: [departments.id] }),
  users: many(users),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
  manager: one(users, { fields: [users.managerId], references: [users.id], relationName: 'reports' }),
  reports: many(users, { relationName: 'reports' }),
  assignedTasks: many(tasks, { relationName: 'assignee' }),
  ownedResponsibilities: many(responsibilities),
  roles: many(userRoles),
  notifications: many(notifications),
  notificationPreferences: one(notificationPreferences, {
    fields: [users.id],
    references: [notificationPreferences.userId],
  }),
  managementRequestsCreated: many(managementRequests, { relationName: 'requestor' }),
  managementRequestsAssigned: many(managementRequests, { relationName: 'assignee' }),
  invites: many(userInvites, { relationName: 'invitee' }),
}))

export const userInvitesRelations = relations(userInvites, ({ one }) => ({
  user: one(users, {
    fields: [userInvites.userId],
    references: [users.id],
    relationName: 'invitee',
  }),
  invitedBy: one(users, {
    fields: [userInvites.invitedById],
    references: [users.id],
    relationName: 'inviter',
  }),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(userRoles),
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}))

export const responsibilitiesRelations = relations(responsibilities, ({ one, many }) => ({
  company: one(companies, { fields: [responsibilities.companyId], references: [companies.id] }),
  department: one(departments, { fields: [responsibilities.departmentId], references: [departments.id] }),
  owner: one(users, { fields: [responsibilities.ownerId], references: [users.id] }),
  assignees: many(responsibilityAssignees),
}))

export const responsibilityAssigneesRelations = relations(responsibilityAssignees, ({ one }) => ({
  responsibility: one(responsibilities, {
    fields: [responsibilityAssignees.responsibilityId],
    references: [responsibilities.id],
  }),
  user: one(users, { fields: [responsibilityAssignees.userId], references: [users.id] }),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  company: one(companies, { fields: [tasks.companyId], references: [companies.id] }),
  department: one(departments, { fields: [tasks.departmentId], references: [departments.id] }),
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id], relationName: 'assignee' }),
  createdBy: one(users, { fields: [tasks.createdById], references: [users.id], relationName: 'createdBy' }),
  comments: many(taskComments),
  attachments: many(taskAttachments),
  reports: many(taskReports),
  approvals: many(taskApprovals),
  deliverables: many(deliverables),
  milestoneLinks: many(projectMilestoneTasks),
  blockingDependencies: many(taskDependencies, { relationName: 'blockingDependencies' }),
  blockedByDependencies: many(taskDependencies, { relationName: 'blockedByDependencies' }),
}))

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id').references(() => users.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: projectStatusEnum('status').notNull().default('active'),
    progress: integer('progress').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('projects_owner_idx').on(table.ownerId),
    index('projects_partner_idx').on(table.partnerId),
    index('projects_company_idx').on(table.companyId),
    index('projects_department_idx').on(table.departmentId),
  ],
)

export const projectTeams = pgTable(
  'project_teams',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('project_teams_pk').on(table.projectId, table.userId)],
)

export const projectDepartments = pgTable(
  'project_departments',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    role: projectDepartmentRoleEnum('role').notNull().default('contributing'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('project_departments_pk').on(table.projectId, table.departmentId),
    index('project_departments_department_idx').on(table.departmentId),
  ],
)

export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: projectMilestoneStatusEnum('status').notNull().default('planned'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    progress: integer('progress').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('project_milestones_project_idx').on(table.projectId),
    index('project_milestones_due_idx').on(table.dueDate),
  ],
)

export const projectMilestoneTasks = pgTable(
  'project_milestone_tasks',
  {
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => projectMilestones.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('project_milestone_tasks_pk').on(table.milestoneId, table.taskId),
    index('project_milestone_tasks_task_idx').on(table.taskId),
  ],
)

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id], relationName: 'projectOwner' }),
  partner: one(users, { fields: [projects.partnerId], references: [users.id], relationName: 'projectPartner' }),
  department: one(departments, { fields: [projects.departmentId], references: [departments.id] }),
  teams: many(projectTeams),
  projectDepartments: many(projectDepartments),
  milestones: many(projectMilestones),
  tasks: many(tasks),
}))

export const projectTeamsRelations = relations(projectTeams, ({ one }) => ({
  project: one(projects, { fields: [projectTeams.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectTeams.userId], references: [users.id] }),
}))

export const projectDepartmentsRelations = relations(projectDepartments, ({ one }) => ({
  project: one(projects, { fields: [projectDepartments.projectId], references: [projects.id] }),
  department: one(departments, { fields: [projectDepartments.departmentId], references: [departments.id] }),
}))

export const projectMilestonesRelations = relations(projectMilestones, ({ one, many }) => ({
  project: one(projects, { fields: [projectMilestones.projectId], references: [projects.id] }),
  milestoneTasks: many(projectMilestoneTasks),
}))

export const projectMilestoneTasksRelations = relations(projectMilestoneTasks, ({ one }) => ({
  milestone: one(projectMilestones, { fields: [projectMilestoneTasks.milestoneId], references: [projectMilestones.id] }),
  task: one(tasks, { fields: [projectMilestoneTasks.taskId], references: [tasks.id] }),
}))

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskComments.userId], references: [users.id] }),
}))

export const taskAttachmentsRelations = relations(taskAttachments, ({ one }) => ({
  task: one(tasks, { fields: [taskAttachments.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskAttachments.userId], references: [users.id] }),
}))

export const taskReportsRelations = relations(taskReports, ({ one }) => ({
  task: one(tasks, { fields: [taskReports.taskId], references: [tasks.id] }),
  author: one(users, { fields: [taskReports.authorId], references: [users.id], relationName: 'taskReportAuthor' }),
  emailedTo: one(users, {
    fields: [taskReports.emailedToUserId],
    references: [users.id],
    relationName: 'taskReportRecipient',
  }),
}))

export const taskApprovalsRelations = relations(taskApprovals, ({ one }) => ({
  company: one(companies, { fields: [taskApprovals.companyId], references: [companies.id] }),
  task: one(tasks, { fields: [taskApprovals.taskId], references: [tasks.id] }),
  requestor: one(users, { fields: [taskApprovals.requestorId], references: [users.id], relationName: 'requestor' }),
  approver: one(users, { fields: [taskApprovals.approverId], references: [users.id], relationName: 'approver' }),
}))

export const deliverablesRelations = relations(deliverables, ({ one }) => ({
  company: one(companies, { fields: [deliverables.companyId], references: [companies.id] }),
  task: one(tasks, { fields: [deliverables.taskId], references: [tasks.id] }),
  submittedBy: one(users, { fields: [deliverables.submittedById], references: [users.id], relationName: 'deliverableSubmittedBy' }),
  verifiedBy: one(users, { fields: [deliverables.verifiedById], references: [users.id], relationName: 'deliverableVerifiedBy' }),
  approvedBy: one(users, { fields: [deliverables.approvedById], references: [users.id], relationName: 'deliverableApprovedBy' }),
  rejectedBy: one(users, { fields: [deliverables.rejectedById], references: [users.id], relationName: 'deliverableRejectedBy' }),
}))

export const taskDependenciesRelations = relations(taskDependencies, ({ one }) => ({
  company: one(companies, { fields: [taskDependencies.companyId], references: [companies.id] }),
  blockingTask: one(tasks, {
    fields: [taskDependencies.blockingTaskId],
    references: [tasks.id],
    relationName: 'blockingDependencies',
  }),
  blockedTask: one(tasks, {
    fields: [taskDependencies.blockedTaskId],
    references: [tasks.id],
    relationName: 'blockedByDependencies',
  }),
}))

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
  company: one(companies, { fields: [activityEvents.companyId], references: [companies.id] }),
  actor: one(users, { fields: [activityEvents.actorId], references: [users.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  company: one(companies, { fields: [notifications.companyId], references: [companies.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}))

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, { fields: [notificationPreferences.userId], references: [users.id] }),
}))

export const deadlineAlertLogRelations = relations(deadlineAlertLog, ({ one }) => ({
  company: one(companies, { fields: [deadlineAlertLog.companyId], references: [companies.id] }),
  user: one(users, { fields: [deadlineAlertLog.userId], references: [users.id] }),
  task: one(tasks, { fields: [deadlineAlertLog.taskId], references: [tasks.id] }),
}))

export const managementRequestsRelations = relations(managementRequests, ({ one }) => ({
  company: one(companies, { fields: [managementRequests.companyId], references: [companies.id] }),
  requestor: one(users, {
    fields: [managementRequests.requestorId],
    references: [users.id],
    relationName: 'requestor',
  }),
  assignee: one(users, {
    fields: [managementRequests.assigneeId],
    references: [users.id],
    relationName: 'assignee',
  }),
}))

/** Better Auth identity tables. WorkHub `users` stays the org/people record. IDs match. */
export const authUser = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const authSession = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

export const authAccount = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_issuer_account_id_uidx').on(table.issuer, table.accountId),
  ],
)

export const authVerification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
