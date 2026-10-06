'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FileDropzone } from '@/components/uploads/file-dropzone'
import { Button } from '@/components/ui/button'
import {
  acknowledgeDocument,
  completeCompliance,
  decideAdminRequest,
  decideOffer,
  previewStaffLetter,
  saveAsset,
  saveCompliance,
  saveDocument,
  saveOffer,
  saveVendor,
  submitAdminRequest,
  updateStaffProfile,
} from '@/app/admin-office-actions'
import { leaveSpanHundredths } from '@/lib/admin-office/leave'
import { DOCUMENT_STARTERS } from '@/lib/admin-office/letters'
import {
  EMPLOYMENT_TYPE_LABELS,
  formatHundredths,
  formatKes,
  LEAVE_TYPE_LABELS,
  LETTER_TYPE_LABELS,
  OFFER_STATUS_LABELS,
  REQUEST_KIND_LABELS,
  requestStatusLabel,
} from '@/lib/admin-office/policy'
import type { AdminRequestKind, OfficeDesk, OfficeLetterType, OfficeRequest } from '@/lib/admin-office/types'

const ADMIN_TABS = [
  ['today', 'Today'],
  ['inbox', 'Decide'],
  ['people', 'People'],
  ['calendar', 'Who is out'],
  ['offers', 'Offers'],
  ['finance', 'Money'],
  ['documents', 'Papers'],
  ['assets', 'Equipment'],
  ['compliance', 'Reminders'],
] as const

const SELF_TABS = [
  ['request', 'Ask for something'],
  ['mine', 'My requests'],
  ['policies', 'Policies'],
] as const

const ASK_CHOICES: Array<{ kind: AdminRequestKind; label: string; hint: string }> = [
  { kind: 'leave', label: 'Time off', hint: 'Annual, sick, study, or a half day' },
  { kind: 'letter', label: 'A letter', hint: 'Bank, confirmation, or introduction' },
  { kind: 'imprest', label: 'Imprest', hint: 'Cash to spend and retire later' },
  { kind: 'purchase', label: 'A purchase', hint: 'Something the office should buy' },
  { kind: 'print', label: 'Printing', hint: 'Copies ready for pickup' },
  { kind: 'equipment', label: 'Equipment', hint: 'A laptop, phone, or desk' },
  { kind: 'training', label: 'Training', hint: 'A course or conference' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function prettyDate(value: string | null | undefined) {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

function printHtml(html: string) {
  const win = window.open('', '_blank')
  if (!win) return
  const printable = html.includes('<base ')
    ? html
    : html.replace('<head>', `<head><base href="${window.location.origin}/">`)
  win.document.open()
  win.document.write(printable)
  win.document.close()
  win.focus()
  win.print()
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function Chip({ children, tone = 'calm' }: { children: string; tone?: 'calm' | 'attention' | 'good' }) {
  return <span className={`office-chip office-chip-${tone}`}>{children}</span>
}

export function AdminOfficeDesk({
  mode,
  desk,
  colleagues,
  currentUserId,
  canIssueOffers,
}: {
  mode: 'admin' | 'self'
  desk: OfficeDesk
  colleagues: { id: string; firstName: string; lastName: string }[]
  currentUserId: string
  canIssueOffers: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabs = mode === 'admin' ? ADMIN_TABS : SELF_TABS
  const requested = searchParams.get('desk')
  const active = tabs.some((tab) => tab[0] === requested) ? requested! : tabs[0][0]
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function openDesk(tab: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', mode === 'admin' ? 'Admin office' : 'My office')
    params.set('desk', tab)
    router.push(`/?${params.toString()}`, { scroll: false })
  }

  function run(
    action: () => Promise<{ error?: string; notice?: string } | void | { html?: string }>,
    fallback: string,
    onSuccess?: () => void,
  ) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await action()
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      setNotice((result && 'notice' in result && result.notice) || fallback)
      onSuccess?.()
      router.refresh()
    })
  }

  return (
    <div className="office-desk">
      {desk.setupMessage ? <p className="form-error">{desk.setupMessage}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}
      <div className="office-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className={active === id ? 'selected' : ''} onClick={() => openDesk(id)}>
            {label}
            {id === 'inbox' && desk.pendingCount > 0 ? <em>{desk.pendingCount}</em> : null}
          </button>
        ))}
      </div>
      {active === 'today' && mode === 'admin' ? <TodayPanel desk={desk} onOpen={openDesk} /> : null}
      {active === 'inbox' && mode === 'admin' ? (
        <InboxPanel
          desk={desk}
          pending={pending}
          canFinalize={canIssueOffers}
          onDecide={(id, decision, reason) => run(() => decideAdminRequest(id, decision, reason), 'Updated.')}
        />
      ) : null}
      {active === 'people' && mode === 'admin' ? (
        <PeoplePanel desk={desk} pending={pending} onSave={(formData) => run(() => updateStaffProfile(formData), 'Saved.')} />
      ) : null}
      {active === 'calendar' ? <CalendarPanel desk={desk} /> : null}
      {active === 'offers' && mode === 'admin' ? (
        <OffersPanel desk={desk} pending={pending} canIssue={canIssueOffers} onSave={(formData) => run(() => saveOffer(formData), 'Draft saved.')} onDecide={(id, decision) => run(() => decideOffer(id, decision), 'Offer updated.')} />
      ) : null}
      {active === 'finance' && mode === 'admin' ? (
        <FinancePanel desk={desk} colleagues={colleagues} pending={pending} onSave={(formData) => run(() => saveVendor(formData), 'Vendor saved.')} />
      ) : null}
      {active === 'documents' && mode === 'admin' ? (
        <DocumentsPanel currentUserId={currentUserId} desk={desk} pending={pending} onSave={(formData) => run(() => saveDocument(formData), 'Document saved.')} />
      ) : null}
      {active === 'assets' && mode === 'admin' ? (
        <AssetsPanel desk={desk} colleagues={colleagues} pending={pending} onSave={(formData) => run(() => saveAsset(formData), 'Asset saved.')} />
      ) : null}
      {active === 'compliance' && mode === 'admin' ? (
        <CompliancePanel desk={desk} pending={pending} onSave={(formData) => run(() => saveCompliance(formData), 'Reminder added.')} onDone={(id) => run(() => completeCompliance(id), 'Updated.')} />
      ) : null}
      {active === 'request' && mode === 'self' ? (
        <RequestForm
          desk={desk}
          currentUserId={currentUserId}
          pending={pending}
          onSubmit={(formData, reset) => run(() => submitAdminRequest(formData), 'Sent to the admin office.', reset)}
          onPreview={async (formData) => {
            const result = await previewStaffLetter(formData)
            if ('error' in result && result.error) setError(result.error)
            else if ('html' in result && result.html) printHtml(result.html)
          }}
        />
      ) : null}
      {active === 'mine' && mode === 'self' ? (
        <MinePanel
          desk={desk}
          pending={pending}
          onCancel={(id) => run(() => decideAdminRequest(id, 'cancel'), 'Cancelled.')}
          onSaveContact={(formData) => run(() => updateStaffProfile(formData), 'Emergency contact saved.')}
        />
      ) : null}
      {active === 'policies' && mode === 'self' ? (
        <PoliciesPanel desk={desk} pending={pending} onAck={(id) => run(() => acknowledgeDocument(id), 'Acknowledged.')} />
      ) : null}
    </div>
  )
}

function TodayPanel({ desk, onOpen }: { desk: OfficeDesk; onOpen: (tab: string) => void }) {
  return (
    <>
      <section className="metric-grid compact-metrics">
        <button type="button" className="panel metric-card office-jump" onClick={() => onOpen('inbox')}>
          <span>Waiting on you</span>
          <strong>{desk.pendingCount}</strong>
          <span>Open Decide</span>
        </button>
        <button type="button" className="panel metric-card office-jump" onClick={() => onOpen('calendar')}>
          <span>Out soon</span>
          <strong>{desk.outNow.length}</strong>
          <span>Approved leave in the next 45 days</span>
        </button>
        <button type="button" className="panel metric-card office-jump" onClick={() => onOpen('finance')}>
          <span>Imprest still out</span>
          <strong>{formatKes(desk.imprestOutstandingKes)}</strong>
          <span>Issued and not yet retired</span>
        </button>
        <button type="button" className="panel metric-card office-jump" onClick={() => onOpen('people')}>
          <span>Leave still owed</span>
          <strong>{formatHundredths(desk.leaveLiabilityHundredths)}</strong>
          <span>Working days across active people</span>
        </button>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Needs a look</h2>
            <p>Contracts, statutory dates, renewals, and unsigned offers</p>
          </div>
        </div>
        {desk.alerts.length === 0 ? <p className="empty-state">Nothing is waiting. The calendar and the inbox are clear.</p> : (
          <div className="office-alert-list">
            {desk.alerts.map((alert) => (
              <button key={alert.id} type="button" className={`office-alert office-alert-${alert.tone}`} onClick={() => onOpen(alert.desk)}>
                <strong>{alert.title}</strong>
                <span>{alert.detail}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function InboxPanel({
  desk,
  pending,
  canFinalize,
  onDecide,
}: {
  desk: OfficeDesk
  pending: boolean
  canFinalize: boolean
  onDecide: (id: string, decision: 'approve' | 'reject' | 'complete' | 'cancel', reason?: string) => void
}) {
  const [kind, setKind] = useState<'all' | AdminRequestKind>('all')
  const [picked, setPicked] = useState<string | null>(null)
  const rows = desk.requests
    .filter((row) => kind === 'all' || row.kind === kind)
    .sort((a, b) => Number(isOpenRequest(b)) - Number(isOpenRequest(a)) || b.createdAt.localeCompare(a.createdAt))
  const selected = rows.find((row) => row.id === picked) ?? rows[0] ?? null
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Decide</h2>
          <p>Waiting items sit at the top. Leave over 10 working days, and money of KES 10,000 or more, goes to the managing director when you approve it.</p>
        </div>
      </div>
      <div className="office-tabs">
        <button type="button" className={kind === 'all' ? 'selected' : ''} onClick={() => setKind('all')}>All</button>
        {(Object.keys(REQUEST_KIND_LABELS) as AdminRequestKind[]).map((key) => (
          <button key={key} type="button" className={kind === key ? 'selected' : ''} onClick={() => setKind(key)}>{REQUEST_KIND_LABELS[key]}</button>
        ))}
      </div>
      {rows.length === 0 || !selected ? <p className="empty-state">Nothing is waiting in this filter.</p> : (
        <div className="office-split">
          <div className="office-queue" role="list">
            {rows.map((row) => (
              <button key={row.id} type="button" role="listitem" className={row.id === selected.id ? 'selected' : ''} onClick={() => setPicked(row.id)}>
                <strong>{row.title}</strong>
                <span>{row.requestorName} · {REQUEST_KIND_LABELS[row.kind]}</span>
                <Chip tone={isOpenRequest(row) ? 'attention' : row.status === 'approved' || row.status === 'completed' ? 'good' : 'calm'}>
                  {requestStatusLabel(row.kind, row.status)}
                </Chip>
              </button>
            ))}
          </div>
          <RequestCard row={selected} pending={pending} canDecide canFinalize={canFinalize} onDecide={onDecide} />
        </div>
      )}
    </section>
  )
}

function isOpenRequest(row: OfficeRequest) {
  return row.status === 'submitted' || row.status === 'in_review'
}

function RequestCard({
  row,
  pending,
  canDecide,
  canFinalize = false,
  onDecide,
  onCancel,
}: {
  row: OfficeRequest
  pending: boolean
  canDecide: boolean
  canFinalize?: boolean
  onDecide?: (id: string, decision: 'approve' | 'reject' | 'complete' | 'cancel', reason?: string) => void
  onCancel?: (id: string) => void
}) {
  const open = isOpenRequest(row)
  return (
    <article className="office-card">
      <header>
        <div>
          <strong>{row.title}</strong>
          <p>{row.requestorName}{row.departmentName ? ` · ${row.departmentName}` : ''}</p>
        </div>
        <Chip tone={open ? 'attention' : row.status === 'approved' || row.status === 'completed' ? 'good' : 'calm'}>
          {requestStatusLabel(row.kind, row.status)}
        </Chip>
      </header>
      <p className="office-meta">
        {REQUEST_KIND_LABELS[row.kind]}
        {row.leaveType ? ` · ${LEAVE_TYPE_LABELS[row.leaveType]} · ${formatHundredths(row.daysHundredths)} working days` : ''}
        {row.amountKes > 0 ? ` · ${formatKes(row.amountKes)}` : ''}
        {row.kind === 'print' ? ` · ${row.copies} cop${row.copies === 1 ? 'y' : 'ies'}${row.confidential ? ' · confidential' : ''}` : ''}
        {row.startDate ? ` · ${prettyDate(row.startDate)}${row.endDate && row.endDate !== row.startDate ? ` to ${prettyDate(row.endDate)}` : ''}` : ''}
      </p>
      {row.description ? <p>{row.description}</p> : null}
      {row.coverageName ? <p>Cover: {row.coverageName}</p> : null}
      {row.conflicts.length > 0 ? <p className="form-error">Also out: {row.conflicts.join(', ')}</p> : null}
      {row.certificateMissing ? <p className="form-error">Sick leave over two days has no certificate attached.</p> : null}
      {row.needsMd && open ? <p>This needs the managing director before it can be final.</p> : null}
      {row.decisionReason ? <p>Note: {row.decisionReason}</p> : null}
      {row.attachmentUrl ? <p><a href={row.attachmentUrl} target="_blank" rel="noreferrer">{row.attachmentName || 'Open attachment'}</a></p> : null}
      {row.generatedHtml ? <button type="button" className="filter-pill" onClick={() => printHtml(row.generatedHtml!)}>Print letter</button> : null}
      {canDecide && open && onDecide ? (
        <div className="office-actions">
          <Button type="button" className="create-button" disabled={pending} onClick={() => onDecide(row.id, 'approve')}>
            {row.needsMd && row.status === 'submitted' && !canFinalize ? 'Send to MD' : 'Approve'}
          </Button>
          <form
            className="office-inline"
            onSubmit={(event) => {
              event.preventDefault()
              const reason = String(new FormData(event.currentTarget).get('reason') ?? '')
              onDecide(row.id, 'reject', reason)
            }}
          >
            <input name="reason" placeholder="Reason if you reject" aria-label="Rejection reason" />
            <Button type="submit" variant="outline" disabled={pending}>Reject</Button>
          </form>
        </div>
      ) : null}
      {canDecide && row.status === 'approved' && ['print', 'imprest', 'purchase', 'equipment'].includes(row.kind) && onDecide ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => onDecide(row.id, 'complete')}>
          {row.kind === 'print' ? 'Ready for pickup' : row.kind === 'imprest' ? 'Mark retired' : 'Mark finished'}
        </Button>
      ) : null}
      {onCancel && open ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => onCancel(row.id)}>Cancel request</Button>
      ) : null}
    </article>
  )
}

function RequestForm({
  desk,
  currentUserId,
  pending,
  onSubmit,
  onPreview,
}: {
  desk: OfficeDesk
  currentUserId: string
  pending: boolean
  onSubmit: (formData: FormData, reset: () => void) => void
  onPreview: (formData: FormData) => Promise<void>
}) {
  const [kind, setKind] = useState<AdminRequestKind>('leave')
  const [leaveType, setLeaveType] = useState('annual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [letterType, setLetterType] = useState<OfficeLetterType>('employment_confirmation')
  const [receipt, setReceipt] = useState<{ url: string; publicId: string; name: string } | null>(null)
  const span = startDate && endDate ? leaveSpanHundredths(leaveType, startDate, endDate) : null
  const me = desk.me
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>What do you need?</h2>
            <p>Pick one. Weekends and Kenya public holidays stay out of the day count.</p>
          </div>
        </div>
        <div className="office-choices">
          {ASK_CHOICES.map((choice) => (
            <button key={choice.kind} type="button" className={kind === choice.kind ? 'selected' : ''} onClick={() => setKind(choice.kind)}>
              <strong>{choice.label}</strong>
              <span>{choice.hint}</span>
            </button>
          ))}
        </div>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const formData = new FormData(form)
            if (receipt) {
              formData.set('attachmentUrl', receipt.url)
              formData.set('attachmentPublicId', receipt.publicId)
              formData.set('attachmentName', receipt.name)
            }
            onSubmit(formData, () => {
              form.reset()
              setReceipt(null)
              setStartDate('')
              setEndDate('')
            })
          }}
        >
          <input type="hidden" name="kind" value={kind} />
          {kind === 'leave' ? (
            <>
              <label>
                Type
                <select name="leaveType" value={leaveType} onChange={(event) => {
                  const next = event.target.value
                  setLeaveType(next)
                  if (next === 'half_day') setEndDate(startDate)
                }}>
                  {(Object.keys(LEAVE_TYPE_LABELS) as Array<keyof typeof LEAVE_TYPE_LABELS>).map((key) => (
                    <option key={key} value={key}>{LEAVE_TYPE_LABELS[key]}</option>
                  ))}
                </select>
              </label>
              <label>
                Cover
                <select name="coverageUserId" defaultValue="">
                  <option value="">No cover</option>
                  {desk.coverOptions.filter((person) => person.id !== currentUserId).map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Start
                <input type="date" name="startDate" required value={startDate} onChange={(event) => {
                  setStartDate(event.target.value)
                  if (leaveType === 'half_day') setEndDate(event.target.value)
                }} />
              </label>
              <label>
                End
                <input type="date" name="endDate" required value={leaveType === 'half_day' ? startDate : endDate} onChange={(event) => setEndDate(event.target.value)} readOnly={leaveType === 'half_day'} />
              </label>
              <p className="span-2 field-hint">
                {span && 'daysHundredths' in span
                  ? `${formatHundredths(span.daysHundredths)} working days. Annual left: ${me ? formatHundredths(me.annualAvailableHundredths) : '—'}. Sick left: ${me ? formatHundredths(me.sickAvailableHundredths) : '—'}.`
                  : span && 'error' in span
                    ? span.error
                    : 'Pick the dates to see the working-day count.'}
              </p>
            </>
          ) : null}
          {kind === 'letter' ? (
            <label className="span-2">
              Letter
              <select name="letterType" value={letterType} onChange={(event) => setLetterType(event.target.value as OfficeLetterType)}>
                {(Object.keys(LETTER_TYPE_LABELS) as OfficeLetterType[]).map((key) => (
                  <option key={key} value={key}>{LETTER_TYPE_LABELS[key]}</option>
                ))}
              </select>
            </label>
          ) : null}
          {kind !== 'leave' && kind !== 'letter' ? (
            <label className="span-2">
              Title
              <input name="title" required placeholder={kind === 'print' ? 'Board pack, 12 pages' : 'What is this for?'} />
            </label>
          ) : null}
          {kind === 'imprest' || kind === 'purchase' ? (
            <label>
              Amount (KES)
              <input name="amountKes" inputMode="numeric" required placeholder="2500" />
            </label>
          ) : null}
          {kind === 'print' ? (
            <label>
              Copies
              <input name="copies" type="number" min={1} max={200} defaultValue={1} />
            </label>
          ) : null}
          <label className="span-2">
            Details
            <textarea name="description" rows={3} placeholder={kind === 'letter' ? 'Who the letter is for, or any line you want included.' : 'Add anything the admin office should know.'} />
          </label>
          {kind === 'print' ? (
            <label className="office-check span-2">
              <input type="checkbox" name="confidential" /> Confidential — not left on the open shelf
            </label>
          ) : null}
          {kind === 'imprest' || kind === 'purchase' || (kind === 'leave' && leaveType === 'sick') ? (
            <div className="span-2">
              <FileDropzone
                kind="office_evidence"
                entityId={currentUserId}
                label={leaveType === 'sick' && kind === 'leave' ? 'Attach a sick sheet if you have one' : 'Attach a receipt or quote'}
                onUploaded={(file) => setReceipt({ url: file.url, publicId: file.publicId, name: file.originalName })}
              />
              {receipt ? <p className="field-hint">Attached: {receipt.name}</p> : null}
            </div>
          ) : null}
          <div className="modal-actions span-2">
            <Button className="create-button" type="submit" disabled={pending || !desk.ready}>Submit</Button>
            {kind === 'letter' ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={(event) => {
                  const form = event.currentTarget.form
                  if (!form) return
                  void onPreview(new FormData(form))
                }}
              >
                Preview
              </Button>
            ) : null}
          </div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Your balances</h2>
            <p>Working days, after Kenya public holidays</p>
          </div>
        </div>
        {me ? (
          <div className="office-balance">
            <p><strong>{formatHundredths(me.annualAvailableHundredths)}</strong> annual days left · {formatHundredths(me.thisYearAnnualHundredths)} this year, {formatHundredths(me.carryOverHundredths)} carried in</p>
            <p><strong>{formatHundredths(me.sickAvailableHundredths)}</strong> sick days left</p>
            {me.missingStartDate ? <p className="field-hint">Your start date is not on file, so annual leave is showing the full-year amount.</p> : null}
          </div>
        ) : <p className="empty-state">Your staff record will appear after the office database is ready.</p>}
        <h3 className="office-subhead">Out in the next 45 days</h3>
        {desk.outNow.length === 0 ? <p className="empty-state">Nobody has approved leave in that window.</p> : (
          <ul className="office-list">
            {desk.outNow.slice(0, 8).map((row) => (
              <li key={row.requestId}><strong>{row.name}</strong> · {prettyDate(row.startDate)} to {prettyDate(row.endDate)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MinePanel({
  desk,
  pending,
  onCancel,
  onSaveContact,
}: {
  desk: OfficeDesk
  pending: boolean
  onCancel: (id: string) => void
  onSaveContact: (formData: FormData) => void
}) {
  const me = desk.me
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>My requests</h2><p>Print an approved letter from here.</p></div></div>
        {desk.requests.filter((row) => row.requestorId === me?.id).length === 0 ? <p className="empty-state">You have not sent a request yet.</p> : desk.requests.filter((row) => row.requestorId === me?.id).map((row) => (
          <RequestCard key={row.id} row={row} pending={pending} canDecide={false} onCancel={onCancel} />
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Emergency contact</h2><p>Only the admin office sees this besides you.</p></div></div>
        {me ? (
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSaveContact(new FormData(event.currentTarget)) }}>
            <input type="hidden" name="userId" value={me.id} />
            <label className="span-2">Name<input name="emergencyName" defaultValue={me.emergencyName ?? ''} /></label>
            <label className="span-2">Phone<input name="emergencyPhone" defaultValue={me.emergencyPhone ?? ''} /></label>
            <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Save</Button></div>
          </form>
        ) : null}
      </section>
    </div>
  )
}

function PoliciesPanel({ desk, pending, onAck }: { desk: OfficeDesk; pending: boolean; onAck: (id: string) => void }) {
  const rows = desk.documents.filter((row) => row.status === 'published')
  return (
    <section className="panel">
      <div className="panel-heading"><div><h2>Policies</h2><p>Read the text, then acknowledge it.</p></div></div>
      {rows.length === 0 ? <p className="empty-state">No published policies yet.</p> : rows.map((row) => (
        <article key={row.id} className="office-card">
          <header><strong>{row.title}</strong>{row.acknowledged ? <Chip tone="good">Acknowledged</Chip> : <Chip tone="attention">Needs you</Chip>}</header>
          {row.body ? <p>{row.body}</p> : null}
          {row.fileUrl ? <p><a href={row.fileUrl} target="_blank" rel="noreferrer">Open file</a></p> : null}
          {!row.acknowledged ? <Button type="button" className="create-button" disabled={pending} onClick={() => onAck(row.id)}>I have read this</Button> : null}
        </article>
      ))}
    </section>
  )
}

function PeoplePanel({ desk, pending, onSave }: { desk: OfficeDesk; pending: boolean; onSave: (formData: FormData) => void }) {
  const [query, setQuery] = useState('')
  const firstGap = desk.people.find((person) => person.missingStartDate)?.id ?? desk.people[0]?.id ?? ''
  const [picked, setPicked] = useState(firstGap)
  const rows = desk.people.filter((person) => `${person.name} ${person.jobTitle} ${person.departmentName ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const person = rows.find((row) => row.id === picked) ?? rows[0] ?? null
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>People</h2>
          <p>Click a name to update their record. Annual leave is 21 working days for a full year, pro-rated from the start date. Unused days carry up to 10 into the next year.</p>
        </div>
        <button
          type="button"
          className="filter-pill"
          onClick={() => downloadCsv('staff-leave.csv', [
            ['Name', 'Type', 'Department', 'Start', 'End', 'Annual left', 'Sick left'],
            ...desk.people.map((row) => [row.name, row.employmentType, row.departmentName ?? '', row.startDate ?? '', row.endDate ?? '', formatHundredths(row.annualAvailableHundredths), formatHundredths(row.sickAvailableHundredths)]),
          ])}
        >
          Export CSV
        </button>
      </div>
      <label className="office-search">Find someone<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, role, department" /></label>
      <div className="office-split">
        <div className="office-table-wrap">
          <table className="office-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Annual left</th>
                <th>Sick left</th>
                <th>Start</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={person?.id === row.id ? 'selected' : ''} onClick={() => setPicked(row.id)}>
                  <td>
                    <button type="button" className="office-name" onClick={() => setPicked(row.id)}>
                      <strong>{row.name}</strong>
                      {row.missingStartDate ? <span className="office-gap">Needs a start date</span> : null}
                    </button>
                  </td>
                  <td>{row.jobTitle}</td>
                  <td>{row.departmentName ?? '—'}</td>
                  <td>{formatHundredths(row.annualAvailableHundredths)}</td>
                  <td>{formatHundredths(row.sickAvailableHundredths)}</td>
                  <td>{prettyDate(row.startDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="empty-state">No one matches that search.</p> : null}
        </div>
        {person ? (
          <form key={person.id} className="form-grid office-editor" onSubmit={(event) => { event.preventDefault(); onSave(new FormData(event.currentTarget)) }}>
            <div>
              <h3>{person.name}</h3>
              <p className="office-meta">{EMPLOYMENT_TYPE_LABELS[person.employmentType]} · {person.status}</p>
            </div>
            <input type="hidden" name="userId" value={person.id} />
            <label>Employment<select name="employmentType" defaultValue={person.employmentType}>{(Object.keys(EMPLOYMENT_TYPE_LABELS) as Array<keyof typeof EMPLOYMENT_TYPE_LABELS>).map((key) => <option key={key} value={key}>{EMPLOYMENT_TYPE_LABELS[key]}</option>)}</select></label>
            <label>Annual policy (days)<input name="annualEntitlementDays" defaultValue={person.annualPolicyDays} /></label>
            <label>Sick policy (days)<input name="sickEntitlementDays" defaultValue={person.sickPolicyDays} /></label>
            <label>Carry-over (days)<input name="carryOverDays" defaultValue={formatHundredths(person.carryOverHundredths)} /></label>
            <label>Start<input type="date" name="startDate" defaultValue={person.startDate ?? ''} /></label>
            <label>Contract end<input type="date" name="endDate" defaultValue={person.endDate ?? ''} /></label>
            <label>Probation end<input type="date" name="probationEndDate" defaultValue={person.probationEndDate ?? ''} /></label>
            <label>Emergency name<input name="emergencyName" defaultValue={person.emergencyName ?? ''} /></label>
            <label>Emergency phone<input name="emergencyPhone" defaultValue={person.emergencyPhone ?? ''} /></label>
            <label className="span-2">Notes<textarea name="notes" rows={2} defaultValue={person.notes ?? ''} /></label>
            <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Save {person.name.split(' ')[0]}</Button></div>
          </form>
        ) : null}
      </div>
    </section>
  )
}

function CalendarPanel({ desk }: { desk: OfficeDesk }) {
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>Who is out</h2><p>Approved leave over the next 45 days</p></div></div>
        {desk.outNow.length === 0 ? <p className="empty-state">No approved leave in that window.</p> : (
          <ul className="office-list">
            {desk.outNow.map((row) => (
              <li key={row.requestId}><strong>{row.name}</strong>{row.departmentName ? ` · ${row.departmentName}` : ''} · {row.leaveType ? LEAVE_TYPE_LABELS[row.leaveType] : 'Leave'} · {prettyDate(row.startDate)} to {prettyDate(row.endDate)}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Kenya public holidays</h2><p>{desk.today.slice(0, 4)}. Sunday holidays are observed on Monday.</p></div></div>
        <ul className="office-list">
          {desk.holidays.map((holiday) => (
            <li key={holiday.date}><strong>{prettyDate(holiday.date)}</strong> · {holiday.name}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function OffersPanel({
  desk,
  pending,
  canIssue,
  onSave,
  onDecide,
}: {
  desk: OfficeDesk
  pending: boolean
  canIssue: boolean
  onSave: (formData: FormData) => void
  onDecide: (id: string, decision: 'send' | 'issue' | 'accept' | 'decline' | 'withdraw') => void
}) {
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>New offer</h2><p>The managing director issues it. The letter is numbered when it is issued.</p></div></div>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; onSave(new FormData(form)); form.reset() }}>
          <label>Candidate<input name="candidateName" required /></label>
          <label>Email<input name="candidateEmail" type="email" /></label>
          <label>Job title<input name="jobTitle" required /></label>
          <label>Department<select name="departmentId" defaultValue=""><option value="">Unassigned</option>{desk.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>Start<input type="date" name="startDate" /></label>
          <label>Probation (months)<input name="probationMonths" defaultValue="3" /></label>
          <label className="span-2">Compensation<input name="salaryText" placeholder="KES 80,000 per month" /></label>
          <label className="span-2">Extra terms<textarea name="notes" rows={2} /></label>
          <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Save draft</Button></div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Offers</h2></div></div>
        {desk.offers.length === 0 ? <p className="empty-state">No offers yet.</p> : [...desk.offers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((offer) => (
          <article key={offer.id} className="office-card">
            <header><div><strong>{offer.candidateName}</strong><p>{offer.jobTitle}{offer.departmentName ? ` · ${offer.departmentName}` : ''}</p></div><Chip>{OFFER_STATUS_LABELS[offer.status] ?? offer.status}</Chip></header>
            <p className="office-meta">{offer.documentNumber ?? 'Draft number'}{offer.salaryText ? ` · ${offer.salaryText}` : ''}{offer.startDate ? ` · starts ${prettyDate(offer.startDate)}` : ''}</p>
            <button type="button" className="filter-pill" onClick={() => printHtml(offer.bodyHtml)}>Print</button>
            <div className="office-actions">
              {offer.status === 'draft' ? <Button type="button" disabled={pending} onClick={() => onDecide(offer.id, 'send')}>Send to MD</Button> : null}
              {canIssue && (offer.status === 'draft' || offer.status === 'awaiting_md') ? <Button type="button" className="create-button" disabled={pending} onClick={() => onDecide(offer.id, 'issue')}>Issue</Button> : null}
              {offer.status === 'issued' ? (
                <>
                  <Button type="button" disabled={pending} onClick={() => onDecide(offer.id, 'accept')}>Accepted</Button>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => onDecide(offer.id, 'decline')}>Declined</Button>
                </>
              ) : null}
              {offer.status !== 'accepted' && offer.status !== 'declined' && offer.status !== 'withdrawn' ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => onDecide(offer.id, 'withdraw')}>Withdraw</Button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

function FinancePanel({
  desk,
  colleagues,
  pending,
  onSave,
}: {
  desk: OfficeDesk
  colleagues: { id: string; firstName: string; lastName: string }[]
  pending: boolean
  onSave: (formData: FormData) => void
}) {
  const money = desk.requests.filter((row) => row.kind === 'imprest' || row.kind === 'purchase')
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>Imprest and purchases</h2><p>{formatKes(desk.imprestOutstandingKes)} is issued and not retired.</p></div></div>
        {money.length === 0 ? <p className="empty-state">No money requests yet. People send them from My office.</p> : money.map((row) => (
          <article key={row.id} className="office-card">
            <header>
              <div><strong>{row.title}</strong><p>{row.requestorName}</p></div>
              <Chip tone={isOpenRequest(row) ? 'attention' : row.status === 'approved' || row.status === 'completed' ? 'good' : 'calm'}>{requestStatusLabel(row.kind, row.status)}</Chip>
            </header>
            <p className="office-meta">{REQUEST_KIND_LABELS[row.kind]} · {formatKes(row.amountKes)}</p>
          </article>
        ))}
        <button type="button" className="filter-pill" onClick={() => downloadCsv('imprest.csv', [['Title', 'Person', 'Kind', 'Amount', 'Status'], ...money.map((row) => [row.title, row.requestorName, row.kind, String(row.amountKes), row.status])])}>Export CSV</button>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Vendors</h2><p>Renewals inside 45 days appear on Today.</p></div></div>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; onSave(new FormData(form)); form.reset() }}>
          <label>Name<input name="name" required /></label>
          <label>Category<input name="category" placeholder="software, lease, insurance" /></label>
          <label>Renewal<input type="date" name="renewalDate" /></label>
          <label>Amount (KES)<input name="amountKes" defaultValue="0" /></label>
          <label className="span-2">Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{colleagues.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select></label>
          <label className="span-2">Notes<textarea name="notes" rows={2} /></label>
          <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Add vendor</Button></div>
        </form>
        <ul className="office-list">
          {desk.vendors.map((vendor) => (
            <li key={vendor.id}><strong>{vendor.name}</strong> · {vendor.category}{vendor.renewalDate ? ` · renews ${prettyDate(vendor.renewalDate)}` : ''}{vendor.amountKes ? ` · ${formatKes(vendor.amountKes)}` : ''}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function DocumentsPanel({
  currentUserId,
  desk,
  pending,
  onSave,
}: {
  currentUserId: string
  desk: OfficeDesk
  pending: boolean
  onSave: (formData: FormData) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('policy')
  const [fileUrl, setFileUrl] = useState('')
  return (
    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>File a document</h2><p>Published policies ask every person to acknowledge them.</p></div></div>
        <div className="office-tabs">
          {DOCUMENT_STARTERS.map((starter) => (
            <button key={starter.id} type="button" onClick={() => { setTitle(starter.title); setBody(starter.body); setCategory(starter.category) }}>{starter.title}</button>
          ))}
        </div>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault()
          const formData = new FormData(event.currentTarget)
          if (fileUrl) formData.set('fileUrl', fileUrl)
          onSave(formData)
          setTitle('')
          setBody('')
          setFileUrl('')
        }}>
          <label className="span-2">Title<input name="title" required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Category<input name="category" value={category} onChange={(event) => setCategory(event.target.value)} /></label>
          <label>Status<select name="status" defaultValue="draft"><option value="draft">Draft</option><option value="review">In review</option><option value="published">Published</option></select></label>
          <label>Effective<input type="date" name="effectiveDate" /></label>
          <label>Review by<input type="date" name="reviewDate" /></label>
          <label className="span-2">Text<textarea name="body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          <div className="span-2">
            <FileDropzone kind="office_evidence" entityId={currentUserId} label="Or upload the file" onUploaded={(file) => setFileUrl(file.url)} />
          </div>
          <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Save document</Button></div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Registry</h2></div></div>
        {desk.documents.length === 0 ? <p className="empty-state">Nothing filed yet.</p> : desk.documents.map((row) => (
          <article key={row.id} className="office-card">
            <header><strong>{row.title}</strong><Chip>{row.status}</Chip></header>
            <p className="office-meta">{row.documentNumber ?? 'No number yet'} · {row.category}{row.reviewDate ? ` · review ${prettyDate(row.reviewDate)}` : ''} · {row.ackCount}/{row.staffCount} acknowledged</p>
            {row.body ? <p>{row.body}</p> : null}
          </article>
        ))}
      </section>
    </div>
  )
}

function AssetsPanel({
  desk,
  colleagues,
  pending,
  onSave,
}: {
  desk: OfficeDesk
  colleagues: { id: string; firstName: string; lastName: string }[]
  pending: boolean
  onSave: (formData: FormData) => void
}) {
  return (
    <section className="panel">
      <div className="panel-heading"><div><h2>Assets</h2><p>Laptops, phones, and anything that has to come back when someone leaves.</p></div></div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; onSave(new FormData(form)); form.reset() }}>
        <label>Name<input name="name" required placeholder="Laptop" /></label>
        <label>Tag<input name="assetTag" placeholder="GCS-LT-014" /></label>
        <label>Assigned to<select name="assignedUserId" defaultValue=""><option value="">In stock</option>{colleagues.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select></label>
        <label>Status<select name="status" defaultValue="in_stock"><option value="in_stock">In stock</option><option value="assigned">Assigned</option><option value="repair">In repair</option><option value="retired">Retired</option></select></label>
        <label className="span-2">Notes<textarea name="notes" rows={2} /></label>
        <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Add asset</Button></div>
      </form>
      <ul className="office-list">
        {desk.assets.map((asset) => (
          <li key={asset.id}><strong>{asset.name}</strong>{asset.assetTag ? ` · ${asset.assetTag}` : ''} · {asset.status}{asset.assignedName ? ` · ${asset.assignedName}` : ''}</li>
        ))}
      </ul>
    </section>
  )
}

function CompliancePanel({
  desk,
  pending,
  onSave,
  onDone,
}: {
  desk: OfficeDesk
  pending: boolean
  onSave: (formData: FormData) => void
  onDone: (id: string) => void
}) {
  const items = [...desk.compliance].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  const cadenceLabel: Record<string, string> = { once: 'One time', monthly: 'Every month', quarterly: 'Every quarter', annual: 'Every year' }
  const dueLabel = { upcoming: 'Coming up', due: 'Due now', overdue: 'Overdue', done: 'Done' }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Reminders</h2>
          <p>PAYE, NSSF, SHIF, and NITA are reminders, not a tax return. Marking a repeating item done moves it to the next date.</p>
        </div>
      </div>
      {items.map((item) => (
        <article key={item.id} className="office-card">
          <header>
            <div><strong>{item.title}</strong><p>{cadenceLabel[item.cadence] ?? item.cadence}{item.dueDate ? ` · due ${prettyDate(item.dueDate)}` : ''}</p></div>
            <Chip tone={item.status === 'overdue' || item.status === 'due' ? 'attention' : item.status === 'done' ? 'good' : 'calm'}>{dueLabel[item.status]}</Chip>
          </header>
          {item.notes ? <p>{item.notes}</p> : null}
          {item.status !== 'done' ? <Button type="button" disabled={pending} onClick={() => onDone(item.id)}>Mark done</Button> : null}
        </article>
      ))}
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; onSave(new FormData(form)); form.reset() }}>
        <label>Title<input name="title" required /></label>
        <label>How often<select name="cadence" defaultValue="once"><option value="once">Once</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
        <label>Due<input type="date" name="dueDate" /></label>
        <label>Category<input name="category" defaultValue="statutory" /></label>
        <label className="span-2">Notes<textarea name="notes" rows={2} /></label>
        <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Add reminder</Button></div>
      </form>
    </section>
  )
}
