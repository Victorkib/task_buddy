import { kenyaPublicHolidays } from './kenya-calendar'
import { countWorkingDays, leaveSpanHundredths, proratedAnnualHundredths, rollLeaveYear } from './leave'
import { buildOfferLetter, buildStaffLetter } from './letters'
import { formatKes, requestNeedsMd, statutoryReminders } from './policy'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

const holidays = kenyaPublicHolidays(2026)
assert(holidays.get('2026-01-01')?.includes('New Year'), 'new year')
assert(holidays.has('2026-04-03') && holidays.has('2026-04-06'), 'easter 2026')
assert(holidays.has('2026-10-10'), 'huduma day stays on saturday')
assert(countWorkingDays('2026-01-05', '2026-01-09') === 5, 'a normal week is five days')
assert(countWorkingDays('2026-01-01', '2026-01-02') === 1, 'new year is excluded')
assert(countWorkingDays('2026-04-03', '2026-04-06') === 0, 'easter weekend has no working days')
assert(countWorkingDays('2026-10-09', '2026-10-12') === 2, 'huduma saturday does not add a monday')
assert(proratedAnnualHundredths(21, '2026-10-01', 2026) === 525, 'october joiner gets three months')
assert(proratedAnnualHundredths(21, '2025-06-01', 2026) === 2100, 'earlier joiner gets the full year')
assert(proratedAnnualHundredths(21, null, 2026) === 2100, 'missing start date uses the full year')

const half = leaveSpanHundredths('half_day', '2026-01-05', '2026-01-05')
assert('daysHundredths' in half && half.daysHundredths === 50, 'half day is half a working day')
const holidayHalf = leaveSpanHundredths('half_day', '2026-01-01', '2026-01-01')
assert('error' in holidayHalf, 'half day cannot fall on a holiday')

const rolled = rollLeaveYear(
  {
    leaveYear: 2025,
    annualEntitlementDays: 21,
    carryOverHundredths: 0,
    annualUsedHundredths: 0,
    sickUsedHundredths: 100,
    unpaidUsedHundredths: 50,
    startDate: '2020-01-01',
  },
  2026,
)
assert(rolled.leaveYear === 2026 && rolled.carryOverHundredths === 1000, 'carry-over caps at 10 days')
assert(rolled.sickUsedHundredths === 0 && rolled.annualUsedHundredths === 0, 'used days reset with the year')

assert(requestNeedsMd({ kind: 'leave', daysHundredths: 1001, amountKes: 0 }), 'long leave needs the md')
assert(!requestNeedsMd({ kind: 'leave', daysHundredths: 1000, amountKes: 0 }), 'ten days stays with the admin office')
assert(requestNeedsMd({ kind: 'imprest', daysHundredths: 0, amountKes: 10000 }), 'ten thousand needs the md')
assert(formatKes(12500) === 'KES 12,500', 'shilling format')

const reminders = statutoryReminders('2026-10-05')
assert(reminders.find((item) => item.title === 'PAYE return')?.dueDate === '2026-10-09', 'paye next 9th')
assert(reminders.find((item) => item.title === 'NSSF contribution')?.dueDate === '2026-10-15', 'nssf next 15th')

const letter = buildStaffLetter({
  companyName: 'Globecon Convergence Solutions',
  letterType: 'employment_confirmation',
  documentNumber: 'GCS-HR-2026-0001',
  employeeName: 'Ada',
  jobTitle: 'Analyst',
  departmentName: 'Finance & Admin',
  startDate: '2026-01-05',
  purpose: 'For her bank.',
  today: '2026-10-05',
})
assert(letter.includes('Juja Professional Centre'), 'letter uses the Juja address')
assert(letter.includes('>01</span> | Purpose'), 'letter uses numbered sections')
assert(letter.includes('5th October 2026'), 'letter dates read like a Globecon letter')
assert(letter.includes('globecon-letterhead.png'), 'letter sits on the letterhead')
const offer = buildOfferLetter({
  companyName: 'Globecon Convergence Solutions Limited',
  documentNumber: null,
  candidateName: 'Ada',
  jobTitle: 'Analyst',
  departmentName: null,
  salaryText: 'KES 80,000 per month',
  startDate: '2026-11-02',
  probationMonths: 3,
  notes: null,
  today: '2026-10-05',
})
assert(offer.includes('>01</span> | The role') && offer.includes('To,'), 'offer follows the proposal structure')

console.log('admin office tests passed')
