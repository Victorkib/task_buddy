import { buildPresentSlides } from './deck'
import type { QueueResponsibility, QueueTask } from '../work/queue'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

const now = new Date('2026-10-12T08:00:00.000Z')
const responsibilities: QueueResponsibility[] = [
  { id: 'support', title: 'Reception cover', description: 'Cover the front desk on Thursdays.', role: 'supporting', departmentName: 'Admin', status: 'active' },
  { id: 'done', title: 'Old duty', description: 'Finished.', role: 'owner', departmentName: 'Admin', status: 'completed' },
  { id: 'own', title: 'Payroll calendar', description: 'Keep the monthly payroll dates current.', role: 'owner', departmentName: 'Finance', status: 'active' },
]
const tasks: QueueTask[] = [
  { id: 'blocked', title: 'Keys for the store', description: 'Waiting on the locksmith.', status: 'blocked', dueDate: null, role: 'assignee', departmentName: 'Operations', projectTitle: 'Site' },
  { id: 'progress', title: 'Induction notes', description: 'Write the new starter notes.', status: 'in_progress', dueDate: '2026-10-28', role: 'assignee', departmentName: 'People', projectTitle: null },
  { id: 'soon', title: 'Invoice batch', description: 'Send this week’s invoices.', status: 'not_started', dueDate: '2026-10-15', role: 'helper', departmentName: 'Finance', projectTitle: 'Billing' },
  { id: 'overdue', title: 'Insurance renewal', description: 'Renew the office policy.', status: 'waiting', dueDate: '2026-10-01', role: 'assignee', departmentName: 'Finance', projectTitle: null },
  { id: 'cancelled', title: 'Drop this', description: 'Cancelled.', status: 'cancelled', dueDate: '2026-10-01', role: 'assignee', departmentName: 'Finance', projectTitle: null },
]

const slides = buildPresentSlides({
  person: { name: 'Amina Otieno', jobTitle: 'Finance lead', department: 'Finance' },
  responsibilities,
  tasks,
  now,
})

assert(slides[0]?.kind === 'title', 'opens on a title card')
if (slides[0]?.kind === 'title') {
  assert(slides[0].person.name === 'Amina Otieno', 'title uses the signed-in name')
  assert(slides[0].person.jobTitle === 'Finance lead', 'title uses the job')
  assert(slides[0].person.department === 'Finance', 'title uses the department')
  assert(slides[0].dateLabel.includes('2026'), 'title has a date')
}
assert(slides[1]?.kind === 'agenda', 'agenda is second')
if (slides[1]?.kind === 'agenda') {
  assert(slides[1].responsibilityCount === 2, 'agenda counts active responsibilities only')
  assert(slides[1].taskCount === 4, 'agenda counts open tasks only')
}
const items = slides.filter((slide) => slide.kind === 'item')
assert(items.map((slide) => (slide.kind === 'item' ? slide.title : '')).join('|') === 'Payroll calendar|Reception cover|Insurance renewal|Invoice batch|Induction notes|Keys for the store', 'owned responsibilities, then supporting, then overdue, due soon, in progress, waiting or blocked')
assert(items[0]?.kind === 'item' && items[0].kicker === 'Responsibility · Owner', 'owned work is labeled')
assert(items[1]?.kind === 'item' && items[1].kicker === 'Responsibility · Supporting', 'support work is labeled')
assert(items[3]?.kind === 'item' && items[3].kicker === 'Task · Helping', 'helpers are labeled')
assert(items[0]?.kind === 'item' && items[0].index === 1 && items[0].total === 6, 'progress starts at 1 of the open items')
assert(slides.at(-1)?.kind === 'close', 'closes with the same walk-through')
if (slides.at(-1)?.kind === 'close') {
  assert(slides.at(-1)?.kind === 'close' && slides[slides.length - 1].kind === 'close', 'closing card exists')
}
const close = slides[slides.length - 1]
if (close?.kind === 'close') {
  assert(close.responsibilityCount === 2 && close.taskCount === 4, 'closing card repeats the counts')
}

console.log('present deck tests passed')
