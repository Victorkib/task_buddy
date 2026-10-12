import { TASK_STATUS_LABELS } from '@/lib/constants'
import {
  dateOnly,
  formatQueueDate,
  isActiveResponsibilityStatus,
  isOpenTaskStatus,
  nairobiLongDate,
  nairobiWeekEnd,
  nairobiYmd,
  oneLine,
  sortQueueResponsibilities,
  sortQueueTasks,
  type QueueResponsibility,
  type QueueTask,
} from '@/lib/work/queue'

export type PresentPerson = {
  name: string
  jobTitle: string
  department: string
}

export type PresentSlide =
  | { kind: 'title'; person: PresentPerson; dateLabel: string }
  | { kind: 'agenda'; responsibilityCount: number; taskCount: number }
  | {
      kind: 'item'
      index: number
      total: number
      kicker: string
      title: string
      status: string
      due: string | null
      place: string
      description: string
    }
  | { kind: 'close'; responsibilityCount: number; taskCount: number }

function taskStatusLabel(status: string) {
  if (status in TASK_STATUS_LABELS) return TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS]
  return status.replaceAll('_', ' ')
}

function taskKicker(task: QueueTask) {
  return task.role === 'helper' ? 'Task · Helping' : 'Task · Leading'
}

function responsibilityKicker(item: QueueResponsibility) {
  return item.role === 'owner' ? 'Responsibility · Owner' : 'Responsibility · Supporting'
}

export function buildPresentSlides(
  input: {
    person: PresentPerson
    responsibilities: QueueResponsibility[]
    tasks: QueueTask[]
    now?: Date
  },
): PresentSlide[] {
  const now = input.now ?? new Date()
  const today = nairobiYmd(now)
  const weekEnd = nairobiWeekEnd(now)
  const responsibilities = sortQueueResponsibilities(
    input.responsibilities.filter((item) => isActiveResponsibilityStatus(item.status)),
  )
  const tasks = sortQueueTasks(
    input.tasks.filter((task) => isOpenTaskStatus(task.status)),
    today,
    weekEnd,
  )
  const items: PresentSlide[] = [
    ...responsibilities.map((item) => ({
      kind: 'item' as const,
      index: 0,
      total: 0,
      kicker: responsibilityKicker(item),
      title: item.title,
      status: 'Active',
      due: null,
      place: item.departmentName?.trim() || 'No department',
      description: oneLine(item.description) || 'No description yet.',
    })),
    ...tasks.map((task) => {
      const due = dateOnly(task.dueDate)
      const dueLabel = due
        ? due < today
          ? `Was due ${formatQueueDate(due)}`
          : due === today
            ? `Due today, ${formatQueueDate(due)}`
            : `Due ${formatQueueDate(due)}`
        : 'No due date'
      const place = [task.departmentName, task.projectTitle].filter(Boolean).join(' · ') || 'No department'
      return {
        kind: 'item' as const,
        index: 0,
        total: 0,
        kicker: taskKicker(task),
        title: task.title,
        status: taskStatusLabel(task.status),
        due: dueLabel,
        place,
        description: oneLine(task.description) || 'No description yet.',
      }
    }),
  ]
  const numbered = items.map((slide, offset) =>
    slide.kind === 'item' ? { ...slide, index: offset + 1, total: items.length } : slide,
  )

  return [
    { kind: 'title', person: input.person, dateLabel: nairobiLongDate(now) },
    { kind: 'agenda', responsibilityCount: responsibilities.length, taskCount: tasks.length },
    ...numbered,
    { kind: 'close', responsibilityCount: responsibilities.length, taskCount: tasks.length },
  ]
}
