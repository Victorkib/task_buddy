/** Kenya public holidays used for leave working-day math. Sunday holidays observe Monday. */

const FIXED: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: 'New Year’s Day' },
  { month: 5, day: 1, name: 'Labour Day' },
  { month: 6, day: 1, name: 'Madaraka Day' },
  { month: 10, day: 10, name: 'Huduma Day' },
  { month: 10, day: 20, name: 'Mashujaa Day' },
  { month: 12, day: 12, name: 'Jamhuri Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 26, name: 'Boxing Day' },
]

/** Easter Sunday (Anonymous Gregorian algorithm). */
function easterSunday(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function pad(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function iso(date: Date) {
  return pad(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function observe(date: Date) {
  if (date.getDay() === 0) {
    const next = new Date(date)
    next.setDate(date.getDate() + 1)
    return next
  }
  return date
}

export function kenyaPublicHolidays(year: number) {
  const map = new Map<string, string>()
  const add = (date: Date, name: string) => {
    const observed = observe(date)
    map.set(iso(observed), name)
  }

  for (const row of FIXED) {
    add(new Date(year, row.month - 1, row.day), row.name)
  }

  const easter = easterSunday(year)
  const friday = new Date(easter)
  friday.setDate(easter.getDate() - 2)
  const monday = new Date(easter)
  monday.setDate(easter.getDate() + 1)
  add(friday, 'Good Friday')
  add(monday, 'Easter Monday')

  return map
}

export function isKenyaPublicHoliday(value: Date, holidays = kenyaPublicHolidays(value.getFullYear())) {
  return holidays.has(iso(value))
}

export function isKenyaWorkingDay(value: Date, holidays?: Map<string, string>) {
  const day = value.getDay()
  if (day === 0 || day === 6) return false
  return !isKenyaPublicHoliday(value, holidays ?? kenyaPublicHolidays(value.getFullYear()))
}

export function listKenyaHolidaysInRange(start: Date, end: Date) {
  const years = new Set<number>()
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  years.add(cursor.getFullYear())
  years.add(last.getFullYear())
  const holidays = new Map<string, string>()
  for (const year of years) {
    for (const [date, name] of kenyaPublicHolidays(year)) holidays.set(date, name)
  }
  const rows: Array<{ date: string; name: string }> = []
  while (cursor <= last) {
    const key = iso(cursor)
    const name = holidays.get(key)
    if (name) rows.push({ date: key, name })
    cursor.setDate(cursor.getDate() + 1)
  }
  return rows
}
