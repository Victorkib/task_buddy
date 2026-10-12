const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export const CLOSED_TASK_STATUSES = ['completed', 'cancelled'] as const
export const CLOSED_RESPONSIBILITY_STATUSES = ['paused', 'completed'] as const

export const RESPONSIBILITY_CAP = 8
export const TASK_CAP = 10

export type WorkRole = 'owner' | 'supporting' | 'assignee' | 'helper'

export type QueueResponsibility = {
  id: string
  title: string
  description?: string | null
  role: 'owner' | 'supporting'
  departmentName?: string | null
  status: string
}

export type QueueTask = {
  id: string
  title: string
  description?: string | null
  status: string
  dueDate?: string | null
  role: 'assignee' | 'helper'
  departmentName?: string | null
  projectTitle?: string | null
}

export type WorkSnapshot = {
  responsibilities: QueueResponsibility[]
  responsibilityOverflow: number
  responsibilityTotal: number
  tasks: QueueTask[]
  taskOverflow: number
  taskTotal: number
  overdueCount: number
}

export function isOpenTaskStatus(status: string) {
  return !CLOSED_TASK_STATUSES.includes(status as (typeof CLOSED_TASK_STATUSES)[number])
}

export function isActiveResponsibilityStatus(status: string) {
  return !CLOSED_RESPONSIBILITY_STATUSES.includes(status as (typeof CLOSED_RESPONSIBILITY_STATUSES)[number])
}

export function nairobiYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function nairobiLongDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
}

export function shiftYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  const nextYear = date.getUTCFullYear()
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getUTCDate()).padStart(2, '0')
  return `${nextYear}-${nextMonth}-${nextDay}`
}

export function nairobiWeekStart(now = new Date()) {
  const ymd = nairobiYmd(now)
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
  }).format(now)
  const index = WEEKDAY_INDEX[weekday] ?? 1
  const mondayOffset = (index + 6) % 7
  return shiftYmd(ymd, -mondayOffset)
}

export function nairobiWeekEnd(now = new Date()) {
  return shiftYmd(nairobiWeekStart(now), 6)
}

export function formatWeekLabel(weekStartYmd: string) {
  const [, month, day] = weekStartYmd.split('-').map(Number)
  const year = weekStartYmd.slice(0, 4)
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`
}

export function formatQueueDate(ymd: string | null | undefined) {
  if (!ymd) return ''
  const iso = ymd.slice(0, 10)
  const [, month, day] = iso.split('-').map(Number)
  const year = iso.slice(0, 4)
  if (!month || !day) return iso
  return `${day} ${MONTHS[month - 1]} ${year}`
}

export function oneLine(value: string | null | undefined, max = 140) {
  const flat = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1).trimEnd()}…`
}

export function dateOnly(value: string | Date | null | undefined) {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  const match = value.match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

function taskBand(task: QueueTask, today: string, weekEnd: string) {
  const due = dateOnly(task.dueDate)
  if (due && due < today) return 0
  if (due && due >= today && due <= weekEnd) return 1
  if (task.status === 'in_progress') return 2
  if (task.status === 'waiting' || task.status === 'blocked' || task.status === 'pending_approval') return 3
  return 4
}

export function compareQueueTasks(left: QueueTask, right: QueueTask, today: string, weekEnd: string) {
  const band = taskBand(left, today, weekEnd) - taskBand(right, today, weekEnd)
  if (band !== 0) return band
  const leftDue = dateOnly(left.dueDate) ?? '9999-12-31'
  const rightDue = dateOnly(right.dueDate) ?? '9999-12-31'
  if (leftDue !== rightDue) return leftDue.localeCompare(rightDue)
  return left.title.localeCompare(right.title)
}

export function sortQueueTasks(tasks: QueueTask[], today: string, weekEnd: string) {
  return [...tasks].sort((left, right) => compareQueueTasks(left, right, today, weekEnd))
}

export function sortQueueResponsibilities(items: QueueResponsibility[]) {
  return [...items].sort((left, right) => {
    if (left.role !== right.role) return left.role === 'owner' ? -1 : 1
    return left.title.localeCompare(right.title)
  })
}

export function buildWorkSnapshot(
  input: {
    responsibilities: QueueResponsibility[]
    tasks: QueueTask[]
    today: string
    weekEnd: string
  },
  caps: { responsibilities?: number; tasks?: number } = {},
): WorkSnapshot {
  const responsibilityCap = caps.responsibilities ?? RESPONSIBILITY_CAP
  const taskCap = caps.tasks ?? TASK_CAP
  const responsibilities = sortQueueResponsibilities(
    input.responsibilities.filter((item) => isActiveResponsibilityStatus(item.status)),
  )
  const tasks = sortQueueTasks(
    input.tasks.filter((task) => isOpenTaskStatus(task.status)),
    input.today,
    input.weekEnd,
  )
  const overdueCount = tasks.filter((task) => {
    const due = dateOnly(task.dueDate)
    return Boolean(due && due < input.today)
  }).length

  return {
    responsibilities: responsibilities.slice(0, responsibilityCap),
    responsibilityOverflow: Math.max(0, responsibilities.length - responsibilityCap),
    responsibilityTotal: responsibilities.length,
    tasks: tasks.slice(0, taskCap),
    taskOverflow: Math.max(0, tasks.length - taskCap),
    taskTotal: tasks.length,
    overdueCount,
  }
}

export type RecipientDecision = 'send' | 'inactive' | 'invited' | 'opted_out' | 'empty' | 'already_sent'

export function recipientDecision(
  person: {
    status: string
    weeklyKeepCurrent: number | null
    openTaskCount: number
    activeResponsibilityCount: number
    alreadySent: boolean
  },
  resend: boolean,
): RecipientDecision {
  if (person.status === 'invited') return 'invited'
  if (person.status !== 'active') return 'inactive'
  if (person.weeklyKeepCurrent === 0) return 'opted_out'
  if (person.openTaskCount < 1 && person.activeResponsibilityCount < 1) return 'empty'
  if (person.alreadySent && !resend) return 'already_sent'
  return 'send'
}
