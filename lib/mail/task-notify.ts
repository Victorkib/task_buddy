import { getPublicAppUrl, isMailConfigured, sendMail } from '@/lib/mail/send'
import { projectProgressRequestEmail, taskAssignedEmail } from '@/lib/mail/templates'

export async function trySendMail(to: string | null | undefined, mail: { subject: string; html: string; text: string }) {
  if (!to || !isMailConfigured()) return false
  try {
    await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text })
    return true
  } catch (error) {
    console.error('Task Buddy email failed', error)
    return false
  }
}

export function taskMailUrl(taskId: string) {
  return `${getPublicAppUrl()}/?view=${encodeURIComponent('My tasks')}&task=${encodeURIComponent(taskId)}`
}

export function projectMailUrl(projectId: string) {
  return `${getPublicAppUrl()}/?view=${encodeURIComponent('Projects')}&project=${encodeURIComponent(projectId)}`
}

export function dueDateMailLabel(value: string | Date | null | undefined) {
  if (!value) return null
  const iso = String(value).slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[Number(match[2]) - 1] ?? match[2]
  return `${Number(match[3])} ${month} ${match[1]}`
}

export async function sendTaskAssignmentMail(input: {
  to: string | null | undefined
  firstName: string
  assignerName: string
  taskTitle: string
  taskId: string
  projectTitle?: string | null
  dueDate?: string | Date | null
  brief?: string | null
  role: 'assignee' | 'collaborator'
  companyName: string
}) {
  return trySendMail(
    input.to,
    taskAssignedEmail({
      firstName: input.firstName,
      assignerName: input.assignerName,
      taskTitle: input.taskTitle,
      projectTitle: input.projectTitle,
      dueDateLabel: dueDateMailLabel(input.dueDate),
      brief: input.brief,
      role: input.role,
      taskUrl: taskMailUrl(input.taskId),
      companyName: input.companyName,
    }),
  )
}

export { projectProgressRequestEmail, isMailConfigured }
