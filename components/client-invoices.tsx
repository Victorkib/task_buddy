'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { Download, FileText, Plus, Printer, ReceiptText } from 'lucide-react'
import { emailInvoice, outlookInvoice, setInvoiceStatus } from '@/app/admin-office-actions'
import { clientInvoiceFile, deleteClientInvoice, saveClientInvoices } from '@/app/client-invoice-actions'
import { OfficeDrawer } from '@/components/admin-office-invoices'
import { Button } from '@/components/ui/button'
import { centsToAmount, parseAmountText } from '@/lib/admin-office/expenses'
import { downloadBytes, downloadHtml, openPrintWindow, wait, writeAndPrint } from '@/lib/admin-office/invoice-download'
import {
  formatMoney,
  formatQuantity,
  invoiceTotals,
  MPESA_ON_EVERY_INVOICE,
  parseQuantity,
  parseVatRate,
  vatRateInput,
} from '@/lib/admin-office/invoices'
import { billingPlan, childrenOf } from '@/lib/clients/family'
import {
  CLIENT_KIND_LABELS,
  type ClientBilling,
  type ClientDeskCapabilities,
  type ClientInvoiceView,
  type ClientRecord,
} from '@/lib/clients/types'

const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' } as const

function errorOf(result: unknown): string | null {
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as { error?: unknown }).error
    if (typeof error === 'string' && error) return error
  }
  return null
}

function noticeOf(result: unknown): string | null {
  if (result && typeof result === 'object' && 'notice' in result) {
    const notice = (result as { notice?: unknown }).notice
    if (typeof notice === 'string' && notice) return notice
  }
  return null
}

function invoiceTotal(invoice: ClientInvoiceView) {
  return invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps).totalCents
}

function isOverdue(invoice: ClientInvoiceView, today: string) {
  return invoice.status === 'sent' && invoice.dueDate != null && invoice.dueDate < today
}

function statusChip(invoice: ClientInvoiceView, today: string) {
  const late = isOverdue(invoice, today)
  const tone = late || invoice.status === 'void' ? 'attention' : invoice.status === 'paid' ? 'good' : 'calm'
  return <i className={`office-chip office-chip-${tone}`}>{late ? 'Overdue' : STATUS_LABEL[invoice.status]}</i>
}

/** Fetches the saved invoice file and downloads it. Returns an error message, or null. */
async function downloadInvoice(id: string) {
  const result = await clientInvoiceFile(id)
  const error = errorOf(result)
  if (error) return error
  if (!('html' in result) || !result.html) return 'The invoice could not be prepared.'
  downloadHtml(result.filename, result.html)
  return null
}

/** Must be called from the click itself so the print window is not blocked. */
function startPrint(id: string, report: (error: string | null) => void) {
  const win = openPrintWindow()
  if (!win) {
    report('Allow pop-up windows so the invoice can open for printing.')
    return
  }
  void (async () => {
    const result = await clientInvoiceFile(id)
    const error = errorOf(result)
    if (error || !('html' in result) || !result.html) {
      win.close()
      report(error ?? 'The invoice could not be prepared.')
      return
    }
    writeAndPrint(win, result.html)
    report(null)
  })()
}

export function ClientInvoicesSection({
  record,
  clientsById,
  billing,
  caps,
  onRefresh,
}: {
  record: ClientRecord
  clientsById: Map<string, ClientRecord>
  billing: ClientBilling
  caps: ClientDeskCapabilities
  onRefresh?: () => void
}) {
  const [composer, setComposer] = useState<{ editing: ClientInvoiceView | null; seq: number } | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const invoices = useMemo(
    () =>
      billing.invoices.filter(
        (invoice) => invoice.clientId === record.id || invoice.lines.some((line) => line.subjectClientId === record.id),
      ),
    [billing.invoices, record.id],
  )
  const outstanding = invoices
    .filter((invoice) => invoice.status === 'sent')
    .reduce((sum, invoice) => sum + invoiceTotal(invoice), 0)
  const overdueCount = invoices.filter((invoice) => isOverdue(invoice, billing.today)).length

  function subjectsOf(invoice: ClientInvoiceView) {
    const names = [...new Set(invoice.lines.flatMap((line) => (line.subjectClientId ? [line.subjectClientId] : [])))]
      .filter((id) => id !== invoice.clientId)
      .map((id) => clientsById.get(id)?.name)
      .filter((name): name is string => Boolean(name))
    return names
  }

  function download(id: string) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const problem = await downloadInvoice(id)
      if (problem) setError(problem)
      else setNotice('Invoice downloaded. Open it in a browser to print, or attach it to an email.')
    })
  }

  return (
    <section className="clients-invoices" aria-label="Invoices">
      <header className="clients-family-head">
        <span className="clients-family-icon is-billing" aria-hidden="true">
          <ReceiptText />
        </span>
        <div>
          <strong>Invoices</strong>
          <p>
            {invoices.length === 0
              ? `Nothing billed for ${record.name} yet.`
              : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}${
                  outstanding ? ` · ${formatMoney(outstanding)} awaiting payment` : ''
                }${overdueCount ? ` · ${overdueCount} overdue` : ''}`}
          </p>
        </div>
        <Button
          type="button"
          className="create-button clients-invoices-new"
          disabled={!billing.ready}
          onClick={() => setComposer({ editing: null, seq: Date.now() })}
        >
          <Plus aria-hidden="true" /> New invoice
        </Button>
      </header>

      {!billing.ready && billing.setupMessage ? <p className="invoice-note invoice-note-warn">{billing.setupMessage}</p> : null}
      {!billing.canIssue ? (
        <p className="invoice-note">You prepare drafts here. Sending and recording payment needs full client access: view, create, edit, and delete.</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}

      {invoices.length > 0 ? (
        <ul className="clients-invoice-list">
          {invoices.map((invoice) => {
            const subjects = subjectsOf(invoice)
            const billedElsewhere = invoice.clientId !== record.id
            return (
              <li key={invoice.id}>
                <button
                  type="button"
                  className="clients-invoice-open"
                  onClick={() => setComposer({ editing: invoice, seq: Date.now() })}
                >
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>{invoice.documentNumber ?? 'Draft'}</strong>
                    <small>
                      {invoice.issueDate}
                      {billedElsewhere ? ` · Billed to ${invoice.clientName}` : ''}
                      {subjects.length ? ` · For ${subjects.join(', ')}` : ''}
                    </small>
                  </span>
                  <em>
                    {statusChip(invoice, billing.today)}
                    {formatMoney(invoiceTotal(invoice))}
                  </em>
                </button>
                <div className="clients-invoice-actions">
                  <button type="button" disabled={pending} aria-label={`Download ${invoice.documentNumber ?? 'invoice'}`} onClick={() => download(invoice.id)}>
                    <Download aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Print ${invoice.documentNumber ?? 'invoice'}`}
                    onClick={() => {
                      setError(null)
                      startPrint(invoice.id, (problem) => setError(problem))
                    }}
                  >
                    <Printer aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {composer ? (
        <InvoiceComposer
          key={composer.seq}
          record={record}
          clientsById={clientsById}
          billing={billing}
          caps={caps}
          editing={composer.editing}
          onClose={() => setComposer(null)}
          onDone={(message) => {
            setComposer(null)
            setNotice(message)
          }}
          onRefresh={onRefresh}
        />
      ) : null}
    </section>
  )
}

type LineDraft = { key: string; description: string; quantity: string; rate: string }
type GroupDraft = { subjectId: string | null; included: boolean; lines: LineDraft[] }
type Contact = { name: string; email: string; phone: string; address: string; pin: string }
type Mode = 'combined' | 'per_child'

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

function defaultLine(student?: ClientRecord | null): LineDraft {
  return {
    key: newKey(),
    description: student ? `Tuition — ${student.name}${student.programmeName ? ` (${student.programmeName})` : ''}` : '',
    quantity: '1',
    rate: '',
  }
}

function contactFrom(client: ClientRecord): Contact {
  return {
    name: client.name,
    email: client.email ?? '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    pin: client.pin ?? '',
  }
}

/** One group per student on the bill (the record's own child first), plus general charges. */
function buildGroups(billTo: ClientRecord, anchor: ClientRecord, previous: GroupDraft[], byId: Map<string, ClientRecord>) {
  const subjects: ClientRecord[] = []
  if (billTo.kind === 'student') subjects.push(billTo)
  else {
    if (anchor.kind === 'student') subjects.push(anchor)
    for (const child of childrenOf(billTo, byId)) {
      if (!subjects.some((subject) => subject.id === child.id)) subjects.push(child)
    }
  }
  const groups: GroupDraft[] = subjects.map(
    (subject) =>
      previous.find((group) => group.subjectId === subject.id) ?? {
        subjectId: subject.id,
        // From a student's page, siblings are offered but left off; from a parent's page, every child is on.
        included: anchor.kind === 'student' ? subject.id === anchor.id : true,
        lines: [defaultLine(subject)],
      },
  )
  const shared = previous.find((group) => group.subjectId === null) ?? {
    subjectId: null,
    included: true,
    lines: subjects.length ? [] : [defaultLine()],
  }
  return [...groups, shared]
}

function groupsFromInvoice(invoice: ClientInvoiceView): GroupDraft[] {
  const order: (string | null)[] = []
  for (const line of invoice.lines) {
    if (!order.includes(line.subjectClientId)) order.push(line.subjectClientId)
  }
  if (!order.includes(null)) order.push(null)
  return order
    .sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0))
    .map((subjectId) => ({
      subjectId,
      included: true,
      lines: invoice.lines
        .filter((line) => line.subjectClientId === subjectId)
        .map((line) => ({
          key: line.id,
          description: line.description,
          quantity: formatQuantity(line.quantityHundredths),
          rate: centsToAmount(line.rateCents),
        })),
    }))
}

function lineState(line: LineDraft) {
  if (!line.description.trim() && !line.rate.trim()) return 'blank' as const
  if (line.description.trim() && parseQuantity(line.quantity) != null && parseAmountText(line.rate) != null) return 'ok' as const
  return 'partial' as const
}

type PlannedInvoice = {
  label: string
  lines: { description: string; quantity: string; rate: string; subjectClientId: string | null }[]
  notes: string
  totalCents: number
  subtotalCents: number
  vatCents: number
}

function InvoiceComposer({
  record,
  clientsById,
  billing,
  caps,
  editing,
  onClose,
  onDone,
  onRefresh,
}: {
  record: ClientRecord
  clientsById: Map<string, ClientRecord>
  billing: ClientBilling
  caps: ClientDeskCapabilities
  editing: ClientInvoiceView | null
  onClose: () => void
  onDone: (notice: string) => void
  onRefresh?: () => void
}) {
  const plan = useMemo(() => billingPlan(record, clientsById), [record, clientsById])
  const startBillTo = editing ? (editing.clientId ? clientsById.get(editing.clientId) : undefined) ?? plan.billTo : plan.billTo
  const [billToId, setBillToId] = useState(startBillTo.id)
  const [contact, setContact] = useState<Contact>(() =>
    editing
      ? {
          name: editing.clientName,
          email: editing.clientEmail ?? '',
          phone: editing.clientPhone ?? '',
          address: editing.clientAddress ?? '',
          pin: editing.clientPin ?? '',
        }
      : contactFrom(startBillTo),
  )
  const [updateClient, setUpdateClient] = useState(false)
  const [mode, setMode] = useState<Mode>('combined')
  const [issueDate, setIssueDate] = useState(editing?.issueDate ?? billing.today)
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? '')
  const [vatEnabled, setVatEnabled] = useState(editing?.vatEnabled ?? billing.invoiceSettings.vatEnabled)
  const [vatRate, setVatRate] = useState(vatRateInput(editing?.vatRateBps ?? billing.invoiceSettings.vatRateBps))
  const [companyPin, setCompanyPin] = useState(editing ? editing.companyPin ?? '' : billing.invoiceSettings.companyPin ?? '')
  const [paymentIds, setPaymentIds] = useState<string[]>(
    editing ? editing.paymentIds : billing.paymentAccounts.filter((account) => account.active).map((account) => account.id),
  )
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    editing ? groupsFromInvoice(editing) : buildGroups(startBillTo, record, [], clientsById),
  )
  const [savedInvoices, setSavedInvoices] = useState<{ id: string; documentNumber: string | null; label: string; totalCents: number }[] | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const live = editing ? billing.invoices.find((invoice) => invoice.id === editing.id) ?? editing : null
  // An invoice billed to someone outside this person's directory is shown, never re-addressed.
  const billToHidden = Boolean(editing && (!editing.clientId || !clientsById.has(editing.clientId)))
  const readOnly = Boolean(live && (billToHidden || live.status === 'void' || (!billing.canIssue && live.status !== 'draft')))
  const billTo = clientsById.get(billToId) ?? startBillTo
  const billToOptions = editing ? [billTo] : plan.options
  const childGroups = groups.filter((group) => group.subjectId !== null)
  const includedChildren = childGroups.filter((group) => group.included)
  const splitting = !editing && mode === 'per_child' && includedChildren.length >= 2
  const accounts = billing.paymentAccounts.filter((account) => account.active || paymentIds.includes(account.id))

  // Recomputed each render; it is a handful of lines and keeps the preview exact.
  const planned = ((): { invoices: PlannedInvoice[]; problem: string | null } => {
    const rate = parseVatRate(vatRate || '0')
    if (rate == null) return { invoices: [], problem: 'Enter the VAT rate, such as 16.' }
    const shared = groups.find((group) => group.subjectId === null)
    const included = groups.filter((group) => group.subjectId !== null && group.included)
    for (const group of [...included, ...(shared ? [shared] : [])]) {
      const partial = group.lines.find((line) => lineState(line) === 'partial')
      if (partial) {
        return {
          invoices: [],
          problem: `Finish or clear the line “${partial.description.trim() || 'without a description'}”. Each line needs a description, a quantity, and a rate.`,
        }
      }
    }
    for (const group of included) {
      if (!group.lines.some((line) => lineState(line) === 'ok')) {
        const name = clientsById.get(group.subjectId ?? '')?.name ?? 'this student'
        return { invoices: [], problem: editing ? `Add a charge for ${name}.` : `Add a charge for ${name}, or untick them.` }
      }
    }
    const ready = (group: GroupDraft, subjectClientId: string | null) =>
      group.lines
        .filter((line) => lineState(line) === 'ok')
        .map((line) => ({ description: line.description.trim(), quantity: line.quantity, rate: line.rate, subjectClientId }))
    const sharedLines = shared ? shared.lines.filter((line) => lineState(line) === 'ok') : []
    const finish = (label: string, lines: PlannedInvoice['lines'], invoiceNotes: string): PlannedInvoice => {
      const totals = invoiceTotals(
        lines.map((line) => ({
          description: line.description,
          quantityHundredths: parseQuantity(line.quantity) ?? 0,
          rateCents: parseAmountText(line.rate) ?? 0,
        })),
        vatEnabled,
        rate,
      )
      return { label, lines, notes: invoiceNotes, ...totals }
    }

    if (splitting) {
      return {
        invoices: included.map((group) => {
          const child = clientsById.get(group.subjectId ?? '')
          const forLine = child ? `For ${child.name}${child.programmeName ? ` · ${child.programmeName}` : ''}.` : ''
          const lines = [
            ...ready(group, group.subjectId),
            ...sharedLines.map((line) => ({
              description: line.description.trim(),
              quantity: line.quantity,
              rate: line.rate,
              subjectClientId: group.subjectId,
            })),
          ]
          return finish(child?.name ?? 'Student', lines, [forLine, notes.trim()].filter(Boolean).join('\n\n'))
        }),
        problem: null,
      }
    }

    const soleSubject = included.length === 1 ? included[0].subjectId : null
    const lines = [
      ...included.flatMap((group) => ready(group, group.subjectId)),
      ...(shared ? ready(shared, soleSubject) : []),
    ]
    if (lines.length === 0) return { invoices: [], problem: 'Add at least one charge with a description and a rate.' }
    return { invoices: [finish(contact.name || billTo.name, lines, notes.trim())], problem: null }
  })()

  const grandTotal = planned.invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0)

  function chooseBillTo(id: string) {
    const next = clientsById.get(id)
    if (!next) return
    setBillToId(next.id)
    setContact(contactFrom(next))
    setGroups((current) => buildGroups(next, record, current, clientsById))
  }

  function updateGroup(index: number, change: (group: GroupDraft) => GroupDraft) {
    setGroups((current) => current.map((group, i) => (i === index ? change(group) : group)))
  }

  function updateLine(groupIndex: number, key: string, patch: Partial<LineDraft>) {
    updateGroup(groupIndex, (group) => ({
      ...group,
      lines: group.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }))
  }

  function run(action: () => Promise<unknown>, after?: (result: unknown) => void) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await action()
      const problem = errorOf(result)
      if (problem) {
        setError(problem)
        return
      }
      setNotice(noticeOf(result))
      after?.(result)
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (readOnly) return
    if (planned.problem) {
      setError(planned.problem)
      return
    }
    if (dueDate && dueDate < issueDate) {
      setError('The due date cannot be before the invoice date.')
      return
    }
    const payload = {
      invoiceId: live?.id ?? '',
      billToId,
      billTo: contact,
      updateClient,
      issueDate,
      dueDate,
      vatEnabled,
      vatRate,
      companyPin,
      notes: '',
      paymentIds,
      invoices: planned.invoices.map((invoice) => ({ lines: invoice.lines, notes: invoice.notes })),
    }
    run(
      () => saveClientInvoices(payload),
      (result) => {
        onRefresh?.()
        if (live) return
        if (result && typeof result === 'object' && 'invoices' in result && Array.isArray(result.invoices)) {
          const saved = result.invoices as { id: string; documentNumber: string | null }[]
          setSavedInvoices(
            saved.map((invoice, index) => ({
              ...invoice,
              label: planned.invoices[index]?.label ?? contact.name,
              totalCents: planned.invoices[index]?.totalCents ?? 0,
            })),
          )
        }
      },
    )
  }

  function downloadAll(ids: string[]) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      for (const [index, id] of ids.entries()) {
        const problem = await downloadInvoice(id)
        if (problem) {
          setError(problem)
          return
        }
        // Browsers drop downloads fired in the same instant; space them out.
        if (index < ids.length - 1) await wait(450)
      }
      setNotice(
        ids.length === 1
          ? 'Invoice downloaded.'
          : `${ids.length} invoices downloaded, one file per child. If your browser asks, allow multiple downloads.`,
      )
    })
  }

  function outlookFile(id: string) {
    run(async () => {
      const result = await outlookInvoice(id)
      const problem = errorOf(result)
      if (problem) return result
      if (result && 'base64' in result && result.base64 && result.filename) {
        downloadBytes(result.filename, Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0)), 'message/rfc822')
        return { notice: 'Outlook message downloaded. Open it and press Send; the invoice is already attached.' }
      }
      return { error: 'Outlook could not be prepared from this invoice.' }
    })
  }

  const title = savedInvoices
    ? savedInvoices.length === 1
      ? 'Invoice saved'
      : `${savedInvoices.length} invoices saved`
    : live
      ? live.documentNumber ?? 'Invoice'
      : `New invoice · ${record.name}`

  return (
    <OfficeDrawer
      title={title}
      subtitle={savedInvoices ? 'Download or print them now, or later from the Invoices list.' : `Billed to ${contact.name || billTo.name}`}
      badge={
        live ? (
          <span className={`office-chip office-chip-${live.status === 'paid' ? 'good' : live.status === 'void' ? 'attention' : 'calm'}`}>
            {STATUS_LABEL[live.status]}
          </span>
        ) : null
      }
      onClose={onClose}
    >
      {savedInvoices ? (
        <div className="office-drawer-form">
          {error ? <p className="form-error">{error}</p> : null}
          {notice ? <p className="form-success">{notice}</p> : null}
          <ul className="clients-invoice-list">
            {savedInvoices.map((invoice) => (
              <li key={invoice.id}>
                <div className="clients-invoice-open is-static">
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>{invoice.documentNumber ?? 'Draft'}</strong>
                    <small>{savedInvoices.length > 1 ? `For ${invoice.label}` : `Billed to ${contact.name}`}</small>
                  </span>
                  <em>{formatMoney(invoice.totalCents)}</em>
                </div>
                <div className="clients-invoice-actions">
                  <button type="button" disabled={pending} aria-label={`Download ${invoice.documentNumber ?? 'invoice'}`} onClick={() => downloadAll([invoice.id])}>
                    <Download aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Print ${invoice.documentNumber ?? 'invoice'}`}
                    onClick={() => startPrint(invoice.id, (problem) => setError(problem))}
                  >
                    <Printer aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="invoice-action-row">
            <Button type="button" className="create-button" disabled={pending} onClick={() => downloadAll(savedInvoices.map((invoice) => invoice.id))}>
              <Download aria-hidden="true" /> {savedInvoices.length === 1 ? 'Download invoice' : `Download all ${savedInvoices.length}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                onDone(savedInvoices.length === 1 ? 'Invoice saved as a draft.' : `${savedInvoices.length} invoices saved as drafts.`)
              }
            >
              Done
            </Button>
          </div>
          <p className="invoice-note">
            {billing.canIssue
              ? 'Open any invoice from the list to email it, mark it sent, or record payment.'
              : 'Someone with full client access can open these drafts here and send them.'}
          </p>
        </div>
      ) : (
        <form className="office-drawer-form invoice-drawer-form" onSubmit={submit}>
          {readOnly ? (
            <p className="invoice-note invoice-note-warn">
              {live?.status === 'void'
                ? 'This invoice is void. Start a new invoice for a replacement.'
                : billToHidden
                  ? 'This invoice is billed to a record outside your directory, so it opens read-only. You can still download or print it.'
                  : 'This invoice has been sent. Someone with full client access can change it. You can still download or print it.'}
            </p>
          ) : null}

          <fieldset className="clients-composer-fieldset" disabled={readOnly || pending}>
            <section className="invoice-section invoice-section-client">
              <header className="invoice-section-head">
                <div>
                  <h3>Bill to</h3>
                  <p>{editing ? 'Who this invoice is addressed to' : plan.reason}</p>
                </div>
              </header>
              {billToOptions.length > 1 ? (
                <div className="clients-billto-options" role="radiogroup" aria-label="Bill to">
                  {billToOptions.map((option) => (
                    <label key={option.id} className={`invoice-pay-option${option.id === billToId ? ' selected' : ''}`}>
                      <input type="radio" name="billTo" checked={option.id === billToId} onChange={() => chooseBillTo(option.id)} />
                      <span>
                        <strong>{option.name}</strong>
                        <em>
                          {option.id === record.id && record.kind === 'student'
                            ? 'The student, billed directly'
                            : CLIENT_KIND_LABELS[option.kind]}
                        </em>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="invoice-grid">
                <label className="invoice-span">
                  Name on the invoice
                  <input value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} required />
                </label>
                <label>
                  Email
                  <input type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
                </label>
                <label>
                  Phone
                  <input value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} />
                </label>
                <label>
                  Their PIN
                  <input value={contact.pin} onChange={(event) => setContact({ ...contact, pin: event.target.value })} />
                </label>
                <label>
                  Invoice date
                  <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required />
                </label>
                <label>
                  Due date
                  <input type="date" value={dueDate} min={issueDate} onChange={(event) => setDueDate(event.target.value)} />
                </label>
                <label className="invoice-span">
                  Address
                  <textarea rows={2} value={contact.address} onChange={(event) => setContact({ ...contact, address: event.target.value })} />
                </label>
              </div>
              {caps.canUpdate ? (
                <label className="invoice-check">
                  <input type="checkbox" checked={updateClient} onChange={(event) => setUpdateClient(event.target.checked)} />
                  <span>Save the email, phone, address, and PIN back onto {billTo.name}&apos;s record</span>
                </label>
              ) : null}
            </section>

            {!editing && includedChildren.length >= 2 ? (
              <section className="invoice-section clients-mode-section">
                <header className="invoice-section-head">
                  <div>
                    <h3>How to invoice {includedChildren.length} children</h3>
                    <p>Choose one invoice for the family, or a separate invoice and file for each child.</p>
                  </div>
                </header>
                <div className="clients-mode-options" role="radiogroup" aria-label="Invoice layout">
                  <label className={`invoice-pay-option${mode === 'combined' ? ' selected' : ''}`}>
                    <input type="radio" name="mode" checked={mode === 'combined'} onChange={() => setMode('combined')} />
                    <span>
                      <strong>One combined invoice</strong>
                      <em>Every child on one invoice and one download</em>
                    </span>
                  </label>
                  <label className={`invoice-pay-option${mode === 'per_child' ? ' selected' : ''}`}>
                    <input type="radio" name="mode" checked={mode === 'per_child'} onChange={() => setMode('per_child')} />
                    <span>
                      <strong>Separate invoice per child</strong>
                      <em>{includedChildren.length} invoices, each with its own number and file</em>
                    </span>
                  </label>
                </div>
              </section>
            ) : null}

            <section className="invoice-section invoice-section-lines">
              <header className="invoice-section-head">
                <div>
                  <h3>Charges</h3>
                  <p>
                    {childGroups.length
                      ? 'Grouped by student, so each line shows on that student’s record.'
                      : 'What you are charging for'}
                  </p>
                </div>
              </header>
              {groups.map((group, groupIndex) => {
                const student = group.subjectId ? clientsById.get(group.subjectId) ?? null : null
                if (group.subjectId && !student && !editing) return null
                const isShared = group.subjectId === null
                if (isShared && group.lines.length === 0 && childGroups.length > 0) {
                  return (
                    <div key="shared" className="clients-charge-group is-shared">
                      <Button
                        type="button"
                        variant="outline"
                        className="invoice-add-line"
                        onClick={() => updateGroup(groupIndex, (current) => ({ ...current, lines: [defaultLine()] }))}
                      >
                        <Plus aria-hidden="true" /> Add a general charge
                      </Button>
                      <p className="invoice-note">
                        For things like registration or materials.
                        {splitting ? ' Added to every child’s invoice.' : ''}
                      </p>
                    </div>
                  )
                }
                return (
                  <div key={group.subjectId ?? 'shared'} className={`clients-charge-group${group.included ? '' : ' is-off'}${isShared ? ' is-shared' : ''}`}>
                    {childGroups.length > 0 ? (
                      <div className="clients-charge-head">
                        {isShared ? (
                          <strong>
                            General charges
                            {splitting ? <em> · added to every child’s invoice</em> : null}
                          </strong>
                        ) : editing ? (
                          <strong>{student?.name ?? 'A removed student'}</strong>
                        ) : (
                          <label className="invoice-check">
                            <input
                              type="checkbox"
                              checked={group.included}
                              onChange={(event) => updateGroup(groupIndex, (current) => ({ ...current, included: event.target.checked }))}
                            />
                            <span>
                              <strong>{student?.name}</strong>
                              {student?.programmeName ? <em> · {student.programmeName}</em> : null}
                            </span>
                          </label>
                        )}
                      </div>
                    ) : null}
                    {group.included ? (
                      <div className="invoice-lines">
                        <div className="invoice-line invoice-line-head" aria-hidden="true">
                          <span>Description</span>
                          <span>Qty</span>
                          <span>Rate (KES)</span>
                          <span>Amount</span>
                        </div>
                        {group.lines.map((line) => {
                          const quantityHundredths = parseQuantity(line.quantity)
                          const rateCents = parseAmountText(line.rate)
                          const amount =
                            quantityHundredths != null && rateCents != null ? Math.round((quantityHundredths * rateCents) / 100) : null
                          return (
                            <div key={line.key} className="invoice-line">
                              <label className="invoice-line-desc">
                                <span className="sr-only">Description</span>
                                <input
                                  value={line.description}
                                  placeholder="Description"
                                  onChange={(event) => updateLine(groupIndex, line.key, { description: event.target.value })}
                                />
                              </label>
                              <label>
                                <span className="sr-only">Qty</span>
                                <input
                                  value={line.quantity}
                                  inputMode="decimal"
                                  onChange={(event) => updateLine(groupIndex, line.key, { quantity: event.target.value })}
                                />
                              </label>
                              <label>
                                <span className="sr-only">Rate</span>
                                <input
                                  value={line.rate}
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  onChange={(event) => updateLine(groupIndex, line.key, { rate: event.target.value })}
                                />
                              </label>
                              <div className="invoice-line-amount">
                                <strong>{amount != null ? formatMoney(amount) : '—'}</strong>
                                {group.lines.length > 1 || isShared ? (
                                  <button
                                    type="button"
                                    className="invoice-line-remove"
                                    onClick={() =>
                                      updateGroup(groupIndex, (current) => ({
                                        ...current,
                                        lines: current.lines.filter((entry) => entry.key !== line.key),
                                      }))
                                    }
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                        <Button
                          type="button"
                          variant="outline"
                          className="invoice-add-line"
                          onClick={() =>
                            updateGroup(groupIndex, (current) => ({ ...current, lines: [...current.lines, defaultLine()] }))
                          }
                        >
                          <Plus aria-hidden="true" /> Add a line{student ? ` for ${student.name.split(' ')[0]}` : ''}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </section>

            <section className="invoice-section invoice-section-tax">
              <header className="invoice-section-head">
                <div>
                  <h3>VAT and company PIN</h3>
                  <p>Locked onto the invoice when you save</p>
                </div>
              </header>
              <label className="invoice-check">
                <input type="checkbox" checked={vatEnabled} onChange={(event) => setVatEnabled(event.target.checked)} />
                <span>Show VAT on this invoice</span>
              </label>
              <div className="invoice-grid">
                <label>
                  VAT rate (%)
                  <input value={vatRate} onChange={(event) => setVatRate(event.target.value)} disabled={!vatEnabled} />
                </label>
                <label>
                  Company PIN
                  <input value={companyPin} onChange={(event) => setCompanyPin(event.target.value)} />
                </label>
              </div>
            </section>

            <section className="invoice-section invoice-section-pay">
              <header className="invoice-section-head">
                <div>
                  <h3>Ways to pay</h3>
                  <p>The M-PESA details are always on the invoice. Extra accounts are added when you tick them.</p>
                </div>
              </header>
              <p className="invoice-note">{MPESA_ON_EVERY_INVOICE}</p>
              {accounts.length === 0 ? null : (
                <div className="invoice-pay-list">
                  {accounts.map((account) => (
                    <label key={account.id} className={`invoice-pay-option${paymentIds.includes(account.id) ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={paymentIds.includes(account.id)}
                        onChange={(event) =>
                          setPaymentIds((current) =>
                            event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id),
                          )
                        }
                      />
                      <span>
                        <strong>{account.label}</strong>
                        <em>
                          {account.kind === 'paybill' ? 'Paybill' : account.kind === 'bank' ? 'Bank' : 'Other'}
                          {account.active ? '' : ' · paused'}
                        </em>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="invoice-section invoice-section-note">
              <header className="invoice-section-head">
                <div>
                  <h3>Note</h3>
                  <p>{splitting ? 'Printed on every invoice, under the child’s name' : 'Optional message printed on the invoice'}</p>
                </div>
              </header>
              <label className="invoice-span-label">
                <span className="sr-only">Note on the invoice</span>
                <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Thank you. Fees are due before the start of term." />
              </label>
            </section>
          </fieldset>

          <div className="invoice-summary">
            <div className="invoice-summary-figures">
              {planned.problem ? (
                <p className="invoice-note">{planned.problem}</p>
              ) : planned.invoices.length === 1 ? (
                <>
                  {vatEnabled ? (
                    <>
                      <div>
                        <span>Subtotal</span>
                        <strong>{formatMoney(planned.invoices[0].subtotalCents)}</strong>
                      </div>
                      <div>
                        <span>VAT</span>
                        <strong>{formatMoney(planned.invoices[0].vatCents)}</strong>
                      </div>
                    </>
                  ) : null}
                  <div className="invoice-summary-total">
                    <span>Total</span>
                    <strong>{formatMoney(planned.invoices[0].totalCents)}</strong>
                  </div>
                </>
              ) : (
                <>
                  {planned.invoices.map((invoice, index) => (
                    <div key={`${invoice.label}-${index}`}>
                      <span>Invoice for {invoice.label}</span>
                      <strong>{formatMoney(invoice.totalCents)}</strong>
                    </div>
                  ))}
                  <div className="invoice-summary-total">
                    <span>All {planned.invoices.length} invoices</span>
                    <strong>{formatMoney(grandTotal)}</strong>
                  </div>
                </>
              )}
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            {notice ? <p className="form-success">{notice}</p> : null}
            <div className="invoice-summary-actions">
              {!readOnly ? (
                <Button type="submit" className="create-button" disabled={pending || Boolean(planned.problem)}>
                  {pending
                    ? 'Saving…'
                    : live
                      ? 'Save invoice'
                      : splitting
                        ? `Save ${planned.invoices.length} invoices`
                        : 'Save invoice'}
                </Button>
              ) : null}
              <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
                {live ? 'Close' : 'Cancel'}
              </Button>
              {live && live.status === 'draft' && (billing.canIssue || live.createdById === billing.currentUserId) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm('Delete this draft invoice?')) return
                    run(
                      () => deleteClientInvoice(live.id),
                      () => {
                        onRefresh?.()
                        onDone('Draft deleted.')
                      },
                    )
                  }}
                >
                  Delete draft
                </Button>
              ) : null}
            </div>
          </div>

          {live ? (
            <section className="invoice-section invoice-section-send">
              <header className="invoice-section-head">
                <div>
                  <h3>Download{billing.canIssue ? ', send, or record payment' : ' or print'}</h3>
                  <p>Uses the saved invoice. Save first if you just changed it.</p>
                </div>
              </header>
              <div className="invoice-action-row">
                <Button type="button" variant="outline" disabled={pending} onClick={() => startPrint(live.id, (problem) => setError(problem))}>
                  <Printer aria-hidden="true" /> Print or save PDF
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => downloadAll([live.id])}>
                  <Download aria-hidden="true" /> Download invoice
                </Button>
              </div>
              {billing.canIssue ? (
                <>
                  <div className="invoice-action-row">
                    {live.status !== 'void' ? (
                      <>
                        {live.status !== 'sent' ? (
                          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setInvoiceStatus(live.id, 'sent'), onRefresh)}>
                            Mark as sent
                          </Button>
                        ) : null}
                        {live.status !== 'paid' ? (
                          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setInvoiceStatus(live.id, 'paid'), onRefresh)}>
                            Mark as paid
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() => {
                            if (!window.confirm('Void this invoice? The number stays on record.')) return
                            run(() => setInvoiceStatus(live.id, 'void'), onRefresh)
                          }}
                        >
                          Void
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setInvoiceStatus(live.id, 'draft'), onRefresh)}>
                        Restore as draft
                      </Button>
                    )}
                  </div>
                  {live.status !== 'void' ? (
                    <div className="invoice-action-row">
                      <Button
                        type="button"
                        disabled={pending || !billing.mailReady || !live.clientEmail}
                        onClick={() => run(() => emailInvoice(live.id), onRefresh)}
                      >
                        Email from Task Buddy
                      </Button>
                      <Button type="button" variant="outline" disabled={pending || !live.clientEmail} onClick={() => outlookFile(live.id)}>
                        Outlook message
                      </Button>
                    </div>
                  ) : null}
                  {live.status !== 'void' && !live.clientEmail ? (
                    <p className="invoice-note">Add an email above and save to send this invoice by email.</p>
                  ) : null}
                  {live.status !== 'void' && live.clientEmail && !billing.mailReady ? (
                    <p className="invoice-note">The Task Buddy mailbox is not set up yet. Use the Outlook message instead.</p>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
        </form>
      )}
    </OfficeDrawer>
  )
}
