export const WORKSPACE_MODULES = [
  {
    key: 'clients',
    label: 'Client management',
    description: 'Directory, students, guardians, and academy intake.',
    supportsCurriculum: true,
  },
] as const

export type WorkspaceModuleKey = (typeof WORKSPACE_MODULES)[number]['key']

export type ModuleCapability = {
  canView: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  /** Clients: manage programmes and assign ops leads */
  canManageCurriculum: boolean
}

export type ModuleAccessGrantRecord = {
  id: string
  userId: string
  moduleKey: WorkspaceModuleKey
  canView: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canManageCurriculum: boolean
}

export const EMPTY_MODULE_CAPABILITY: ModuleCapability = {
  canView: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canManageCurriculum: false,
}

export function isWorkspaceModuleKey(value: string): value is WorkspaceModuleKey {
  return WORKSPACE_MODULES.some((module) => module.key === value)
}

export function capabilityFromGrant(
  grant: Pick<
    ModuleAccessGrantRecord,
    'canView' | 'canCreate' | 'canUpdate' | 'canDelete' | 'canManageCurriculum'
  > | null
    | undefined,
): ModuleCapability {
  if (!grant) return { ...EMPTY_MODULE_CAPABILITY }
  return {
    canView: Boolean(grant.canView),
    canCreate: Boolean(grant.canCreate),
    canUpdate: Boolean(grant.canUpdate),
    canDelete: Boolean(grant.canDelete),
    canManageCurriculum: Boolean(grant.canManageCurriculum),
  }
}

/** Creating/updating/deleting implies view. */
export function normalizeCapability(input: ModuleCapability): ModuleCapability {
  const canCreate = input.canCreate
  const canUpdate = input.canUpdate
  const canDelete = input.canDelete
  const canManageCurriculum = input.canManageCurriculum
  const canView = input.canView || canCreate || canUpdate || canDelete || canManageCurriculum
  return { canView, canCreate, canUpdate, canDelete, canManageCurriculum }
}
