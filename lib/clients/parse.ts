import type { ClientKind, ClientLinkRelation, ClientStatus } from '@/lib/clients/types'
import { CLIENT_KINDS, CLIENT_LINK_RELATIONS, CLIENT_STATUSES } from '@/lib/clients/types'

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(
        parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 24),
      ),
    ]
  } catch {
    return raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 24)
  }
}

export function serializeTags(tags: string[]) {
  return JSON.stringify(
    [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 24),
  )
}

export function isClientKind(value: string): value is ClientKind {
  return (CLIENT_KINDS as readonly string[]).includes(value)
}

export function isClientStatus(value: string): value is ClientStatus {
  return (CLIENT_STATUSES as readonly string[]).includes(value)
}

export function isClientLinkRelation(value: string): value is ClientLinkRelation {
  return (CLIENT_LINK_RELATIONS as readonly string[]).includes(value)
}
