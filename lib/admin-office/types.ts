export type LeaveType = 'annual' | 'sick' | 'compassionate' | 'unpaid' | 'study' | 'half_day'

export type AdminRequestKind = 'leave' | 'letter' | 'print' | 'imprest' | 'purchase' | 'equipment' | 'training'

export type AdminRequestStatus = 'submitted' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'completed'

export type OfficeLetterType = 'employment_confirmation' | 'introduction' | 'bank' | 'internship' | 'custom'

export type EmploymentType = 'permanent' | 'contract' | 'intern' | 'attachee' | 'volunteer' | 'part_time'

export type OfficePerson = {
  id: string
  name: string
  email: string
  jobTitle: string
  departmentId: string | null
  departmentName: string | null
  managerName: string | null
  status: string
  employmentType: EmploymentType
  startDate: string | null
  endDate: string | null
  probationEndDate: string | null
  annualPolicyDays: number
  sickPolicyDays: number
  thisYearAnnualHundredths: number
  annualAvailableHundredths: number
  sickAvailableHundredths: number
  annualUsedHundredths: number
  sickUsedHundredths: number
  carryOverHundredths: number
  emergencyName: string | null
  emergencyPhone: string | null
  notes: string | null
  missingStartDate: boolean
}

export type OfficeRequest = {
  id: string
  requestorId: string
  requestorName: string
  departmentName: string | null
  reviewerName: string | null
  kind: AdminRequestKind
  status: AdminRequestStatus
  title: string
  description: string | null
  leaveType: LeaveType | null
  startDate: string | null
  endDate: string | null
  daysHundredths: number
  amountKes: number
  copies: number
  confidential: boolean
  letterType: OfficeLetterType | null
  documentNumber: string | null
  generatedHtml: string | null
  coverageName: string | null
  attachmentUrl: string | null
  attachmentName: string | null
  decisionReason: string | null
  createdAt: string
  conflicts: string[]
  certificateMissing: boolean
  needsMd: boolean
}

export type OfficeOffer = {
  id: string
  candidateName: string
  candidateEmail: string | null
  jobTitle: string
  salaryText: string | null
  startDate: string | null
  probationMonths: number
  status: string
  documentNumber: string | null
  bodyHtml: string
  departmentId: string | null
  departmentName: string | null
  notes: string | null
  createdAt: string
}

export type OfficeDocument = {
  id: string
  title: string
  category: string
  status: string
  body: string | null
  fileUrl: string | null
  documentNumber: string | null
  effectiveDate: string | null
  reviewDate: string | null
  ackCount: number
  acknowledged: boolean
  staffCount: number
}

export type OfficeExpense = {
  id: string
  spentOn: string | null
  voucherNo: string | null
  description: string
  paidTo: string | null
  category: string | null
  amountCents: number | null
  paymentMethod: string | null
  receiptNo: string | null
  approvedBy: string | null
  remarks: string | null
}

export type OfficeVendor = {
  id: string
  name: string
  category: string
  renewalDate: string | null
  amountKes: number
  status: string
  notes: string | null
  ownerName: string | null
}

export type OfficeAsset = {
  id: string
  name: string
  assetTag: string | null
  status: string
  notes: string | null
  assignedUserId: string | null
  assignedName: string | null
}

export type OfficeComplianceItem = {
  id: string
  title: string
  category: string
  dueDate: string | null
  cadence: string
  status: 'upcoming' | 'due' | 'overdue' | 'done'
  notes: string | null
  ownerName: string | null
}

export type OfficeAlert = {
  id: string
  tone: 'attention' | 'calm'
  title: string
  detail: string
  desk: string
}

export type OfficeHoliday = { date: string; name: string }

export type OfficeOut = {
  requestId: string
  userId: string
  name: string
  departmentName: string | null
  leaveType: LeaveType | null
  startDate: string
  endDate: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

export type OfficeInvoiceSettings = {
  vatEnabled: boolean
  vatRateBps: number
  companyPin: string | null
}

export type OfficePaymentAccount = {
  id: string
  label: string
  kind: 'bank' | 'paybill' | 'other'
  details: string
  active: boolean
}

export type OfficeClient = {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  pin: string | null
  kind?: 'organization' | 'individual' | 'student' | 'guardian'
  status?: string
  selfPay?: boolean
}

export type OfficeInvoiceLine = {
  id: string
  description: string
  quantityHundredths: number
  rateCents: number
}

export type OfficeInvoice = {
  id: string
  documentNumber: string | null
  status: InvoiceStatus
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
  payments: { id: string; label: string; kind: 'bank' | 'paybill' | 'other'; details: string }[]
  notes: string | null
  lines: OfficeInvoiceLine[]
}

export type OfficeDesk = {
  ready: boolean
  setupMessage: string | null
  today: string
  pendingCount: number
  minePending: number
  me: OfficePerson | null
  people: OfficePerson[]
  requests: OfficeRequest[]
  offers: OfficeOffer[]
  documents: OfficeDocument[]
  expenses: OfficeExpense[]
  expenseCategories: string[]
  invoiceSettings: OfficeInvoiceSettings
  paymentAccounts: OfficePaymentAccount[]
  clients: OfficeClient[]
  invoices: OfficeInvoice[]
  mailReady: boolean
  vendors: OfficeVendor[]
  assets: OfficeAsset[]
  compliance: OfficeComplianceItem[]
  holidays: OfficeHoliday[]
  alerts: OfficeAlert[]
  outNow: OfficeOut[]
  departments: { id: string; name: string }[]
  coverOptions: { id: string; name: string }[]
  imprestOutstandingKes: number
  leaveLiabilityHundredths: number
}
