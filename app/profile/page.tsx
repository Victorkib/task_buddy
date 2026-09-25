import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ProfileWorkspace } from '@/components/profile-workspace'
import { SetupScreen } from '@/components/setup-screen'
import { COMPANY_LEGAL_NAME, PRODUCT_NAME, productTitle } from '@/lib/branding'
import { isDatabaseConfigured } from '@/lib/db'
import {
  getCompany,
  getCurrentUser,
  getNotificationPreferences,
  getOverviewData,
  getUnreadNotificationCount,
  listNotifications,
  listProjects,
} from '@/lib/db/queries'
import { isDepartmentLeader, isManagement } from '@/lib/auth/permissions'

export const metadata: Metadata = {
  title: productTitle('Your profile'),
  description: `Update your photo, credentials, and alert preferences in ${PRODUCT_NAME}.`,
}

function isNextRedirect(error: unknown) {
  return typeof error === 'object' && error !== null && 'digest' in error && String((error as { digest?: string }).digest).includes('NEXT_REDIRECT')
}

export default async function ProfilePage() {
  if (!isDatabaseConfigured()) {
    return <SetupScreen error="DATABASE_URL is missing. Check .env.local." />
  }

  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) redirect('/login?callbackUrl=/profile')
    if (currentUser.mustChangePassword) redirect('/account/password')

    const [company, preferences, overview, notifications, unreadNotificationCount, projects] = await Promise.all([
      getCompany(),
      getNotificationPreferences(currentUser.id),
      getOverviewData(currentUser),
      listNotifications(currentUser.id, 25),
      getUnreadNotificationCount(currentUser.id),
      listProjects({ viewer: currentUser }),
    ])

    const canViewProjects =
      isManagement(currentUser) || isDepartmentLeader(currentUser) || projects.length > 0

    return (
      <ProfileWorkspace
        user={{
          id: currentUser.id,
          firstName: currentUser.firstName,
          lastName: currentUser.lastName,
          jobTitle: currentUser.jobTitle,
          email: currentUser.email,
          initials: currentUser.initials,
          avatarColor: currentUser.avatarColor,
          avatarUrl: currentUser.avatarUrl,
          departmentId: currentUser.departmentId,
        }}
        preferences={preferences}
        departmentName={currentUser.department?.name ?? null}
        roleLabels={(currentUser.roles ?? []).map((entry) => entry.role.name)}
        lastLoginLabel={
          currentUser.lastLoginAt
            ? new Date(currentUser.lastLoginAt).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Africa/Nairobi',
              })
            : 'Not recorded'
        }
        companyName={company?.name ?? COMPANY_LEGAL_NAME}
        currentUserRoles={currentUser.roles?.map((entry) => entry.role.key) ?? []}
        myTaskCount={overview.myTaskCount}
        canViewProjects={canViewProjects}
        initialNotifications={notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          body: notification.body,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        }))}
        unreadNotificationCount={unreadNotificationCount}
      />
    )
  } catch (err) {
    if (isNextRedirect(err)) throw err
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    return <SetupScreen error={errorMessage} />
  }
}
