import { and, eq } from 'drizzle-orm'
import {
  capabilityFromGrant,
  isWorkspaceModuleKey,
  type ModuleAccessGrantRecord,
  type ModuleCapability,
  type WorkspaceModuleKey,
} from '@/lib/modules/catalog'
import { getDb } from '@/lib/db'
import { moduleAccessGrants } from '@/lib/db/schema'

function mapGrant(row: typeof moduleAccessGrants.$inferSelect): ModuleAccessGrantRecord | null {
  if (!isWorkspaceModuleKey(row.moduleKey)) return null
  return {
    id: row.id,
    userId: row.userId,
    moduleKey: row.moduleKey,
    canView: row.canView,
    canCreate: row.canCreate,
    canUpdate: row.canUpdate,
    canDelete: row.canDelete,
    canManageCurriculum: row.canManageCurriculum,
  }
}

export async function listModuleAccessGrants(companyId: string): Promise<ModuleAccessGrantRecord[]> {
  const rows = await getDb()
    .select()
    .from(moduleAccessGrants)
    .where(eq(moduleAccessGrants.companyId, companyId))
  return rows.map(mapGrant).filter((row): row is ModuleAccessGrantRecord => Boolean(row))
}

export async function getUserModuleGrant(
  companyId: string,
  userId: string,
  moduleKey: WorkspaceModuleKey,
): Promise<ModuleCapability> {
  const [row] = await getDb()
    .select()
    .from(moduleAccessGrants)
    .where(
      and(
        eq(moduleAccessGrants.companyId, companyId),
        eq(moduleAccessGrants.userId, userId),
        eq(moduleAccessGrants.moduleKey, moduleKey),
      ),
    )
    .limit(1)
  return capabilityFromGrant(row ? mapGrant(row) : null)
}

export async function getUserModuleGrants(
  companyId: string,
  userId: string,
): Promise<Partial<Record<WorkspaceModuleKey, ModuleCapability>>> {
  const rows = await getDb()
    .select()
    .from(moduleAccessGrants)
    .where(and(eq(moduleAccessGrants.companyId, companyId), eq(moduleAccessGrants.userId, userId)))
  const result: Partial<Record<WorkspaceModuleKey, ModuleCapability>> = {}
  for (const row of rows) {
    const mapped = mapGrant(row)
    if (!mapped) continue
    result[mapped.moduleKey] = capabilityFromGrant(mapped)
  }
  return result
}
