export const CLIENT_KINDS = ['organization', 'individual', 'student', 'guardian'] as const
export type ClientKind = (typeof CLIENT_KINDS)[number]

export const CLIENT_STATUSES = [
  'enquiry',
  'registration_initiated',
  'enrolled',
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
  registration_initiated: 'Registration Initiated',
  enrolled: 'Enrolled',
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

/** Wording seen from the parent / payer's record. */
export const PARENT_SIDE_LABELS: Record<ClientLinkRelation, string> = {
  guardian_of: 'Parent / guardian of',
  payer_for: 'Pays fees for',
  related_to: 'Related to',
}

/** Wording seen from the student's record. */
export const CHILD_SIDE_LABELS: Record<ClientLinkRelation, string> = {
  guardian_of: 'Parent / guardian',
  payer_for: 'Fee payer',
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

export type ClientInvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

export type ClientInvoiceLine = {
  id: string
  description: string
  quantityHundredths: number
  rateCents: number
  subjectClientId: string | null
}

export type ClientInvoiceView = {
  id: string
  documentNumber: string | null
  status: ClientInvoiceStatus
  issueDate: string
  dueDate: string | null
  clientId: string | null
  clientName: string
  clientEmail: string | null
  clientPhone: string | null
  clientAddress: string | null
  clientPin: string | null
  vatEnabled: boolean
  vatRateBps: number
  companyPin: string | null
  paymentIds: string[]
  notes: string | null
  createdById: string | null
  lines: ClientInvoiceLine[]
}

export type ClientPaymentAccount = {
  id: string
  label: string
  kind: 'bank' | 'paybill' | 'other'
  details: string
  active: boolean
}

/** Invoicing from the Clients portal. Full client access issues; create-only staff prepare drafts. */
export type ClientBilling = {
  ready: boolean
  setupMessage: string | null
  today: string
  /** Full client access or the admin office: may send, mark paid, void, and edit sent invoices. */
  canIssue: boolean
  currentUserId: string
  mailReady: boolean
  invoiceSettings: { vatEnabled: boolean; vatRateBps: number; companyPin: string | null }
  paymentAccounts: ClientPaymentAccount[]
  invoices: ClientInvoiceView[]
}

export type ClientDesk = {
  clients: ClientRecord[]
  programmes: AcademyProgrammeRecord[]
  canManageCurriculum: boolean
  canManageBilling: boolean
  academyProgrammeIds: string[]
  capabilities: ClientDeskCapabilities
  billing: ClientBilling | null
}
