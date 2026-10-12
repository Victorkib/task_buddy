export type TaskCollaborator = {
  id?: string
  initials: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
  avatarColor?: string | null
}

export type LinkedComment = {
  body: string
  createdAt: string | Date
  user: TaskCollaborator | null
}

export type LinkedTaskView = {
  id: string
  title: string
  status: string
  progress?: number
  dueDate?: string | Date | null
  assignee: TaskCollaborator | null
  helpers: TaskCollaborator[]
  latestComment: LinkedComment | null
}

type PersonSource = {
  id?: string
  initials: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
  avatarColor?: string | null
} | null | undefined

export function toCollaborator(user: PersonSource): TaskCollaborator | null {
  if (!user) return null
  return {
    id: user.id,
    initials: user.initials,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    avatarColor: user.avatarColor,
  }
}

export function latestTaskComment(
  comments: Array<{ body: string; createdAt: string | Date; user?: PersonSource }> | null | undefined,
): LinkedComment | null {
  const latest = [...(comments ?? [])].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0]
  if (!latest) return null
  return {
    body: latest.body,
    createdAt: latest.createdAt,
    user: toCollaborator(latest.user),
  }
}

export function toLinkedTaskView(task: {
  id: string
  title: string
  status: string
  progress?: number
  dueDate?: string | Date | null
  assignee?: PersonSource
  helpers?: Array<{ user?: PersonSource }> | null
  comments?: Array<{ body: string; createdAt: string | Date; user?: PersonSource }> | null
}): LinkedTaskView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    progress: task.progress,
    dueDate: task.dueDate,
    assignee: toCollaborator(task.assignee),
    helpers: (task.helpers ?? []).map((entry) => toCollaborator(entry.user)).filter((person): person is TaskCollaborator => Boolean(person)),
    latestComment: latestTaskComment(task.comments),
  }
}
