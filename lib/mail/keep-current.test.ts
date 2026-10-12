import { keepCurrentEmail, keepCurrentMailUnavailableMessage, keepCurrentSubject } from './keep-current'
import { buildWorkSnapshot, nairobiWeekStart, recipientDecision, type QueueResponsibility, type QueueTask } from '../work/queue'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

const monday = new Date('2026-10-12T08:00:00.000Z')
const sundayNairobi = new Date('2026-10-11T18:00:00.000Z')
const mondayJustAfterMidnight = new Date('2026-10-11T21:30:00.000Z')

assert(nairobiWeekStart(monday) === '2026-10-12', 'Monday 12 Oct 2026 is its own week start')
assert(nairobiWeekStart(sundayNairobi) === '2026-10-05', 'Sunday evening in Nairobi stays in the previous week')
assert(nairobiWeekStart(mondayJustAfterMidnight) === '2026-10-12', 'Monday just after midnight Nairobi starts the new week')
assert(keepCurrentSubject(monday) === 'Your Task Buddy check-in — week of 12 Oct 2026', 'subject uses the Nairobi week')

assert(recipientDecision({ status: 'inactive', weeklyKeepCurrent: 1, openTaskCount: 2, activeResponsibilityCount: 1, alreadySent: false }, false) === 'inactive', 'inactive skipped')
assert(recipientDecision({ status: 'invited', weeklyKeepCurrent: 1, openTaskCount: 2, activeResponsibilityCount: 1, alreadySent: false }, false) === 'invited', 'invited skipped')
assert(recipientDecision({ status: 'active', weeklyKeepCurrent: 0, openTaskCount: 2, activeResponsibilityCount: 1, alreadySent: false }, false) === 'opted_out', 'opt-out is separate from daily summaries')
assert(recipientDecision({ status: 'active', weeklyKeepCurrent: null, openTaskCount: 0, activeResponsibilityCount: 0, alreadySent: false }, false) === 'empty', 'empty queues are not nagged')
assert(recipientDecision({ status: 'active', weeklyKeepCurrent: 1, openTaskCount: 1, activeResponsibilityCount: 0, alreadySent: true }, false) === 'already_sent', 'same Nairobi week is not mailed twice')
assert(recipientDecision({ status: 'active', weeklyKeepCurrent: 1, openTaskCount: 1, activeResponsibilityCount: 0, alreadySent: true }, true) === 'send', 'explicit resend is allowed')
assert(recipientDecision({ status: 'active', weeklyKeepCurrent: null, openTaskCount: 0, activeResponsibilityCount: 1, alreadySent: false }, false) === 'send', 'a responsibility alone qualifies')

const responsibilities: QueueResponsibility[] = [
  { id: 'r-support', title: 'Board pack', description: 'Monthly pack for leadership.', role: 'supporting', departmentName: 'Finance', status: 'active' },
  { id: 'r-paused', title: 'Old register', description: 'Paused.', role: 'owner', departmentName: 'Finance', status: 'paused' },
  { id: 'r-owner', title: 'Vendor payments', description: 'Approve the weekly vendor run.', role: 'owner', departmentName: 'Finance', status: 'active' },
]
const tasks: QueueTask[] = [
  { id: 't-later', title: 'Plan retreat', description: 'Outline the offsite.', status: 'not_started', dueDate: '2026-11-02', role: 'assignee', departmentName: 'People', projectTitle: null },
  { id: 't-progress', title: 'Close September books', description: 'Reconcile the ledger.', status: 'in_progress', dueDate: '2026-10-20', role: 'assignee', departmentName: 'Finance', projectTitle: 'Month end' },
  { id: 't-week', title: 'Send client update', description: 'Draft the Friday note.', status: 'not_started', dueDate: '2026-10-16', role: 'helper', departmentName: 'Delivery', projectTitle: 'Northwind' },
  { id: 't-overdue', title: 'File the return', description: 'Submit the outstanding return.', status: 'waiting', dueDate: '2026-10-02', role: 'assignee', departmentName: 'Finance', projectTitle: null },
  { id: 't-done', title: 'Archive files', description: 'Done.', status: 'completed', dueDate: '2026-10-01', role: 'assignee', departmentName: 'Finance', projectTitle: null },
  { id: 't-blocked', title: 'Wait on legal', description: 'Contract review is stuck.', status: 'blocked', dueDate: null, role: 'helper', departmentName: 'Legal', projectTitle: null },
]

const snapshot = buildWorkSnapshot(
  { responsibilities, tasks, today: '2026-10-12', weekEnd: '2026-10-18' },
  { responsibilities: 8, tasks: 2 },
)

assert(snapshot.responsibilities.map((item) => item.id).join(',') === 'r-owner,r-support', 'owners come before supporting, paused is dropped')
assert(snapshot.tasks.map((task) => task.id).join(',') === 't-overdue,t-week', 'overdue then due this week, capped')
assert(snapshot.taskOverflow === 3, 'says how many tasks remain')
assert(snapshot.overdueCount === 1, 'overdue count is calm input, not a second list')
assert(!snapshot.tasks.some((task) => task.status === 'completed'), 'completed tasks stay out')

const message = keepCurrentEmail({
  firstName: 'Amina',
  snapshot,
  tasksUrl: 'https://tasks.example/?view=My%20tasks',
  responsibilitiesUrl: 'https://tasks.example/?view=Responsibilities',
  profileUrl: 'https://tasks.example/profile',
  today: '2026-10-12',
  weekEnd: '2026-10-18',
  now: monday,
})

assert(message.subject === 'Your Task Buddy check-in — week of 12 Oct 2026', 'email subject')
assert(message.html.includes('GCS Task Buddy'), 'branded header')
assert(message.html.includes('Owner'), 'owner label')
assert(message.html.includes('Supporting'), 'supporting label')
assert(message.html.includes('Vendor payments'), 'responsibility title')
assert(message.html.includes('File the return'), 'overdue task')
assert(message.html.includes('One item is past its date'), 'one calm overdue line')
assert(message.html.includes('3 more tasks are in Task Buddy.'), 'overflow line')
assert(message.html.includes('https://tasks.example/?view=My%20tasks'), 'tasks deep link')
assert(message.html.includes('https://tasks.example/?view=Responsibilities'), 'responsibilities deep link')
assert(message.html.includes('Weekly keep-current email'), 'footer explains how to turn it off')
assert(message.text.includes('Helping'), 'plain text labels helpers')
assert(!message.html.includes('assigneeId'), 'email does not dump database fields')
assert(keepCurrentMailUnavailableMessage().toLowerCase().includes('not configured'), 'missing mail config is explicit')

console.log('keep-current tests passed')
