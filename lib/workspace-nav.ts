export const WORKSPACE_VIEWS = [
  'Home',
  'Overview',
  'My tasks',
  'Responsibilities',
  'Departments',
  'Projects',
  'Reports',
  'Activity',
  'Admin office',
  'My office',
  'Settings',
] as const

export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number]

export function isWorkspaceView(value: string | null | undefined): value is WorkspaceView {
  return Boolean(value && WORKSPACE_VIEWS.includes(value as WorkspaceView))
}

export function resolveWorkspaceView(
  raw: string | null | undefined,
  allowed: Set<WorkspaceView>,
  fallback: WorkspaceView,
  isManagement: boolean,
): WorkspaceView {
  const requested = isWorkspaceView(raw) ? raw : null
  if (isManagement && requested === 'Overview') {
    return allowed.has('Home') ? 'Home' : fallback
  }
  if (requested && allowed.has(requested)) return requested
  return fallback
}

export function workspaceViewHref(view: WorkspaceView, fallback: WorkspaceView) {
  const params = new URLSearchParams()
  params.set('view', view)
  if (view === fallback) {
    return `/?view=${encodeURIComponent(view)}`
  }
  return `/?view=${encodeURIComponent(view)}`
}
