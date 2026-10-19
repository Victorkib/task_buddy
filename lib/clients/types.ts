export const CLIENT_KINDS = ['organization', 'individual', 'student', 'guardian'] as const
export type ClientKind = (typeof CLIENT_KINDS)[number]

export const CLIENT_STATUSES = [
  'enquiry',
  'registered',
  'active',
  'paused',
  'completed',
  'archived',
] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

export const CLIENT_LINK_RELATIONS = ['guardian_of', 'payer_for', 'related_to'] as const
export type ClientLinkRelation = (typeof CLIENT_LINK_RELATIONS)[number]

export const CLIENT_KIND_LABELS: Record<ClientKind, string> = {
  organization: 'Organization',
  individual: 'Individual',
  student: 'Student',
  guardian: 'Guardian / parent',
}

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  enquiry: 'Enquiry',
  registered: 'Registered',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
}

export const CLIENT_LINK_LABELS: Record<ClientLinkRelation, string> = {
  guardian_of: 'Guardian of',
  payer_for: 'Pays for',
  related_to: 'Related to',
}

export type ClientLinkView = {
  id: string
  relation: ClientLinkRelation
  otherId: string
  otherName: string
  otherKind: ClientKind
  direction: 'from' | 'to'
}

export type ClientRecord = {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  pin: string | null
  kind: ClientKind
  status: ClientStatus
  tags: string[]
  specification: string | null
  notes: string | null
  source: string | null
  dateOfBirth: string | null
  programmeId: string | null
  programmeName: string | null
  selfPay: boolean
  createdAt: string | Date
  updatedAt: string | Date
  links: ClientLinkView[]
}

export type AcademyProgrammeRecord = {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  leadIds: string[]
  leadNames: string[]
  studentCount: number
}

export type ClientDeskCapabilities = {
  canView: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  canManageCurriculum: boolean
  /** See organisations / individuals (not only academy students). */
  fullDirectory: boolean
  /** Limited to programmes this person leads. */
  academyScoped: boolean
}

export type ClientDesk = {
  clients: ClientRecord[]
  programmes: AcademyProgrammeRecord[]
  canManageCurriculum: boolean
  canManageBilling: boolean
  academyProgrammeIds: string[]
  capabilities: ClientDeskCapabilities
}
