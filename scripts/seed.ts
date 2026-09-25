import { config } from 'dotenv'
import { and, eq, ne, sql } from 'drizzle-orm'
import { neon } from '@neondatabase/serverless'
import bcrypt from 'bcryptjs'
import { drizzle } from 'drizzle-orm/neon-http'
import {
  companies,
  departments,
  managementRequests,
  notificationPreferences,
  notifications,
  roles,
  tasks,
  teams,
  userRoles,
  users,
} from '../lib/db/schema'
import { requireEnv } from '../lib/env'
import { applyPriorityWorkload } from '../lib/workload/apply-priorities'
import { provisionAuthIdentity } from '../lib/auth/provision-user'
import { fullName } from '../lib/format'

config({ path: '.env.local' })
config()

const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED
if (!url) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local or run `npx neon link`.')
}

const db = drizzle({ client: neon(url) })

const STAFF_PASSWORD = requireEnv('SEED_STAFF_PASSWORD')
const ADMIN_EMAIL = requireEnv('SEED_ADMIN_EMAIL')
const ADMIN_PASSWORD = requireEnv('SEED_ADMIN_PASSWORD')
const MD_EMAIL = requireEnv('SEED_MD_EMAIL')

async function roleIdByKey(key: string) {
  const [role] = await db.select().from(roles).where(eq(roles.key, key)).limit(1)
  if (!role) throw new Error(`Role "${key}" is missing. Run seed with --reset once.`)
  return role.id
}

async function setPrimaryRole(userId: string, roleKey: string) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId))
  await db.insert(userRoles).values({ userId, roleId: await roleIdByKey(roleKey) })
}

function printLoginRoster() {
  console.log('')
  console.log('Sign-in roster (roles match the permission kernel)')
  console.log(`  Admin (org, people, grant any role)  ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`)
  console.log(`  MD (company cockpit, no org CRUD)    ${MD_EMAIL}  /  ${STAFF_PASSWORD}`)
  console.log(`  Department heads / staff             work emails  /  ${STAFF_PASSWORD}`)
  console.log(`  Volunteer (Martha)                   martha@globeconcs.com  /  Workhub123!`)
}

async function syncPrivilegedAccounts() {
  const [company] = await db.select().from(companies).limit(1)
  if (!company) return false

  const [mdDepartment] = await db.select().from(departments).where(eq(departments.slug, 'md')).limit(1)
  const [execTeam] = mdDepartment
    ? await db.select().from(teams).where(eq(teams.departmentId, mdDepartment.id)).limit(1)
    : [null]
  const [md] = await db.select().from(users).where(eq(users.email, MD_EMAIL)).limit(1)
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10)

  const [existingAdmin] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1)
  let adminId = existingAdmin?.id
  if (existingAdmin) {
    await db
      .update(users)
      .set({
        firstName: 'Tony',
        lastName: 'Ouh',
        jobTitle: 'Workspace Administrator',
        initials: 'TO',
        avatarColor: 'navy',
        status: 'active',
        passwordHash: adminHash,
        departmentId: mdDepartment?.id ?? existingAdmin.departmentId,
        teamId: execTeam?.id ?? existingAdmin.teamId,
        managerId: md?.id ?? existingAdmin.managerId,
      })
      .where(eq(users.id, existingAdmin.id))
  } else {
    const [created] = await db
      .insert(users)
      .values({
        companyId: company.id,
        departmentId: mdDepartment?.id ?? null,
        teamId: execTeam?.id ?? null,
        managerId: md?.id ?? null,
        email: ADMIN_EMAIL,
        firstName: 'Tony',
        lastName: 'Ouh',
        jobTitle: 'Workspace Administrator',
        passwordHash: adminHash,
        initials: 'TO',
        avatarColor: 'navy',
        status: 'active',
      })
      .returning()
    adminId = created.id
    await db.insert(notificationPreferences).values({ userId: created.id })
  }

  if (!adminId) throw new Error('Admin account could not be created.')
  await setPrimaryRole(adminId, 'admin')

  if (md) {
    await setPrimaryRole(md.id, 'managing_director')
  }

  const allPeople = await db.select().from(users)
  for (const person of allPeople) {
    if (!person.passwordHash) continue
    await provisionAuthIdentity({
      userId: person.id,
      email: person.email,
      name: fullName(person),
      passwordHash: person.passwordHash,
    })
  }

  await ensureVolunteerDesk(company.id)
  return true
}

async function defaultSponsorId(companyId: string, departmentOwnerId?: string | null) {
  if (departmentOwnerId) return departmentOwnerId
  try {
    const mdRoleId = await roleIdByKey('managing_director')
    const [mdLink] = await db.select().from(userRoles).where(eq(userRoles.roleId, mdRoleId)).limit(1)
    if (mdLink) return mdLink.userId
  } catch {
    // role may be missing mid-seed
  }
  try {
    const adminRoleId = await roleIdByKey('admin')
    const [adminLink] = await db.select().from(userRoles).where(eq(userRoles.roleId, adminRoleId)).limit(1)
    if (adminLink) return adminLink.userId
  } catch {
    // role may be missing mid-seed
  }
  const [anyone] = await db
    .select()
    .from(users)
    .where(and(eq(users.companyId, companyId), ne(users.status, 'inactive')))
    .limit(1)
  return anyone?.id ?? null
}

async function ensureVolunteerDesk(companyId: string) {
  const [volunteerRole] = await db.select().from(roles).where(eq(roles.key, 'volunteer')).limit(1)
  let roleId = volunteerRole?.id
  if (!volunteerRole) {
    const [created] = await db
      .insert(roles)
      .values({
        key: 'volunteer',
        name: 'Volunteer',
        description: 'Sponsored contributor desk — can log own tasks; supervisor is notified',
        rank: 15,
      })
      .returning()
    roleId = created.id
  } else {
    await db
      .update(roles)
      .set({
        name: 'Volunteer',
        description: 'Sponsored contributor desk — can log own tasks; supervisor is notified',
        rank: 15,
      })
      .where(eq(roles.id, volunteerRole.id))
  }

  let [volDept] = await db.select().from(departments).where(eq(departments.slug, 'volunteers')).limit(1)
  if (!volDept) {
    const [created] = await db
      .insert(departments)
      .values({ companyId, name: 'Volunteers', slug: 'volunteers', color: 'purple' })
      .returning()
    volDept = created
    await db.insert(teams).values({ departmentId: created.id, name: 'Volunteers Desk' })
  }

  const [desk] = await db.select().from(teams).where(eq(teams.departmentId, volDept.id)).limit(1)
  if (!desk) {
    await db.insert(teams).values({ departmentId: volDept.id, name: 'Volunteers Desk' })
  }

  const marthaEmail = 'martha@globeconcs.com'
  const marthaHash = await bcrypt.hash('Workhub123!', 10)
  const [deskTeam] = await db.select().from(teams).where(eq(teams.departmentId, volDept.id)).limit(1)
  const [martha] = await db.select().from(users).where(eq(users.email, marthaEmail)).limit(1)
  let marthaId = martha?.id
  if (martha) {
    await db
      .update(users)
      .set({
        firstName: 'Martha',
        lastName: 'Volunteer',
        jobTitle: 'Volunteer',
        initials: 'MV',
        avatarColor: 'purple',
        status: 'active',
        passwordHash: marthaHash,
        mustChangePassword: false,
        departmentId: volDept.id,
        teamId: deskTeam?.id ?? martha.teamId,
        managerId: martha.managerId ?? (await defaultSponsorId(companyId, volDept.ownerId)),
      })
      .where(eq(users.id, martha.id))
  } else {
    const sponsorId = await defaultSponsorId(companyId, volDept.ownerId)
    const [created] = await db
      .insert(users)
      .values({
        companyId,
        departmentId: volDept.id,
        teamId: deskTeam?.id ?? null,
        managerId: sponsorId,
        email: marthaEmail,
        firstName: 'Martha',
        lastName: 'Volunteer',
        jobTitle: 'Volunteer',
        passwordHash: marthaHash,
        mustChangePassword: false,
        initials: 'MV',
        avatarColor: 'purple',
        status: 'active',
      })
      .returning()
    marthaId = created.id
    await db.insert(notificationPreferences).values({ userId: created.id })
  }

  if (marthaId && roleId) {
    await setPrimaryRole(marthaId, 'volunteer')
    await provisionAuthIdentity({
      userId: marthaId,
      email: marthaEmail,
      name: 'Martha Volunteer',
      passwordHash: marthaHash,
    })
  }
}

async function seed() {
  const defaultPasswordHash = await bcrypt.hash(STAFF_PASSWORD, 10)
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)
  const reset = process.argv.includes('--reset')
  const existing = await db.select({ id: companies.id }).from(companies).limit(1)

  if (existing.length && !reset) {
    await syncPrivilegedAccounts()
    console.log('Workspace already has data. Admin and MD accounts were aligned to the permission kernel.')
    console.log('Re-run with --reset only if you want a full demo wipe.')
    printLoginRoster()
    return
  }

  if (reset) {
    await db.execute(sql`
      truncate table
        session,
        account,
        verification,
        "user",
        deadline_alert_log,
        notifications,
        notification_preferences,
        management_requests,
        deliverables,
        task_approvals,
        task_dependencies,
        activity_events,
        task_attachments,
        task_comments,
        tasks,
        responsibility_assignees,
        responsibilities,
        project_milestone_tasks,
        project_milestones,
        project_departments,
        project_teams,
        projects,
        user_roles,
        users,
        teams,
        departments,
        roles,
        companies
      restart identity cascade
    `)
  }

  const [company] = await db
    .insert(companies)
    .values({
      name: 'Globecon Convergence Solutions',
      shortName: 'GCS',
      tagline: 'Operational clarity for every team',
    })
    .returning()

  const insertedRoles = await db
    .insert(roles)
    .values([
      { key: 'managing_director', name: 'Managing Director', description: 'Company-wide ownership and executive oversight', rank: 100 },
      { key: 'department_head', name: 'Department Head', description: 'Owns a department and its delivery', rank: 80 },
      { key: 'manager', name: 'Manager', description: 'Leads a team and assigns work', rank: 60 },
      { key: 'employee', name: 'Employee', description: 'Owns assigned tasks and responsibilities', rank: 20 },
      { key: 'volunteer', name: 'Volunteer', description: 'Supports GCS work with a focused volunteer desk — assigned tasks only', rank: 15 },
      { key: 'admin', name: 'Workspace Admin', description: 'Manages accounts and workspace settings', rank: 90 },
    ])
    .returning()

  const roleByKey = Object.fromEntries(insertedRoles.map((role) => [role.key, role.id]))

  const insertedDepartments = await db
    .insert(departments)
    .values([
      { companyId: company.id, name: 'Business development Team', slug: 'operations', color: 'teal' },
      { companyId: company.id, name: 'Digital Technology team', slug: 'technology', color: 'blue' },
      { companyId: company.id, name: 'Communications and Marketing Team', slug: 'client-services', color: 'gold' },
      { companyId: company.id, name: 'Finance/Admin executive department', slug: 'finance-admin', color: 'coral' },
      { companyId: company.id, name: 'HR department', slug: 'marketing', color: 'gold' },
      { companyId: company.id, name: 'MD', slug: 'md', color: 'navy' },
      { companyId: company.id, name: 'Interns', slug: 'interns', color: 'slate' },
      { companyId: company.id, name: 'Attachees', slug: 'attachees', color: 'purple' },
      { companyId: company.id, name: 'Volunteers', slug: 'volunteers', color: 'purple' },
    ])
    .returning()

  const dept = Object.fromEntries(insertedDepartments.map((row) => [row.slug, row]))

  const insertedTeams = await db
    .insert(teams)
    .values([
      { departmentId: dept.operations.id, name: 'Ops Core' },
      { departmentId: dept.technology.id, name: 'Platform' },
      { departmentId: dept['client-services'].id, name: 'Delivery' },
      { departmentId: dept['finance-admin'].id, name: 'Accounts' },
      { departmentId: dept.marketing.id, name: 'Growth' },
      { departmentId: dept.md.id, name: 'Executive Office' },
      { departmentId: dept.interns.id, name: 'Intern Desk' },
      { departmentId: dept.attachees.id, name: 'Attachees Desk' },
      { departmentId: dept.volunteers.id, name: 'Volunteers Desk' },
    ])
    .returning()

  const teamByName = Object.fromEntries(insertedTeams.map((team) => [team.name, team.id]))

  const insertedUsers = await db
    .insert(users)
    .values([
      {
        companyId: company.id,
        departmentId: dept.md.id,
        teamId: teamByName['Executive Office'],
        email: 'md@globeconcs.com',
        firstName: 'Anthony',
        lastName: 'Waliula',
        jobTitle: 'MD',
        passwordHash: defaultPasswordHash,
        initials: 'AW',
        avatarColor: 'navy',
      },
      {
        companyId: company.id,
        departmentId: dept.md.id,
        teamId: teamByName['Executive Office'],
        email: ADMIN_EMAIL,
        firstName: 'Tony',
        lastName: 'Ouh',
        jobTitle: 'Workspace Administrator',
        passwordHash: adminPasswordHash,
        initials: 'TO',
        avatarColor: 'navy',
      },
      {
        companyId: company.id,
        departmentId: dept.operations.id,
        teamId: teamByName['Ops Core'],
        email: 'patrick@globeconcs.com',
        firstName: 'Patrick',
        lastName: 'Ihiga',
        jobTitle: 'Business Development Executive',
        passwordHash: defaultPasswordHash,
        initials: 'PI',
        avatarColor: 'teal',
      },
      {
        companyId: company.id,
        departmentId: dept.technology.id,
        teamId: teamByName.Platform,
        email: 'victor@globeconcs.com',
        firstName: 'Victor',
        lastName: 'Kibiwott',
        jobTitle: 'Digital Technology Team Co-Lead',
        passwordHash: defaultPasswordHash,
        initials: 'VK',
        avatarColor: 'teal',
      },
      {
        companyId: company.id,
        departmentId: dept['client-services'].id,
        teamId: teamByName['Delivery'],
        email: 'calvin@globeconcs.com',
        firstName: 'Calvin',
        lastName: 'Klein',
        jobTitle: 'Communications & Marketing Lead',
        passwordHash: defaultPasswordHash,
        initials: 'CK',
        avatarColor: 'coral',
      },
      {
        companyId: company.id,
        departmentId: dept['finance-admin'].id,
        teamId: teamByName.Accounts,
        email: 'carolyne@globeconcs.com',
        firstName: 'Carolyne',
        lastName: 'Mutuku Ndunge',
        jobTitle: 'Admin Executive',
        passwordHash: defaultPasswordHash,
        initials: 'CM',
        avatarColor: 'gold',
      },
      {
        companyId: company.id,
        departmentId: dept.marketing.id,
        teamId: teamByName.Growth,
        email: 'elsia@globeconcs.com',
        firstName: 'Elsia',
        lastName: 'Mutuku',
        jobTitle: 'HR',
        passwordHash: defaultPasswordHash,
        initials: 'EM',
        avatarColor: 'gold',
      },
      {
        companyId: company.id,
        departmentId: dept.technology.id,
        teamId: teamByName.Platform,
        email: 'velma@globeconcs.com',
        firstName: 'Velma',
        lastName: 'Muyuku',
        jobTitle: 'Digital Technology Team Co-Lead',
        passwordHash: defaultPasswordHash,
        initials: 'VM',
        avatarColor: 'blue',
      },
      {
        companyId: company.id,
        departmentId: dept.technology.id,
        teamId: teamByName.Platform,
        email: 'krystal.markk@gmail.com',
        firstName: 'Krystal',
        lastName: 'Mark',
        jobTitle: 'Supporting Engineer',
        passwordHash: defaultPasswordHash,
        initials: 'KM',
        avatarColor: 'purple',
      },
      {
        companyId: company.id,
        departmentId: dept.attachees.id,
        teamId: teamByName['Attachees Desk'],
        email: 'john@globeconcs.com',
        firstName: 'John',
        lastName: 'Ndugu',
        jobTitle: 'Attachee',
        passwordHash: defaultPasswordHash,
        initials: 'JN',
        avatarColor: 'purple',
      },
      {
        companyId: company.id,
        departmentId: dept.interns.id,
        teamId: teamByName['Intern Desk'],
        email: 'interns.intern@globcons.com',
        firstName: 'Intern',
        lastName: '—',
        jobTitle: 'Intern',
        passwordHash: defaultPasswordHash,
        initials: 'IN',
        avatarColor: 'slate',
      },
    ])
    .returning()

  const amara = insertedUsers.find((user) => user.email === MD_EMAIL)!
  const tony = insertedUsers.find((user) => user.email === ADMIN_EMAIL)!
  const nia = insertedUsers.find((user) => user.email === 'patrick@globeconcs.com')!
  const david = insertedUsers.find((user) => user.email === 'victor@globeconcs.com')!
  const james = insertedUsers.find((user) => user.email === 'calvin@globeoncs.com')!
  const lina = insertedUsers.find((user) => user.email === 'carolyne@globeconcs.com')!
  const sofia = insertedUsers.find((user) => user.email === 'elsia@globeconcs.com') ?? insertedUsers.find((user) => user.firstName === 'Elsia')!
  const kwame = insertedUsers.find((user) => user.email === 'velma@globeconcs.com')!
  const krystal = insertedUsers.find((user) => user.email === 'krystal.markk@gmail.com')!
  const john = insertedUsers.find((user) => user.email === 'john@globeconcs.com')!
  const intern = insertedUsers.find((user) => user.email === 'interns.intern@globcons.com')!

  await db.update(users).set({ managerId: amara.id }).where(ne(users.id, amara.id))
  await db.update(users).set({ managerId: amara.id }).where(eq(users.id, kwame.id))
  await db.update(users).set({ managerId: amara.id }).where(eq(users.id, sofia.id))
  await db.update(users).set({ managerId: amara.id }).where(eq(users.id, tony.id))

  await db.update(departments).set({ ownerId: nia.id }).where(eq(departments.id, dept.operations.id))
  await db.update(departments).set({ ownerId: david.id }).where(eq(departments.id, dept.technology.id))
  await db.update(departments).set({ ownerId: james.id }).where(eq(departments.id, dept['client-services'].id))
  await db.update(departments).set({ ownerId: lina.id }).where(eq(departments.id, dept['finance-admin'].id))
  await db.update(departments).set({ ownerId: sofia.id }).where(eq(departments.id, dept.marketing.id))
  await db.update(departments).set({ ownerId: amara.id }).where(eq(departments.id, dept.md.id))

  await db.insert(userRoles).values([
    { userId: amara.id, roleId: roleByKey.managing_director },
    { userId: tony.id, roleId: roleByKey.admin },
    { userId: nia.id, roleId: roleByKey.department_head },
    { userId: david.id, roleId: roleByKey.department_head },
    { userId: james.id, roleId: roleByKey.department_head },
    { userId: lina.id, roleId: roleByKey.department_head },
    { userId: sofia.id, roleId: roleByKey.department_head },
    { userId: kwame.id, roleId: roleByKey.department_head },
    { userId: krystal.id, roleId: roleByKey.employee },
    { userId: john.id, roleId: roleByKey.employee },
    { userId: intern.id, roleId: roleByKey.employee },
  ])

  const workload = await applyPriorityWorkload(db)

  const [workhubTask] = await db.select().from(tasks).where(eq(tasks.title, 'WorkHub — central reporting workspace')).limit(1)
  const [tenderTask] = await db.select().from(tasks).where(eq(tasks.title, 'Tender Watch — online crawler for missing tenders')).limit(1)

  await db.insert(notificationPreferences).values(
    insertedUsers.map((user) => ({ userId: user.id })),
  )

  await db.insert(notifications).values([
    {
      companyId: company.id,
      userId: amara.id,
      type: 'daily_summary',
      title: 'Daily workspace summary',
      body: 'Review company-wide delivery, overdue work, and management requests.',
    },
    {
      companyId: company.id,
      userId: david.id,
      type: 'deadline_today',
      title: 'Kalimoni and Tender Watch need a look',
      body: 'Kalimoni website implementation and Tender Watch crawler are past their first-phase dates.',
      entityType: 'task',
      entityId: tenderTask?.id ?? null,
    },
    {
      companyId: company.id,
      userId: amara.id,
      type: 'escalation_management',
      title: 'WorkHub first visual phase',
      body: 'GCS WorkHub is live as the central reporting system. First visual phase is in progress.',
      entityType: 'task',
      entityId: workhubTask?.id ?? null,
    },
  ])

  await db.insert(managementRequests).values([
    {
      companyId: company.id,
      requestorId: nia.id,
      assigneeId: amara.id,
      title: 'Approve Q3 campaign budget',
      description: 'Need executive sign-off before the communications rollout.',
      priority: 'high',
      status: 'open',
    },
    {
      companyId: company.id,
      requestorId: david.id,
      assigneeId: amara.id,
      title: 'Confirm Hewane website scope',
      description: 'Digital Technology needs a go-ahead on the Hewane School of Music full website revamp.',
      priority: 'medium',
      status: 'in_progress',
    },
  ])

  console.log(`Seeded ${company.shortName} WorkHub: ${insertedUsers.length} people, ${workload.tasksTouched} priority tasks, ${workload.projectsTouched} projects.`)
  for (const person of insertedUsers) {
    if (!person.passwordHash) continue
    await provisionAuthIdentity({
      userId: person.id,
      email: person.email,
      name: fullName(person),
      passwordHash: person.passwordHash,
    })
  }
  printLoginRoster()
}

seed().catch((error) => {
  console.error(error)
  process.exit(1)
})
