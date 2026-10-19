'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { canAssignModuleAccess } from '@/lib/auth/permissions'
import {
  isWorkspaceModuleKey,
  normalizeCapability,
  type ModuleCapability,
  type WorkspaceModuleKey,
} from '@/lib/modules/catalog'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/db/queries'
import { moduleAccessGrants, users } from '@/lib/db/schema'

function refresh() {
  revalidatePath('/')
}

export async function saveModuleAccessGrant(input: {
  userId: string
  moduleKey: string
  canView: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canManageCurriculum: boolean
}) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' as const }
  if (!canAssignModuleAccess(currentUser)) {
    return { error: 'Only leadership can assign module access.' as const }
  }
  if (!isWorkspaceModuleKey(input.moduleKey)) {
    return { error: 'Unknown module.' as const }
  }
  const moduleKey: WorkspaceModuleKey = input.moduleKey

  const [person] = await getDb()
    .select({ id: users.id, companyId: users.companyId })
    .from(users)
    .where(and(eq(users.id, input.userId), eq(users.companyId, currentUser.companyId)))
    .limit(1)
  if (!person) return { error: 'That person is not in this workspace.' as const }

  const capability = normalizeCapability({
    canView: input.canView,
    canCreate: input.canCreate,
    canUpdate: input.canUpdate,
    canDelete: input.canDelete,
    canManageCurriculum: moduleKey === 'clients' ? input.canManageCurriculum : false,
  })

  const hasAny =
    capability.canView ||
    capability.canCreate ||
    capability.canUpdate ||
    capability.canDelete ||
    capability.canManageCurriculum

  const existing = await getDb().query.moduleAccessGrants.findFirst({
    where: and(
      eq(moduleAccessGrants.companyId, currentUser.companyId),
      eq(moduleAccessGrants.userId, input.userId),
      eq(moduleAccessGrants.moduleKey, moduleKey),
    ),
  })

  if (!hasAny) {
    if (existing) {
      await getDb().delete(moduleAccessGrants).where(eq(moduleAccessGrants.id, existing.id))
    }
    refresh()
    return { ok: true as const, notice: 'Module access cleared for that person.' }
  }

  const values = {
    canView: capability.canView,
    canCreate: capability.canCreate,
    canUpdate: capability.canUpdate,
    canDelete: capability.canDelete,
    canManageCurriculum: capability.canManageCurriculum,
    grantedById: currentUser.id,
    updatedAt: new Date(),
  }

  if (existing) {
    await getDb().update(moduleAccessGrants).set(values).where(eq(moduleAccessGrants.id, existing.id))
  } else {
    await getDb().insert(moduleAccessGrants).values({
      companyId: currentUser.companyId,
      userId: input.userId,
      moduleKey,
      ...values,
    })
  }

  refresh()
  return { ok: true as const, notice: 'Module access updated.' }
}

export async function clearModuleAccessGrant(userId: string, moduleKey: string) {
  return saveModuleAccessGrant({
    userId,
    moduleKey,
    canView: false,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    canManageCurriculum: false,
  })
}

export type { ModuleCapability }
