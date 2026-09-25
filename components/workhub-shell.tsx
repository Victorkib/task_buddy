'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type FocusEvent,
  type ReactNode,
} from 'react'
import {
  Bell,
  ChevronDown,
  CircleUser,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from 'lucide-react'
import { UserAvatar } from '@/components/user-avatar'
import type { WorkspaceView } from '@/lib/workspace-nav'

type NavItem = {
  label: WorkspaceView
  /** What the viewer sees. `label` stays the routing key so URLs are role-independent. */
  displayLabel?: string
  icon: ComponentType<{ 'aria-hidden'?: boolean }>
  count?: number
  group: string
}

function BrandMark() {
  return (
    <svg className="brand-mark-svg" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M15.2 7.2h11.4l5.7 9.9-5.7 9.9H15.2L9.5 17.1 15.2 7.2Z"
        stroke="#60a5fa"
        strokeWidth="3.6"
        strokeLinejoin="round"
      />
      <path
        d="M21.4 21h11.4l5.7 9.9-5.7 9.9H21.4l-5.7-9.9L21.4 21Z"
        stroke="#22c55e"
        strokeWidth="3.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WorkhubShell({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onMobileOpen,
  onMobileClose,
  navItems,
  activeNav,
  onNavigate,
  searchQuery,
  onSearchChange,
  onOpenCommand,
  commandOpen,
  onCloseCommand,
  commandResults,
  onSelectCommand,
  unreadCount,
  onToggleNotifications,
  notificationsOpen,
  notifications,
  profileOpen,
  onToggleProfile,
  profileMenu,
  currentName,
  currentTitle,
  currentInitials,
  currentAvatarUrl,
  currentAvatarColor,
  companyName,
  companyShortName = 'GCS',
  breadcrumb,
  profileNavActive = false,
  onOpenProfile,
  children,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
  mobileOpen: boolean
  onMobileOpen: () => void
  onMobileClose: () => void
  navItems: NavItem[]
  activeNav: WorkspaceView | null
  onNavigate: (view: WorkspaceView) => void
  searchQuery: string
  onSearchChange: (value: string) => void
  onOpenCommand: () => void
  commandOpen: boolean
  onCloseCommand: () => void
  commandResults: { id: string; label: string; hint: string; onSelect: () => void }[]
  onSelectCommand: (id: string) => void
  unreadCount: number
  onToggleNotifications: () => void
  notificationsOpen: boolean
  notifications: ReactNode
  profileOpen: boolean
  onToggleProfile: () => void
  profileMenu: ReactNode
  currentName: string
  currentTitle: string
  currentInitials: string
  currentAvatarUrl?: string | null
  currentAvatarColor?: string | null
  companyName: string
  companyShortName?: string
  breadcrumb: string
  profileNavActive?: boolean
  onOpenProfile?: () => void
  children: ReactNode
}) {
  const groups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, NavItem[]>()
    for (const item of navItems) {
      if (!map.has(item.group)) {
        map.set(item.group, [])
        order.push(item.group)
      }
      map.get(item.group)!.push(item)
    }
    return order.map((group) => ({ group, items: map.get(group)! }))
  }, [navItems])

  const [peek, setPeek] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [openGroups, setOpenGroups] = useState<string[]>(() => groups.map((entry) => entry.group))
  const [commandActiveIndex, setCommandActiveIndex] = useState(0)
  const railOpen = !collapsed || peek

  useEffect(() => {
    const activeGroup = groups.find((entry) => entry.items.some((item) => item.label === activeNav))?.group
    if (!activeGroup) return
    setOpenGroups((current) => (current.includes(activeGroup) ? current : [...current, activeGroup]))
  }, [activeNav, groups])

  useEffect(() => {
    if (!commandOpen) {
      setCommandActiveIndex(0)
      return
    }
    setCommandActiveIndex(0)
  }, [commandOpen, searchQuery, commandResults.length])

  function clearLeaveTimer() {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }

  function handleRailEnter() {
    if (!collapsed) return
    clearLeaveTimer()
    setPeek(true)
  }

  function handleRailLeave() {
    if (!collapsed) return
    clearLeaveTimer()
    leaveTimer.current = setTimeout(() => setPeek(false), 140)
  }

  function handleRailBlur(event: FocusEvent<HTMLElement>) {
    if (!collapsed) return
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setPeek(false)
  }

  function toggleGroup(group: string) {
    const holdsActive = groups
      .find((entry) => entry.group === group)
      ?.items.some((item) => item.label === activeNav)
    setOpenGroups((current) => {
      const isOpen = current.includes(group)
      if (isOpen && holdsActive) return current
      return isOpen ? current.filter((name) => name !== group) : [...current, group]
    })
  }

  function renderNav(onPick: (view: WorkspaceView) => void) {
    return groups.map(({ group, items }) => {
      const groupOpen = railOpen ? openGroups.includes(group) : true
      const holdsActive = items.some((item) => item.label === activeNav)
      return (
        <div key={group} className={`nav-group${groupOpen ? ' is-open' : ''}${holdsActive ? ' has-active' : ''}`}>
          {railOpen ? (
            <button
              type="button"
              className="nav-caption"
              onClick={() => toggleGroup(group)}
              aria-expanded={groupOpen}
            >
              <span>{group}</span>
              <ChevronDown aria-hidden={true} />
            </button>
          ) : (
            <span className="nav-caption">{group}</span>
          )}
          <div className={`nav-group-body${groupOpen ? ' is-open' : ''}`}>
            <div className="nav-group-inner">
              {items.map(({ label, displayLabel, icon: Icon, count }) => {
                const text = displayLabel ?? label
                return (
                  <button
                    key={label}
                    type="button"
                    className={activeNav === label ? 'nav-item active' : 'nav-item'}
                    data-label={text}
                    title={text}
                    aria-label={typeof count === 'number' && count > 0 ? `${text}, ${count} items` : text}
                    aria-current={activeNav === label ? 'page' : undefined}
                    onClick={() => onPick(label)}
                  >
                    <Icon aria-hidden={true} />
                    <span>{text}</span>
                    {typeof count === 'number' && count > 0 && <em>{count > 9 ? '9+' : count}</em>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )
    })
  }

  return (
    <main
      className={`workhub-shell${collapsed ? ' sidebar-collapsed' : ''}${peek && collapsed ? ' sidebar-peek' : ''}`}
    >
      <div className="sidebar-slot">
        <aside
          className="workhub-sidebar"
          aria-label="Workspace"
          onMouseEnter={handleRailEnter}
          onMouseLeave={handleRailLeave}
          onFocus={handleRailEnter}
          onBlur={handleRailBlur}
        >
          <div className="brand-lockup">
            <BrandMark />
            <div>
              <strong>GCS</strong>
              <span>Task Buddy</span>
            </div>
          </div>
          <div className="workspace-chip" title={companyName}>
            <div className="workspace-icon">{(companyShortName || companyName).slice(0, 1).toUpperCase()}</div>
            <div className="workspace-chip-copy">
              <span>Workspace</span>
              <strong className="workspace-name-full">{companyName}</strong>
              <strong className="workspace-name-short">{companyShortName || 'GCS'}</strong>
            </div>
          </div>
          <nav className="primary-nav">{renderNav(onNavigate)}</nav>
          <div className="sidebar-bottom">
            {onOpenProfile ? (
              <button
                type="button"
                className={profileNavActive ? 'nav-item active' : 'nav-item'}
                data-label="Profile"
                title="Profile"
                aria-current={profileNavActive ? 'page' : undefined}
                onClick={() => {
                  setPeek(false)
                  onOpenProfile()
                }}
              >
                <CircleUser aria-hidden={true} />
                <span>Profile</span>
              </button>
            ) : null}
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => {
                setPeek(false)
                onToggleCollapsed()
              }}
              aria-label={collapsed ? 'Keep sidebar expanded' : 'Collapse sidebar to icons'}
              title={collapsed ? 'Keep sidebar expanded' : 'Collapse sidebar to icons'}
            >
              {collapsed ? <PanelLeftOpen aria-hidden={true} /> : <PanelLeftClose aria-hidden={true} />}
              <span>{collapsed ? 'Keep open' : 'Collapse'}</span>
            </button>
          </div>
        </aside>
      </div>

      {mobileOpen && (
        <div className="mobile-nav-backdrop" onMouseDown={onMobileClose}>
          <div
            className="mobile-nav-drawer"
            role="dialog"
            aria-label="Navigation"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="brand-lockup">
              <BrandMark />
              <div>
                <strong>GCS</strong>
                <span>Task Buddy</span>
              </div>
              <button className="close-button" type="button" aria-label="Close navigation" onClick={onMobileClose}>
                <X aria-hidden={true} />
              </button>
            </div>
            <nav className="primary-nav">{renderNav(onNavigate)}</nav>
            {onOpenProfile ? (
              <div className="sidebar-bottom mobile-profile-nav">
                <button
                  type="button"
                  className={profileNavActive ? 'nav-item active' : 'nav-item'}
                  aria-current={profileNavActive ? 'page' : undefined}
                  onClick={() => {
                    onMobileClose()
                    onOpenProfile()
                  }}
                >
                  <CircleUser aria-hidden={true} />
                  <span>Profile</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <section className="workhub-content">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Open navigation" onClick={onMobileOpen}>
            <Menu aria-hidden={true} />
          </button>
          <div className="breadcrumbs">
            <span>{companyName}</span>
            <span>/</span>
            <strong>{breadcrumb}</strong>
          </div>
          <div className="topbar-actions">
            <button type="button" className="search-field search-field-button" onClick={onOpenCommand}>
              <Search aria-hidden={true} />
              <span>{searchQuery || 'Search tasks, people, projects...'}</span>
              <kbd>⌘K</kbd>
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Notifications"
              onClick={onToggleNotifications}
            >
              <Bell aria-hidden={true} />
              {unreadCount > 0 && <i aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</i>}
            </button>
            <button className="profile-button" type="button" onClick={onToggleProfile}>
              <UserAvatar initials={currentInitials} url={currentAvatarUrl} color={currentAvatarColor} />
              <span className="profile-copy">
                <strong>{currentName}</strong>
                <small>{currentTitle}</small>
              </span>
              <ChevronDown aria-hidden={true} />
            </button>
          </div>
        </header>
        {notificationsOpen && notifications}
        {profileOpen && profileMenu}
        <div className="workhub-scroll">{children}</div>
      </section>

      {commandOpen && (
        <div className="command-backdrop" role="presentation" onMouseDown={onCloseCommand}>
          <div
            className="command-palette"
            role="dialog"
            aria-label="Search workspace"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <label className="command-input">
              <Search aria-hidden={true} />
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search tasks, people, projects, and views"
                aria-label="Command search"
                aria-activedescendant={
                  commandResults[commandActiveIndex]
                    ? `command-result-${commandResults[commandActiveIndex]!.id}`
                    : undefined
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onCloseCommand()
                    return
                  }
                  if (commandResults.length === 0) return
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setCommandActiveIndex((current) => (current + 1) % commandResults.length)
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setCommandActiveIndex((current) =>
                      (current - 1 + commandResults.length) % commandResults.length,
                    )
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const active = commandResults[commandActiveIndex] ?? commandResults[0]
                    if (active) onSelectCommand(active.id)
                  }
                }}
              />
              <kbd className="command-hint">↑↓ Enter</kbd>
            </label>
            <div className="command-results" role="listbox" aria-label="Search results">
              {commandResults.length === 0 ? (
                <p className="empty-state">No matches.</p>
              ) : (
                commandResults.map((result, index) => (
                  <button
                    key={result.id}
                    id={`command-result-${result.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === commandActiveIndex}
                    className={`command-result${index === commandActiveIndex ? ' is-active' : ''}`}
                    onMouseEnter={() => setCommandActiveIndex(index)}
                    onClick={() => onSelectCommand(result.id)}
                  >
                    <strong>{result.label}</strong>
                    <span>{result.hint}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

const SIDEBAR_KEY = 'gcs-workhub-sidebar-collapsed'

function subscribeSidebar(callback: () => void) {
  window.addEventListener('gcs-sidebar', callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener('gcs-sidebar', callback)
    window.removeEventListener('storage', callback)
  }
}

export function useCollapsedSidebar() {
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    () => window.localStorage.getItem(SIDEBAR_KEY) === '1',
    () => false,
  )

  function toggle() {
    const next = window.localStorage.getItem(SIDEBAR_KEY) === '1' ? '0' : '1'
    window.localStorage.setItem(SIDEBAR_KEY, next)
    window.dispatchEvent(new Event('gcs-sidebar'))
  }

  return { collapsed, toggle }
}
