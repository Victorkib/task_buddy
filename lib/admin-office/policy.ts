import type { AdminRequestKind, EmploymentType, LeaveType, OfficeLetterType } from '@/lib/admin-office/types'

/** Working days of annual leave that still go to the managing director. */
export const MD_LEAVE_WORKING_DAYS = 10

/** Imprest or purchase at or above this amount waits for the managing director. */
export const MD_SPEND_KES = 10_000

/** Unused annual leave carried into the next year, in hundredths of a day. */
export const CARRY_CAP_HUNDREDTHS = 10 * 100

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  compassionate: 'Compassionate leave',
  unpaid: 'Unpaid leave',
  study: 'Study leave',
  half_day: 'Half day',
}

export const REQUEST_KIND_LABELS: Record<AdminRequestKind, string> = {
  leave: 'Leave',
  letter: 'Letter',
  print: 'Print job',
  imprest: 'Imprest',
  purchase: 'Purchase',
  equipment: 'Equipment',
  training: 'Training',
}

export const LETTER_TYPE_LABELS: Record<OfficeLetterType, string> = {
  employment_confirmation: 'Employment confirmation',
  introduction: 'Introduction letter',
  bank: 'Bank / account letter',
  internship: 'Internship or attachment letter',
  custom: 'Other letter',
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  permanent: 'Permanent',
  contract: 'Contract',
  intern: 'Intern',
  attachee: 'Attachee',
  volunteer: 'Volunteer',
  part_time: 'Part-time',
}

export const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  awaiting_md: 'With the MD',
  issued: 'Issued',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

export function requestNeedsMd(input: { kind: string; daysHundredths: number; amountKes: number }) {
  if (input.kind === 'leave' && input.daysHundredths > MD_LEAVE_WORKING_DAYS * 100) return true
  if ((input.kind === 'imprest' || input.kind === 'purchase') && input.amountKes >= MD_SPEND_KES) return true
  return false
}

export function requestStatusLabel(kind: string, status: string) {
  if (kind === 'print' && status === 'approved') return 'Printing'
  if (kind === 'print' && status === 'completed') return 'Ready for pickup'
  if (kind === 'imprest' && status === 'approved') return 'Issued'
  if (kind === 'imprest' && status === 'completed') return 'Retired'
  if (kind === 'purchase' && status === 'approved') return 'Approved to buy'
  if (kind === 'purchase' && status === 'completed') return 'Bought'
  if (status === 'submitted') return 'Submitted'
  if (status === 'in_review') return 'With the MD'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'completed') return 'Completed'
  return status
}

export function formatHundredths(value: number) {
  const days = value / 100
  const rounded = Math.round(days * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatKes(value: number) {
  const rounded = Math.round(value).toString()
  return `KES ${rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function defaultEmployment(input: { departmentSlug?: string | null; jobTitle?: string | null }): {
  employmentType: EmploymentType
  annual: number
  sick: number
} {
  const slug = input.departmentSlug ?? ''
  const title = (input.jobTitle ?? '').toLowerCase()
  if (slug === 'interns' || title.includes('intern')) return { employmentType: 'intern', annual: 0, sick: 7 }
  if (slug === 'attachees' || title.includes('attachee')) return { employmentType: 'attachee', annual: 0, sick: 0 }
  if (slug === 'volunteers' || title.includes('volunteer')) return { employmentType: 'volunteer', annual: 0, sick: 0 }
  if (title.includes('part-time') || title.includes('part time')) return { employmentType: 'part_time', annual: 10, sick: 7 }
  if (title.includes('contract')) return { employmentType: 'contract', annual: 21, sick: 7 }
  return { employmentType: 'permanent', annual: 21, sick: 7 }
}

export function statutoryReminders(today: string) {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const day = Number(today.slice(8, 10))
  const nextOnDay = (dueDay: number) => {
    let y = year
    let m = month
    if (day > dueDay) {
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`
  }
  const nita = `${year}-12-31` < today ? `${year + 1}-12-31` : `${year}-12-31`
  return [
    {
      title: 'PAYE return',
      category: 'statutory',
      dueDate: nextOnDay(9),
      cadence: 'monthly',
      notes: 'A calendar reminder. File the return in the tax system, then mark this done so next month is scheduled.',
    },
    {
      title: 'NSSF contribution',
      category: 'statutory',
      dueDate: nextOnDay(15),
      cadence: 'monthly',
      notes: 'A calendar reminder for the NSSF deadline.',
    },
    {
      title: 'SHIF contribution',
      category: 'statutory',
      dueDate: nextOnDay(9),
      cadence: 'monthly',
      notes: 'A calendar reminder for the SHIF deadline.',
    },
    {
      title: 'NITA levy',
      category: 'statutory',
      dueDate: nita,
      cadence: 'annual',
      notes: 'Annual training-levy reminder.',
    },
  ]
}
