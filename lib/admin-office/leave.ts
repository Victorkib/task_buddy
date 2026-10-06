import { isKenyaWorkingDay, kenyaPublicHolidays, listKenyaHolidaysInRange } from '@/lib/admin-office/kenya-calendar'
import { CARRY_CAP_HUNDREDTHS } from '@/lib/admin-office/policy'

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return isoDate(parseIsoDate(value)) === value
}

export function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

export function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function nairobiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts.slice(0, 10)
}

export function addDaysIso(value: string, days: number) {
  const date = parseIsoDate(value)
  date.setDate(date.getDate() + days)
  return isoDate(date)
}

export function addMonthsIso(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number)
  const cursor = new Date(year, month - 1 + months, 1)
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  cursor.setDate(Math.min(day, lastDay))
  return isoDate(cursor)
}

export function addCadence(value: string, cadence: string) {
  if (cadence === 'monthly') return addMonthsIso(value, 1)
  if (cadence === 'quarterly') return addMonthsIso(value, 3)
  if (cadence === 'annual') return addMonthsIso(value, 12)
  return value
}

export function holidaysBetween(startIso: string, endIso: string) {
  const start = parseIsoDate(startIso)
  const end = parseIsoDate(endIso)
  const map = new Map<string, string>()
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    for (const [date, name] of kenyaPublicHolidays(year)) map.set(date, name)
  }
  return map
}

export function countWorkingDays(startIso: string, endIso: string) {
  if (!isIsoDate(startIso) || !isIsoDate(endIso) || endIso < startIso) return 0
  const holidays = holidaysBetween(startIso, endIso)
  const cursor = parseIsoDate(startIso)
  const end = parseIsoDate(endIso)
  let days = 0
  while (cursor <= end) {
    if (isKenyaWorkingDay(cursor, holidays)) days += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function leaveSpanHundredths(
  leaveType: string,
  startDate: string,
  endDate: string,
): { daysHundredths: number } | { error: string } {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return { error: 'Choose a start and end date.' }
  if (endDate < startDate) return { error: 'The end date has to be on or after the start date.' }
  if (leaveType === 'half_day') {
    if (startDate !== endDate) return { error: 'A half day uses a single date.' }
    if (!isKenyaWorkingDay(parseIsoDate(startDate))) {
      return { error: 'That date is a weekend or a Kenya public holiday.' }
    }
    return { daysHundredths: 50 }
  }
  const days = countWorkingDays(startDate, endDate)
  if (days <= 0) {
    return { error: 'That range has no working days. Weekends and Kenya public holidays are already excluded.' }
  }
  if (days > 130) return { error: 'Split leave longer than six months into more than one request.' }
  return { daysHundredths: days * 100 }
}

/** Full-year policy days, reduced when someone joined during the leave year. */
export function proratedAnnualHundredths(entitlementDays: number, startDate: string | null, year: number) {
  const full = Math.max(0, entitlementDays) * 100
  if (!startDate || !isIsoDate(startDate)) return full
  const start = parseIsoDate(startDate)
  if (start.getFullYear() < year) return full
  if (start.getFullYear() > year) return 0
  const months = 12 - start.getMonth()
  return Math.round((full * months) / 12)
}

export function annualAvailableHundredths(input: {
  annualEntitlementDays: number
  carryOverHundredths: number
  annualUsedHundredths: number
  startDate: string | null
  leaveYear: number
}) {
  return (
    proratedAnnualHundredths(input.annualEntitlementDays, input.startDate, input.leaveYear) +
    input.carryOverHundredths -
    input.annualUsedHundredths
  )
}

export function rangesOverlap(startA: string, endA: string, startB: string, endB: string) {
  return startA <= endB && startB <= endA
}

export function rollLeaveYear<T extends {
  leaveYear: number
  annualEntitlementDays: number
  carryOverHundredths: number
  annualUsedHundredths: number
  sickUsedHundredths: number
  unpaidUsedHundredths: number
  startDate: string | null
}>(profile: T, year: number): T {
  let cursor = profile
  let guard = 0
  while (cursor.leaveYear < year && guard < 8) {
    const remaining = Math.max(0, annualAvailableHundredths(cursor))
    cursor = {
      ...cursor,
      leaveYear: cursor.leaveYear + 1,
      carryOverHundredths: Math.min(CARRY_CAP_HUNDREDTHS, remaining),
      annualUsedHundredths: 0,
      sickUsedHundredths: 0,
      unpaidUsedHundredths: 0,
    }
    guard += 1
  }
  return cursor
}

export function complianceState(dueDate: string | null, stored: string, today: string): 'upcoming' | 'due' | 'overdue' | 'done' {
  if (stored === 'done') return 'done'
  if (!dueDate || !isIsoDate(dueDate)) return 'upcoming'
  if (dueDate < today) return 'overdue'
  if (dueDate <= addDaysIso(today, 14)) return 'due'
  return 'upcoming'
}

export function yearHolidays(year: number) {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  return listKenyaHolidaysInRange(parseIsoDate(start), parseIsoDate(end))
}
