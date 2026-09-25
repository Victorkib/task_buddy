'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Activity,
  BriefcaseBusiness,
  Check,
  FileText,
  Home,
  LayoutDashboard,
  Loader2,
  Settings2,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from '@/app/actions'
import { ProfileForm } from '@/components/profile-form'
import { WorkhubShell, useCollapsedSidebar } from '@/components/workhub-shell'
import { PRODUCT_NAME } from '@/lib/branding'
import { signOutToLogin } from '@/lib/auth/sign-out-client'
import {
  canManageOrg,
  canManageUsers,
  canViewCompanyReports,
  canViewDepartmentReports,
} from '@/lib/auth/permissions'
import { formatRelative, fullName } from '@/lib/format'
import type { WorkspaceView } from '@/lib/workspace-nav'

type Prefs = {
  deadlineAlerts: number
  escalationAlerts: number
  approvalAlerts: number
  managementRequestAlerts: number
  dailySummary: number
}

type NotificationRow = {
  id: string
  title: string
  body: string
  readAt: string | Date | null
  createdAt: string | Date
}

export function ProfileWorkspace({
  user,
  preferences,
  departmentName,
  roleLabels,
  lastLoginLabel,
  companyName,
  currentUserRoles,
  myTaskCount,
  canViewProjects,
  initialNotifications,
  unreadNotificationCount,
}: {
  user: {
    id: string
    firstName: string
    lastName: string
    jobTitle: string
    email: string
    initials: string
    avatarColor: string
    avatarUrl?: string | null
    departmentId?: string | null
  }
  preferences: Prefs
  departmentName: string | null
  roleLabels: string[]
  lastLoginLabel: string
  companyName: string
  currentUserRoles: string[]
  myTaskCount: number
  canViewProjects: boolean
  initialNotifications: NotificationRow[]
  unreadNotificationCount: number
}) {
  const router = useRouter()
  const { collapsed, toggle } = useCollapsedSidebar()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [, startTransition] = useTransition()
  const [notificationRows, setNotificationRows] = useState(initialNotifications)
  const [unreadCount, setUnreadCount] = useState(unreadNotificationCount)

  const actor = useMemo(
    () => ({
      id: user.id,
      departmentId: user.departmentId ?? null,
      roles: currentUserRoles.map((key) => ({ role: { key } })),
    }),
    [user.id, user.departmentId, currentUserRoles],
  )
  const roleSet = useMemo(() => new Set(currentUserRoles), [currentUserRoles])
  const isManagement = roleSet.has('admin') || roleSet.has('managing_director')
  const isDepartmentLeader = roleSet.has('department_head') || roleSet.has('manager')
  const canViewDepartments = isManagement || isDepartmentLeader
  const canViewReports = canViewCompanyReports(actor) || canViewDepartmentReports(actor)
  const canManagePeople = canManageUsers(actor)
  const canEditOrg = canManageOrg(actor)

  const navItems: { label: WorkspaceView; icon: typeof LayoutDashboard; count?: number; group: string }[] = [
    ...(isManagement
      ? [{ label: 'Home' as const, icon: Home, group: 'Lead' }]
      : [{ label: 'Overview' as const, icon: LayoutDashboard, group: 'Workspace' }]),
    { label: 'My tasks', icon: Check, count: myTaskCount, group: isManagement ? 'Work' : 'Workspace' },
    { label: 'Responsibilities', icon: ShieldCheck, group: isManagement ? 'Work' : 'Workspace' },
    ...(canViewDepartments ? [{ label: 'Departments' as const, icon: UsersRound, group: 'Delivery' }] : []),
    ...(canViewProjects ? [{ label: 'Projects' as const, icon: BriefcaseBusiness, group: 'Delivery' }] : []),
    ...(canViewReports ? [{ label: 'Reports' as const, icon: FileText, group: isManagement ? 'Lead' : 'Delivery' }] : []),
    { label: 'Activity', icon: Activity, group: isManagement ? 'Work' : 'Workspace' },
    ...((canManagePeople || canEditOrg) ? [{ label: 'Settings' as const, icon: Settings2, group: 'Account' }] : []),
  ]

  const commandQuery = query.trim().toLowerCase()
  const commandResults = navItems
    .filter((item) => !commandQuery || item.label.toLowerCase().includes(commandQuery))
    .map((item) => ({
      id: `view-${item.label}`,
      label: item.label,
      hint: 'Workspace view',
      onSelect: () => {
        setCommandOpen(false)
        router.push(`/?view=${encodeURIComponent(item.label)}`)
      },
    }))

  function goToView(view: WorkspaceView) {
    setMobileOpen(false)
    router.push(`/?view=${encodeURIComponent(view)}`)
  }

  return (
    <WorkhubShell
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      mobileOpen={mobileOpen}
      onMobileOpen={() => setMobileOpen(true)}
      onMobileClose={() => setMobileOpen(false)}
      navItems={navItems}
      activeNav={null}
      onNavigate={goToView}
      searchQuery={query}
      onSearchChange={setQuery}
      onOpenCommand={() => {
        setCommandOpen(true)
        setShowNotifications(false)
        setShowProfile(false)
      }}
      commandOpen={commandOpen}
      onCloseCommand={() => {
        setCommandOpen(false)
        setQuery('')
      }}
      commandResults={commandResults}
      onSelectCommand={(id) => {
        const match = commandResults.find((item) => item.id === id)
        match?.onSelect()
      }}
      unreadCount={unreadCount}
      onToggleNotifications={() => {
        setShowNotifications((value) => !value)
        setShowProfile(false)
        setCommandOpen(false)
      }}
      notificationsOpen={showNotifications}
      notifications={
        showNotifications ? (
          <div className="popover notifications notification-center">
            <div className="notification-center-head">
              <strong>Notification center</strong>
              <button
                className="view-all"
                type="button"
                onClick={() => {
                  startTransition(async () => {
                    await markAllNotificationsRead()
                    setNotificationRows((rows) => rows.map((row) => ({ ...row, readAt: row.readAt ?? new Date() })))
                    setUnreadCount(0)
                  })
                }}
              >
                Mark all read
              </button>
            </div>
            <div className="notification-list">
              {notificationRows.length === 0 ? (
                <p className="empty-state">You are fully caught up.</p>
              ) : (
                notificationRows.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    className={notification.readAt ? 'notification-item read' : 'notification-item unread'}
                    onClick={() => {
                      startTransition(async () => {
                        await markNotificationRead(notification.id)
                        setNotificationRows((rows) =>
                          rows.map((row) => (row.id === notification.id ? { ...row, readAt: row.readAt ?? new Date() } : row)),
                        )
                        setUnreadCount((count) => (notification.readAt ? count : Math.max(0, count - 1)))
                      })
                    }}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                    <small>{formatRelative(notification.createdAt)}</small>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null
      }
      profileOpen={showProfile}
      onToggleProfile={() => {
        setShowProfile((value) => !value)
        setShowNotifications(false)
        setCommandOpen(false)
      }}
      profileMenu={
        showProfile ? (
          <div className="popover profile-popover">
            <strong>{fullName(user)}</strong>
            <span>{user.jobTitle}</span>
            <small>{currentUserRoles.map((role) => role.replaceAll('_', ' ')).join(' · ') || 'Employee'}</small>
            <form
              className="notification-preferences"
              action={async (formData) => {
                startTransition(async () => {
                  await updateNotificationPreferences(formData)
                  router.refresh()
                })
              }}
            >
              <strong>Alert preferences</strong>
              <label>
                <input type="checkbox" name="deadlineAlerts" defaultChecked={Boolean(preferences.deadlineAlerts)} /> Deadline
                alerts
              </label>
              <label>
                <input type="checkbox" name="escalationAlerts" defaultChecked={Boolean(preferences.escalationAlerts)} />{' '}
                Escalation alerts
              </label>
              <label>
                <input type="checkbox" name="approvalAlerts" defaultChecked={Boolean(preferences.approvalAlerts)} /> Approval
                alerts
              </label>
              <label>
                <input
                  type="checkbox"
                  name="managementRequestAlerts"
                  defaultChecked={Boolean(preferences.managementRequestAlerts)}
                />{' '}
                Management request alerts
              </label>
              <label>
                <input type="checkbox" name="dailySummary" defaultChecked={Boolean(preferences.dailySummary)} /> Daily and
                periodic summaries
              </label>
              <button type="submit">Save preferences</button>
            </form>
            <button
              type="button"
              disabled={signingOut}
              onClick={() => {
                if (signingOut) return
                setSigningOut(true)
                signOutToLogin()
              }}
            >
              {signingOut ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing out
                </>
              ) : (
                'Sign out'
              )}
            </button>
          </div>
        ) : null
      }
      currentName={fullName(user)}
      currentTitle={user.jobTitle}
      currentInitials={user.initials}
      currentAvatarUrl={user.avatarUrl}
      currentAvatarColor={user.avatarColor}
      companyName={companyName}
      breadcrumb="Profile"
      profileNavActive
      onOpenProfile={() => {
        setMobileOpen(false)
        setShowProfile(false)
      }}
    >
      <div className="page-wrap profile-page">
        <div className="welcome-row">
          <div>
            <p className="eyebrow">Account</p>
            <h1>Your profile</h1>
            <p className="subhead">
              Photo, name, email, password, and alerts — changes show everywhere you appear in {PRODUCT_NAME}.
            </p>
          </div>
        </div>
        <ProfileForm
          user={user}
          preferences={preferences}
          departmentName={departmentName}
          roleLabels={roleLabels}
          lastLoginLabel={lastLoginLabel}
        />
      </div>
    </WorkhubShell>
  )
}
