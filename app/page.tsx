import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import WorkhubDashboardDB from '@/components/workhub-dashboard-db'
import { SetupScreen } from '@/components/setup-screen'
import { COMPANY_LEGAL_NAME, COMPANY_SHORT_NAME } from '@/lib/branding'
import { isDatabaseConfigured } from '@/lib/db'
import { getDashboardData, getSettingsData, getWorkspaceContext } from '@/lib/db/queries'
import type { ComponentProps } from 'react'

type DashboardProps = ComponentProps<typeof WorkhubDashboardDB>

function isNextRedirect(error: unknown) {
  return typeof error === 'object' && error !== null && 'digest' in error && String((error as { digest?: string }).digest).includes('NEXT_REDIRECT')
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const params = await searchParams

  if (!isDatabaseConfigured()) {
    return <SetupScreen error="DATABASE_URL is missing. Check .env.local." />
  }

  try {
    const { currentUser, people, directory, departmentDirectory, company } = await getWorkspaceContext()
    const companyName = company?.name ?? COMPANY_LEGAL_NAME
    const companyShortName = company?.shortName ?? COMPANY_SHORT_NAME
    if (!company) {
      return <SetupScreen missingSeed />
    }
    if (!currentUser) {
      redirect('/login')
    }
    if (currentUser.mustChangePassword) {
      redirect('/account/password')
    }

    const [dashboardData, settings] = await Promise.all([
      getDashboardData(currentUser),
      getSettingsData(currentUser),
    ])

    return (
      <Suspense fallback={<div className="workhub-shell" />}>
        <WorkhubDashboardDB
          initialTasks={dashboardData.tasks as unknown as DashboardProps['initialTasks']}
          initialDepartments={dashboardData.departments as unknown as DashboardProps['initialDepartments']}
          initialActivity={dashboardData.activity as unknown as DashboardProps['initialActivity']}
          upcoming={dashboardData.upcoming as unknown as DashboardProps['upcoming']}
          metrics={dashboardData.metrics}
          people={people as unknown as DashboardProps['people']}
          directory={directory as unknown as DashboardProps['directory']}
          departmentDirectory={departmentDirectory as unknown as DashboardProps['departmentDirectory']}
          responsibilities={dashboardData.responsibilities as unknown as DashboardProps['responsibilities']}
          allActivity={dashboardData.allActivity as unknown as DashboardProps['allActivity']}
          myTasks={dashboardData.myTasks as unknown as DashboardProps['myTasks']}
          myMetrics={dashboardData.myMetrics}
          projects={dashboardData.projects}
          reportMetrics={dashboardData.reportMetrics}
          currentUserId={currentUser.id}
          currentUserRoles={currentUser.roles?.map((entry) => entry.role.key) ?? []}
          initialView={params.view as DashboardProps['initialView']}
          myTaskCount={dashboardData.myTaskCount}
          initialNotifications={dashboardData.notifications as DashboardProps['initialNotifications']}
          unreadNotificationCount={dashboardData.unreadNotificationCount}
          managementRequests={dashboardData.managementRequests as DashboardProps['managementRequests']}
          notificationPreferences={dashboardData.notificationPreferences as DashboardProps['notificationPreferences']}
          workspaceRoles={settings?.roles ?? []}
          workspaceTeams={settings?.teams ?? []}
          companyName={companyName}
          companyShortName={companyShortName}
        />
      </Suspense>
    )
  } catch (err) {
    if (isNextRedirect(err)) throw err
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    return <SetupScreen error={errorMessage} />
  }
}
