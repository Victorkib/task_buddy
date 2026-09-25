'use server'

import { canDeactivateUser, canEditPerson, canInvite, canManageUsers, denied, isDepartmentHead, isManagement } from '@/lib/auth/permissions'
import { requiresSponsor } from '@/lib/auth/sponsored'
import {
  createUserInvite,
  findOpenInviteByToken,
  generateTemporaryPassword,
  invalidateOpenInvites,
  INVITE_SETUP_DAYS,
  markInviteConsumed,
  PASSWORD_RESET_HOURS,
} from '@/lib/auth/invite-tokens'
import { deleteAuthIdentity, provisionAuthIdentity, revokeAuthSessions } from '@/lib/auth/provision-user'
import { getDb } from '@/lib/db'
import { getCompany, getCurrentUser, getUserByEmail, getUserById } from '@/lib/db/queries'
import {
  activityEvents,
  authUser,
  departments,
  notificationPreferences,
  roles,
  teams,
  userRoles,
  users,
} from '@/lib/db/schema'
import { PRODUCT_NAME } from '@/lib/branding'
import { fullName, makeInitials } from '@/lib/format'
import { getPublicAppUrl, isMailConfigured, sendMail } from '@/lib/mail/send'
import { inviteSetupEmail, passwordResetEmail, tempPasswordEmail } from '@/lib/mail/templates'
import {
  getPersonWorkload,
  preparePersonHardDelete,
  reassignPersonWork,
} from '@/lib/people/workload'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import bcrypt from 'bcryptjs'
import { APIError } from 'better-auth/api'
import { auth } from '@/lib/auth/better-auth'

function roleLandingPath(roleKeys: string[]) {
  if (roleKeys.includes('admin') || roleKeys.includes('managing_director')) return '/?view=Home'
  if (roleKeys.includes('department_head') || roleKeys.includes('manager')) return '/?view=Departments'
  return '/?view=My%20tasks'
}

function refreshWorkhub() {
  revalidatePath('/')
  revalidatePath('/login')
  revalidatePath('/invite')
  revalidatePath('/forgot-password')
  revalidatePath('/reset-password')
  revalidatePath('/account/password')
}

function validateNewPassword(password: string, confirm: string) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters.'
  if (password !== confirm) return 'Password and confirmation do not match.'
  return null
}

async function roleDisplayName(roleKey: string) {
  const [role] = await getDb().select().from(roles).where(eq(roles.key, roleKey)).limit(1)
  return role?.name ?? roleKey
}

async function departmentDisplayName(departmentId: string | null) {
  if (!departmentId) return null
  const [department] = await getDb().select().from(departments).where(eq(departments.id, departmentId)).limit(1)
  return department?.name ?? null
}

async function sendSetupInviteEmail(input: {
  userId: string
  email: string
  firstName: string
  inviterName: string
  companyName: string
  roleName: string
  departmentName: string | null
  invitedById: string
  rawToken?: string
}) {
  let rawToken = input.rawToken
  if (!rawToken) {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + INVITE_SETUP_DAYS)
    const created = await createUserInvite({
      userId: input.userId,
      invitedById: input.invitedById,
      purpose: 'setup',
      expiresAt,
    })
    rawToken = created.rawToken
  }

  const setupUrl = `${getPublicAppUrl()}/invite/${rawToken}`
  const mail = inviteSetupEmail({
    firstName: input.firstName,
    inviterName: input.inviterName,
    companyName: input.companyName,
    roleName: input.roleName,
    departmentName: input.departmentName,
    setupUrl,
    expiresInDays: INVITE_SETUP_DAYS,
  })
  await sendMail({ to: input.email, ...mail })
  return { setupUrl }
}

export async function inviteEmployee(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const jobTitle = String(formData.get('jobTitle') ?? '').trim()
  let departmentId = String(formData.get('departmentId') ?? '') || null
  const managerId = String(formData.get('managerId') ?? '') || null
  const roleKey = String(formData.get('roleKey') ?? 'employee').trim() || 'employee'
  const credentialMode = String(formData.get('credentialMode') ?? 'email') === 'temp' ? 'temp' : 'email'
  const customTempPassword = String(formData.get('temporaryPassword') ?? '')
  const emailTempPassword = String(formData.get('emailTempPassword') ?? '') === 'on'

  if (isDepartmentHead(currentUser) && !isManagement(currentUser)) {
    departmentId = currentUser.departmentId ?? null
  }
  if (!canInvite(currentUser, { roleKey, departmentId })) {
    return denied('You are not allowed to add this person.')
  }
  if ((roleKey === 'department_head' || roleKey === 'manager') && !departmentId) {
    return { error: 'Assign a department for this role.' }
  }

  let departmentSlug: string | null = null
  if (departmentId) {
    const [department] = await getDb().select().from(departments).where(eq(departments.id, departmentId)).limit(1)
    departmentSlug = department?.slug ?? null
  }
  if (requiresSponsor({ roleKey, departmentSlug }) && !managerId) {
    return {
      error: 'Sponsored desks (volunteers, interns, attachees) need a supervisor under Reports to.',
    }
  }
  if (managerId === '' || managerId === null) {
    // ok for non-sponsored
  } else if (managerId) {
    const manager = await getUserById(managerId)
    if (!manager || manager.status === 'inactive') {
      return { error: 'Choose an active supervisor.' }
    }
  }

  if (!firstName || !lastName) return { error: 'First and last name are required.' }
  if (!email || !email.includes('@')) return { error: 'A valid work email is required.' }
  if (!jobTitle) return { error: 'A job title is required.' }

  if (credentialMode === 'email' && !isMailConfigured()) {
    return { error: 'Email invite needs Gmail configured (GMAIL_USER and GMAIL_APP_PASSWORD).' }
  }

  const existing = await getUserByEmail(email)
  if (existing) {
    if (existing.status === 'invited') {
      return { error: 'That person already has a pending invite. Resend it from the people list.' }
    }
    if (existing.status === 'inactive') {
      return { error: 'That email belongs to a deactivated account. Reactivate them from the people list.' }
    }
    return { error: `That email is already on ${PRODUCT_NAME}.` }
  }

  const company = await getCompany()
  if (!company) return { error: 'Workspace is not ready yet.' }

  const [role] = await getDb().select().from(roles).where(eq(roles.key, roleKey)).limit(1)
  if (!role) return { error: 'Choose a valid role.' }

  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase() || 'G'
  const inviterName = fullName(currentUser)
  const roleName = role.name
  const departmentName = await departmentDisplayName(departmentId)

  if (credentialMode === 'email') {
    const [created] = await getDb()
      .insert(users)
      .values({
        companyId: company.id,
        departmentId,
        managerId,
        email,
        firstName,
        lastName,
        jobTitle,
        passwordHash: null,
        mustChangePassword: false,
        initials,
        status: 'invited',
      })
      .returning()

    await getDb().insert(userRoles).values({ userId: created.id, roleId: role.id })
    await getDb().insert(notificationPreferences).values({ userId: created.id })

    try {
      await sendSetupInviteEmail({
        userId: created.id,
        email,
        firstName,
        inviterName,
        companyName: company.name,
        roleName,
        departmentName,
        invitedById: currentUser.id,
      })
    } catch (error) {
      await getDb().delete(users).where(eq(users.id, created.id))
      const message = error instanceof Error ? error.message : 'The invite email could not be sent.'
      return { error: message }
    }

    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: currentUser.id,
      entityType: 'user',
      entityId: created.id,
      action: 'invited',
      summary: `invited ${firstName} ${lastName} to ${PRODUCT_NAME}`,
    })

    refreshWorkhub()
    return {
      ok: true as const,
      mode: 'email' as const,
      email,
      name: `${firstName} ${lastName}`,
      message: `Invite email sent to ${email}. They have ${INVITE_SETUP_DAYS} days to set up their account.`,
    }
  }

  const temporaryPassword = customTempPassword.trim() || generateTemporaryPassword()
  if (temporaryPassword.length < 8) {
    return { error: 'Temporary password must be at least 8 characters.' }
  }
  const passwordHash = await bcrypt.hash(temporaryPassword, 10)

  const [created] = await getDb()
    .insert(users)
    .values({
      companyId: company.id,
      departmentId,
      managerId,
      email,
      firstName,
      lastName,
      jobTitle,
      passwordHash,
      mustChangePassword: true,
      initials,
      status: 'active',
    })
    .returning()

  await getDb().insert(userRoles).values({ userId: created.id, roleId: role.id })
  await getDb().insert(notificationPreferences).values({ userId: created.id })
  await provisionAuthIdentity({
    userId: created.id,
    email,
    name: `${firstName} ${lastName}`,
    passwordHash,
  })

  let emailed = false
  if (emailTempPassword) {
    if (!isMailConfigured()) {
      await getDb().delete(users).where(eq(users.id, created.id))
      return { error: 'Gmail is not configured, so the temporary password could not be emailed. Uncheck “Also email…” or configure Gmail.' }
    }
    try {
      const mail = tempPasswordEmail({
        firstName,
        inviterName,
        companyName: company.name,
        loginUrl: `${getPublicAppUrl()}/login`,
        temporaryPassword,
      })
      await sendMail({ to: email, ...mail })
      emailed = true
    } catch (error) {
      await getDb().delete(users).where(eq(users.id, created.id))
      const message = error instanceof Error ? error.message : 'The temporary password email could not be sent.'
      return { error: message }
    }
  }

  await getDb().insert(activityEvents).values({
    companyId: company.id,
    actorId: currentUser.id,
    entityType: 'user',
    entityId: created.id,
    action: 'invited',
    summary: `added ${firstName} ${lastName} to ${PRODUCT_NAME} with a temporary password`,
  })

  refreshWorkhub()
  return {
    ok: true as const,
    mode: 'temp' as const,
    email,
    name: `${firstName} ${lastName}`,
    temporaryPassword,
    emailed,
    message: emailed
      ? `Account created and temporary password emailed to ${email}.`
      : `Account created for ${email}. Share the temporary password securely — they must change it on first sign-in.`,
  }
}

export async function resendInvite(userId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const target = await getUserById(userId)
  if (!target) return { error: 'Person not found.' }
  if (target.status !== 'invited') return { error: 'Only pending invites can be resent.' }

  const roleKey = target.roles?.[0]?.role.key ?? 'employee'
  if (!canInvite(currentUser, { roleKey, departmentId: target.departmentId })) {
    return denied('You are not allowed to resend this invite.')
  }
  if (!isMailConfigured()) {
    return { error: 'Gmail is not configured on this workspace.' }
  }

  const company = await getCompany()
  if (!company) return { error: 'Workspace is not ready yet.' }

  try {
    await sendSetupInviteEmail({
      userId: target.id,
      email: target.email,
      firstName: target.firstName,
      inviterName: fullName(currentUser),
      companyName: company.name,
      roleName: target.roles?.[0]?.role.name ?? (await roleDisplayName(roleKey)),
      departmentName: target.department?.name ?? null,
      invitedById: currentUser.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The invite email could not be sent.'
    return { error: message }
  }

  await getDb().insert(activityEvents).values({
    companyId: company.id,
    actorId: currentUser.id,
    entityType: 'user',
    entityId: target.id,
    action: 'invite_resent',
    summary: `resent invite to ${fullName(target)}`,
  })

  refreshWorkhub()
  return { ok: true as const, message: `Invite resent to ${target.email}.` }
}

export async function cancelInvite(userId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const target = await getUserById(userId)
  if (!target) return { error: 'Person not found.' }
  if (target.status !== 'invited') return { error: 'Only pending invites can be cancelled.' }

  const roleKey = target.roles?.[0]?.role.key ?? 'employee'
  if (!canInvite(currentUser, { roleKey, departmentId: target.departmentId }) && !canManageUsers(currentUser)) {
    return denied('You are not allowed to cancel this invite.')
  }

  await invalidateOpenInvites(target.id)
  await getDb().update(users).set({ status: 'inactive' }).where(eq(users.id, target.id))

  const company = await getCompany()
  if (company) {
    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: currentUser.id,
      entityType: 'user',
      entityId: target.id,
      action: 'invite_cancelled',
      summary: `cancelled invite for ${fullName(target)}`,
    })
  }

  refreshWorkhub()
  return { ok: true as const }
}

export async function getInvitePreview(rawToken: string) {
  const invite = await findOpenInviteByToken(rawToken, 'setup')
  if (!invite || invite.user.status !== 'invited') {
    return { error: 'This invite link is invalid or has expired.' as const }
  }
  return {
    ok: true as const,
    firstName: invite.user.firstName,
    lastName: invite.user.lastName,
    email: invite.user.email,
    jobTitle: invite.user.jobTitle,
    departmentName: invite.user.department?.name ?? null,
    expiresAt: invite.expiresAt.toISOString(),
  }
}

export async function acceptInvite(formData: FormData) {
  const rawToken = String(formData.get('token') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const passwordError = validateNewPassword(password, confirmPassword)
  if (passwordError) return { error: passwordError }
  if (!rawToken) return { error: 'Missing invite token.' }

  const invite = await findOpenInviteByToken(rawToken, 'setup')
  if (!invite || invite.user.status !== 'invited') {
    return { error: 'This invite link is invalid or has expired.' }
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await getDb()
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: false,
      status: 'active',
      lastLoginAt: new Date(),
    })
    .where(eq(users.id, invite.userId))

  await provisionAuthIdentity({
    userId: invite.userId,
    email: invite.user.email,
    name: fullName(invite.user),
    passwordHash,
  })
  await markInviteConsumed(invite.id)

  const company = await getCompany()
  if (company) {
    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: invite.userId,
      entityType: 'user',
      entityId: invite.userId,
      action: 'invite_accepted',
      summary: `${fullName(invite.user)} activated their ${PRODUCT_NAME} account`,
    })
  }

  const requestHeaders = await headers()
  try {
    await auth.api.signInEmail({
      body: { email: invite.user.email, password },
      headers: requestHeaders,
    })
  } catch (error) {
    if (!(error instanceof APIError)) throw error
    refreshWorkhub()
    return { ok: true as const, signedIn: false as const, email: invite.user.email }
  }

  refreshWorkhub()
  const roleKeys = invite.user.roles?.map((entry) => entry.role.key) ?? []
  redirect(roleLandingPath(roleKeys))
}

export async function completeForcedPasswordChange(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }
  if (!currentUser.mustChangePassword) {
    redirect('/')
  }

  const currentPassword = String(formData.get('currentPassword') ?? '')
  const nextPassword = String(formData.get('nextPassword') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  if (!currentPassword) return { error: 'Enter your temporary password.' }
  const passwordError = validateNewPassword(nextPassword, confirmPassword)
  if (passwordError) return { error: passwordError }
  if (!currentUser.passwordHash) return { error: 'This account cannot set a password yet.' }

  const matches = await bcrypt.compare(currentPassword, currentUser.passwordHash)
  if (!matches) return { error: 'Temporary password is incorrect.' }
  const same = await bcrypt.compare(nextPassword, currentUser.passwordHash)
  if (same) return { error: 'Choose a password that is different from the temporary one.' }

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
  await revokeAuthSessions(currentUser.id)

  const requestHeaders = await headers()
  try {
    await auth.api.signInEmail({
      body: { email: currentUser.email, password: nextPassword },
      headers: requestHeaders,
    })
  } catch (error) {
    if (error instanceof APIError) {
      refreshWorkhub()
      return { ok: true as const, signedIn: false as const }
    }
    throw error
  }

  refreshWorkhub()
  redirect('/')
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return { error: 'Enter a valid work email.' }
  if (!isMailConfigured()) {
    return { error: 'Password reset email is not available yet. Contact your administrator.' }
  }

  const user = await getUserByEmail(email)
  // Always look successful to avoid account enumeration.
  const generic = {
    ok: true as const,
    message: `If that email is on ${PRODUCT_NAME}, a reset link is on its way.`,
  }
  if (!user || user.status !== 'active' || !user.passwordHash) return generic

  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + PASSWORD_RESET_HOURS)
  const { rawToken } = await createUserInvite({
    userId: user.id,
    invitedById: null,
    purpose: 'password_reset',
    expiresAt,
  })

  const resetUrl = `${getPublicAppUrl()}/reset-password/${rawToken}`
  const mail = passwordResetEmail({
    firstName: user.firstName,
    resetUrl,
    expiresInHours: PASSWORD_RESET_HOURS,
  })

  try {
    await sendMail({ to: user.email, ...mail })
  } catch {
    return { error: 'The reset email could not be sent. Try again shortly or contact your administrator.' }
  }

  return generic
}

export async function getPasswordResetPreview(rawToken: string) {
  const invite = await findOpenInviteByToken(rawToken, 'password_reset')
  if (!invite || invite.user.status !== 'active') {
    return { error: 'This reset link is invalid or has expired.' as const }
  }
  return { ok: true as const, email: invite.user.email, firstName: invite.user.firstName }
}

export async function resetPasswordWithToken(formData: FormData) {
  const rawToken = String(formData.get('token') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const passwordError = validateNewPassword(password, confirmPassword)
  if (passwordError) return { error: passwordError }
  if (!rawToken) return { error: 'Missing reset token.' }

  const invite = await findOpenInviteByToken(rawToken, 'password_reset')
  if (!invite || invite.user.status !== 'active') {
    return { error: 'This reset link is invalid or has expired.' }
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await getDb()
    .update(users)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(users.id, invite.userId))
  await provisionAuthIdentity({
    userId: invite.userId,
    email: invite.user.email,
    name: fullName(invite.user),
    passwordHash,
  })
  await markInviteConsumed(invite.id)
  await revokeAuthSessions(invite.userId)

  refreshWorkhub()
  return { ok: true as const, email: invite.user.email }
}

export async function getPersonRemovalPreview(userId: string) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const target = await getUserById(userId)
  if (!target) return { error: 'Person not found.' }

  const adminRole = await getDb().select().from(roles).where(eq(roles.key, 'admin')).limit(1)
  const adminIds =
    adminRole[0]
      ? await getDb().select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, adminRole[0].id))
      : []
  if (!canDeactivateUser(currentUser, target, adminIds.length)) {
    return denied('You are not allowed to remove this person.')
  }

  const workload = await getPersonWorkload(userId)
  const defaultTransferToId =
    target.managerId && target.managerId !== userId
      ? target.managerId
      : currentUser.id !== userId
        ? currentUser.id
        : null

  return { ok: true as const, workload, defaultTransferToId }
}

export async function removePerson(input: { userId: string; transferToUserId?: string | null }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const target = await getUserById(input.userId)
  if (!target) return { error: 'Person not found.' }
  if (target.id === currentUser.id) return { error: 'You cannot remove your own account.' }

  const adminRole = await getDb().select().from(roles).where(eq(roles.key, 'admin')).limit(1)
  const adminIds =
    adminRole[0]
      ? await getDb().select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, adminRole[0].id))
      : []
  if (!canDeactivateUser(currentUser, target, adminIds.length)) {
    return denied('You are not allowed to remove this person.')
  }

  const workload = await getPersonWorkload(target.id)
  const transferToUserId = input.transferToUserId?.trim() || null
  const successorId = transferToUserId || (workload.requiresTransfer ? null : currentUser.id)

  if (workload.requiresTransfer) {
    if (!successorId || successorId === target.id) {
      return { error: 'Choose someone to receive their work and records before permanently removing them.' }
    }
    try {
      await reassignPersonWork(target.id, successorId)
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not transfer their work.' }
    }
  } else if (successorId && successorId !== target.id) {
    // Hand off any residual RESTRICT rows (approvals etc.) to the acting admin.
    try {
      await reassignPersonWork(target.id, successorId)
    } catch {
      await preparePersonHardDelete(target.id)
    }
  } else {
    await preparePersonHardDelete(target.id)
  }

  const company = await getCompany()
  const recipient = transferToUserId ? await getUserById(transferToUserId) : null
  if (company) {
    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: currentUser.id,
      entityType: 'user',
      entityId: target.id,
      action: 'removed',
      summary: recipient
        ? `permanently removed ${fullName(target)} and transferred their work to ${fullName(recipient)}`
        : `permanently removed ${fullName(target)} from ${PRODUCT_NAME}`,
    })
  }

  await invalidateOpenInvites(target.id)
  await deleteAuthIdentity(target.id)
  await getDb().delete(users).where(eq(users.id, target.id))

  refreshWorkhub()
  return { ok: true as const }
}

export async function updatePerson(formData: FormData) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' }

  const userId = String(formData.get('userId') ?? '').trim()
  if (!userId) return { error: 'Choose a person.' }

  const target = await getUserById(userId)
  if (!target) return { error: 'Person not found.' }
  if (!canEditPerson(currentUser, target)) {
    return denied('You are not allowed to edit this person.')
  }

  const firstName = String(formData.get('firstName') ?? '').trim()
  const lastName = String(formData.get('lastName') ?? '').trim()
  const jobTitle = String(formData.get('jobTitle') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const departmentId = String(formData.get('departmentId') ?? '').trim() || null
  const teamId = String(formData.get('teamId') ?? '').trim() || null
  const managerId = String(formData.get('managerId') ?? '').trim() || null
  const roleKey = String(formData.get('roleKey') ?? '').trim()

  if (!firstName || !lastName || !jobTitle || !email) {
    return { error: 'Name, email, and job title are required.' }
  }
  if (!email.includes('@')) return { error: 'Enter a valid work email.' }
  if (managerId === userId) return { error: 'A person cannot report to themselves.' }

  const existingEmail = await getUserByEmail(email)
  if (existingEmail && existingEmail.id !== userId) {
    return { error: 'Another person already uses that email.' }
  }

  if (teamId) {
    const [team] = await getDb().select().from(teams).where(eq(teams.id, teamId)).limit(1)
    if (!team) return { error: 'Choose a valid team.' }
    if (departmentId && team.departmentId !== departmentId) {
      return { error: 'That team does not belong to the selected department.' }
    }
  }

  if (managerId) {
    const manager = await getUserById(managerId)
    if (!manager || manager.status === 'inactive') {
      return { error: 'Choose an active manager.' }
    }
  }

  let departmentSlug: string | null = null
  if (departmentId) {
    const [department] = await getDb().select().from(departments).where(eq(departments.id, departmentId)).limit(1)
    departmentSlug = department?.slug ?? null
  }
  const effectiveRoleKey = roleKey || target.roles?.[0]?.role.key || 'employee'
  if (requiresSponsor({ roleKey: effectiveRoleKey, departmentSlug }) && !managerId) {
    return {
      error: 'Sponsored desks (volunteers, interns, attachees) need a supervisor under Reports to.',
    }
  }

  if (roleKey) {
    if (!canInvite(currentUser, { roleKey, departmentId })) {
      return denied('You cannot grant that role.')
    }
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

    const [role] = await getDb().select().from(roles).where(eq(roles.key, roleKey)).limit(1)
    if (!role) return { error: 'Choose a valid role.' }
    await getDb().delete(userRoles).where(eq(userRoles.userId, userId))
    await getDb().insert(userRoles).values({ userId, roleId: role.id })
  }

  const initials = makeInitials(firstName, lastName)
  await getDb()
    .update(users)
    .set({
      firstName,
      lastName,
      jobTitle,
      email,
      initials,
      departmentId,
      teamId,
      managerId,
    })
    .where(eq(users.id, userId))

  await getDb()
    .update(authUser)
    .set({ name: `${firstName} ${lastName}`.trim(), email, updatedAt: new Date() })
    .where(eq(authUser.id, userId))

  if (target.passwordHash) {
    await provisionAuthIdentity({
      userId,
      email,
      name: `${firstName} ${lastName}`.trim(),
      passwordHash: target.passwordHash,
    })
  }

  const company = await getCompany()
  if (company) {
    await getDb().insert(activityEvents).values({
      companyId: company.id,
      actorId: currentUser.id,
      entityType: 'user',
      entityId: userId,
      action: 'updated',
      summary: `updated access and details for ${firstName} ${lastName}`,
    })
  }

  refreshWorkhub()
  return { ok: true as const }
}
