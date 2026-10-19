'use client'

import { useMemo, useState, useTransition } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { clearModuleAccessGrant, saveModuleAccessGrant } from '@/app/module-access-actions'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/user-avatar'
import {
  WORKSPACE_MODULES,
  type ModuleAccessGrantRecord,
  type ModuleCapability,
  type WorkspaceModuleKey,
} from '@/lib/modules/catalog'
import type { Person } from '@/lib/types'

type PersonOption = Person & { status?: string }

function blankCap(): ModuleCapability {
  return {
    canView: false,
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    canManageCurriculum: false,
  }
}

function fromGrant(grant: ModuleAccessGrantRecord | undefined): ModuleCapability {
  if (!grant) return blankCap()
  return {
    canView: grant.canView,
    canCreate: grant.canCreate,
    canUpdate: grant.canUpdate,
    canDelete: grant.canDelete,
    canManageCurriculum: grant.canManageCurriculum,
  }
}

export function ModuleAccessPanel({
  people,
  grants,
  onSaved,
}: {
  people: PersonOption[]
  grants: ModuleAccessGrantRecord[]
  onSaved?: () => void
}) {
  const [moduleKey, setModuleKey] = useState<WorkspaceModuleKey>('clients')
  const [userId, setUserId] = useState(people[0]?.id ?? '')
  const [cap, setCap] = useState<ModuleCapability>(blankCap())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const moduleMeta = WORKSPACE_MODULES.find((entry) => entry.key === moduleKey) ?? WORKSPACE_MODULES[0]

  const grantsForModule = useMemo(
    () => grants.filter((grant) => grant.moduleKey === moduleKey),
    [grants, moduleKey],
  )

  const grantByUser = useMemo(() => {
    const map = new Map<string, ModuleAccessGrantRecord>()
    for (const grant of grantsForModule) map.set(grant.userId, grant)
    return map
  }, [grantsForModule])

  function selectPerson(nextUserId: string) {
    setUserId(nextUserId)
    setCap(fromGrant(grantByUser.get(nextUserId)))
    setError(null)
    setNotice(null)
  }

  function selectModule(next: WorkspaceModuleKey) {
    setModuleKey(next)
    setCap(fromGrant(grants.find((grant) => grant.moduleKey === next && grant.userId === userId)))
    setError(null)
    setNotice(null)
  }

  function toggle(key: keyof ModuleCapability) {
    setCap((current) => {
      const next = { ...current, [key]: !current[key] }
      if (key !== 'canView' && next[key]) next.canView = true
      if (key === 'canView' && !next.canView) {
        next.canCreate = false
        next.canUpdate = false
        next.canDelete = false
        next.canManageCurriculum = false
      }
      return next
    })
  }

  function save() {
    if (!userId) {
      setError('Choose a person.')
      return
    }
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await saveModuleAccessGrant({
        userId,
        moduleKey,
        ...cap,
      })
      if ('error' in result && result.error) {
        setError(result.error)
        return
      }
      if ('ok' in result && result.ok) {
        setNotice(result.notice)
        onSaved?.()
      }
    })
  }

  function clear(targetUserId: string) {
    setError(null)
    startTransition(async () => {
      const result = await clearModuleAccessGrant(targetUserId, moduleKey)
      if ('error' in result && result.error) {
        setError(result.error)
        return
      }
      if ('ok' in result && result.ok) {
        setNotice(result.notice)
        if (targetUserId === userId) setCap(blankCap())
        onSaved?.()
      }
    })
  }

  const activePeople = people.filter((person) => person.status !== 'inactive')

  return (
    <section className="panel module-access-panel">
      <div className="panel-heading">
        <div>
          <h2>Module access</h2>
          <p>
            Let leadership open specific workspaces for people beyond their default role — for example Client management
            view and CRUD.
          </p>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}

      <div className="module-access-layout">
        <div className="module-access-editor">
          <div className="module-access-module-pills" role="tablist" aria-label="Modules">
            {WORKSPACE_MODULES.map((module) => (
              <button
                key={module.key}
                type="button"
                role="tab"
                aria-selected={moduleKey === module.key}
                className={`filter-pill${moduleKey === module.key ? ' selected' : ''}`}
                onClick={() => selectModule(module.key)}
              >
                {module.label}
              </button>
            ))}
          </div>

          <p className="field-hint">{moduleMeta.description}</p>

          <label className="form-field">
            <span>Person</span>
            <select
              value={userId}
              onChange={(event) => selectPerson(event.target.value)}
            >
              <option value="">Choose someone…</option>
              {activePeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.firstName} {person.lastName}
                  {person.jobTitle ? ` · ${person.jobTitle}` : ''}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="module-access-caps">
            <legend>
              <KeyRound aria-hidden="true" /> Capabilities for {moduleMeta.label}
            </legend>
            {(
              [
                ['canView', 'View', 'Open the module and read records'],
                ['canCreate', 'Create', 'Add new records'],
                ['canUpdate', 'Edit', 'Change existing records'],
                ['canDelete', 'Delete', 'Remove records'],
                ...(moduleMeta.supportsCurriculum
                  ? ([['canManageCurriculum', 'Curriculum', 'Manage programmes and assign ops leads']] as const)
                  : []),
              ] as const
            ).map(([key, label, hint]) => (
              <label key={key} className="module-access-cap">
                <input type="checkbox" checked={cap[key]} onChange={() => toggle(key)} disabled={isPending || !userId} />
                <span>
                  <strong>{label}</strong>
                  <em>{hint}</em>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="row-actions">
            <Button type="button" className="create-button" disabled={isPending || !userId} onClick={save}>
              {isPending ? 'Saving…' : 'Save access'}
            </Button>
            {userId && grantByUser.has(userId) ? (
              <Button type="button" variant="outline" disabled={isPending} onClick={() => clear(userId)}>
                Clear grant
              </Button>
            ) : null}
          </div>
        </div>

        <div className="module-access-roster">
          <header>
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>Who has access</strong>
              <p>People with an explicit grant for {moduleMeta.label}. Role-based access (finance, leadership, programme leads) still applies without a grant.</p>
            </div>
          </header>
          {grantsForModule.length === 0 ? (
            <p className="empty-state empty-state-compact">No explicit grants yet for this module.</p>
          ) : (
            <ul className="module-access-list">
              {grantsForModule.map((grant) => {
                const person = people.find((entry) => entry.id === grant.userId)
                if (!person) return null
                const bits = [
                  grant.canView ? 'View' : null,
                  grant.canCreate ? 'Create' : null,
                  grant.canUpdate ? 'Edit' : null,
                  grant.canDelete ? 'Delete' : null,
                  grant.canManageCurriculum ? 'Curriculum' : null,
                ].filter(Boolean)
                return (
                  <li key={grant.id}>
                    <button type="button" className="module-access-person" onClick={() => selectPerson(person.id)}>
                      <UserAvatar
                        initials={person.initials}
                        url={person.avatarUrl}
                        color={person.avatarColor}
                        size="sm"
                      />
                      <span>
                        <strong>
                          {person.firstName} {person.lastName}
                        </strong>
                        <em>{bits.join(' · ') || 'No capabilities'}</em>
                      </span>
                    </button>
                    <button type="button" className="attachment-remove" disabled={isPending} onClick={() => clear(person.id)}>
                      Revoke
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
