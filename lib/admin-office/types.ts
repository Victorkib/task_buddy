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
