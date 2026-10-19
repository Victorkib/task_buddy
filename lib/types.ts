import type { users } from '@/lib/db/schema'

export type Person = Pick<
  typeof users.$inferSelect,
  'id' | 'firstName' | 'lastName' | 'jobTitle' | 'initials' | 'avatarColor' | 'avatarUrl' | 'departmentId'
>

export type CompanySummary = {
  id: string
  name: string
  shortName: string
  tagline: string | null
}

export type CurrentUser = Person & {
  companyId: string
  managerId?: string | null
  department?: { id: string; name: string; slug: string } | null
  manager?: { id: string; firstName: string; lastName: string } | null
  roles?: { role: { key: string; name: string } }[]
}
