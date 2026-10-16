'use client'

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  deleteClient,
  deleteInvoice,
  deletePaymentAccount,
  emailInvoice,
  outlookInvoice,
  previewInvoice,
  saveClient,
  saveInvoice,
  saveInvoiceSettings,
  savePaymentAccount,
  setInvoiceStatus,
} from '@/app/admin-office-actions'
import { centsToAmount, parseAmountText } from '@/lib/admin-office/expenses'
import {
  formatMoney,
  formatQuantity,
  invoiceTotals,
  parseQuantity,
  parseVatRate,
  vatRateInput,
} from '@/lib/admin-office/invoices'
import type { OfficeClient, OfficeDesk, OfficeInvoice, OfficePaymentAccount } from '@/lib/admin-office/types'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

type Run = (
  action: () => Promise<{ error?: string; notice?: string; id?: string; clientId?: string | null } | void>,
  fallback: string,
  onSuccess?: (result?: { id?: string; clientId?: string | null }) => void,
) => void

type LineForm = { description: string; quantity: string; rate: string }

type InvoiceForm = {
  id: string
  clientId: string
  updateClient: boolean
  clientName: string
  clientEmail: string
  clientPhone: string
  clientAddress: string
  clientPin: string
  issueDate: string
  dueDate: string
  vatEnabled: boolean
  vatRate: string
  companyPin: string
  paymentIds: string[]
  notes: string
  lines: LineForm[]
}

const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid', void: 'Void' } as const

function blankInvoice(desk: OfficeDesk): InvoiceForm {
  return {
    id: '',
    clientId: '',
    updateClient: true,
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    clientAddress: '',
    clientPin: '',
    issueDate: desk.today,
    dueDate: '',
    vatEnabled: desk.invoiceSettings.vatEnabled,
    vatRate: vatRateInput(desk.invoiceSettings.vatRateBps),
    companyPin: desk.invoiceSettings.companyPin ?? '',
    paymentIds: desk.paymentAccounts.filter((account) => account.active).map((account) => account.id),
    notes: '',
    lines: [{ description: '', quantity: '1', rate: '' }],
  }
}

function formFromInvoice(invoice: OfficeInvoice): InvoiceForm {
  return {
    id: invoice.id,
    clientId: invoice.clientId ?? '',
    updateClient: true,
    clientName: invoice.clientName,
    clientEmail: invoice.clientEmail ?? '',
    clientPhone: invoice.clientPhone ?? '',
    clientAddress: invoice.clientAddress ?? '',
    clientPin: invoice.clientPin ?? '',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate ?? '',
    vatEnabled: invoice.vatEnabled,
    vatRate: vatRateInput(invoice.vatRateBps),
    companyPin: invoice.companyPin ?? '',
    paymentIds: invoice.payments.map((payment) => payment.id),
    notes: invoice.notes ?? '',
    lines: invoice.lines.length
      ? invoice.lines.map((line) => ({
          description: line.description,
          quantity: formatQuantity(line.quantityHundredths),
          rate: centsToAmount(line.rateCents),
        }))
      : [{ description: '', quantity: '1', rate: '' }],
  }
}

function downloadBytes(filename: string, bytes: Uint8Array, type: string) {
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function printHtml(html: string) {
  const win = window.open('', '_blank')
  if (!win) return false
  const printable = html.includes('<base ') ? html : html.replace('<head>', `<head><base href="${window.location.origin}/">`)
  win.document.open()
  win.document.write(printable)
  win.document.close()
  win.focus()
  win.print()
  return true
}

function blankClient() {
  return { id: '', name: '', email: '', phone: '', address: '', pin: '' }
}

function blankPayment(): { id: string; label: string; kind: 'bank' | 'paybill' | 'other'; details: string; active: boolean } {
  return { id: '', label: '', kind: 'bank', details: '', active: true }
}

type DrawerKind = 'invoice' | 'clients' | 'payments' | null

function OfficeDrawer({
  title,
  subtitle,
  badge,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  badge?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const headingId = useId()

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div className="drawer-scrim" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="dept-drawer office-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dept-drawer-head office-drawer-head">
          <div className="dept-drawer-title">
            <div className="office-drawer-title-row">
              <h2 id={headingId}>{title}</h2>
              {badge}
            </div>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="close-button" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="dept-drawer-body office-drawer-body">{children}</div>
      </aside>
    </div>
  )
}

export function InvoicesPanel({ desk, pending, run }: { desk: OfficeDesk; pending: boolean; run: Run }) {
  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [form, setForm] = useState<InvoiceForm>(() => blankInvoice(desk))
  const [clientForm, setClientForm] = useState(blankClient)
  const [paymentForm, setPaymentForm] = useState(blankPayment)
  const saved = desk.invoices.find((invoice) => invoice.id === form.id) ?? null

  function openInvoice(next: InvoiceForm) {
    setForm(next)
    setDrawer('invoice')
  }

  function closeDrawer() {
    setDrawer(null)
  }

  const totals = useMemo(() => {
    const rate = parseVatRate(form.vatRate || '0')
    if (rate == null) return null
    const lines = form.lines.map((line) => {
      const quantityHundredths = parseQuantity(line.quantity)
      const rateCents = parseAmountText(line.rate)
      if (!line.description.trim() || quantityHundredths == null || rateCents == null) return null
      return { description: line.description, quantityHundredths, rateCents }
    })
    if (lines.some((line) => line == null)) return null
    return invoiceTotals(
      lines.filter((line): line is NonNullable<typeof line> => line != null),
      form.vatEnabled,
      rate,
    )
  }, [form])

  function patch<K extends keyof InvoiceForm>(key: K, value: InvoiceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function chooseClient(clientId: string) {
    const client = desk.clients.find((item) => item.id === clientId)
    if (!client) {
      setForm((current) => ({ ...current, clientId: '', clientName: '', clientEmail: '', clientPhone: '', clientAddress: '', clientPin: '' }))
      return
    }
    setForm((current) => ({
      ...current,
      clientId: client.id,
      updateClient: true,
      clientName: client.name,
      clientEmail: client.email ?? '',
      clientPhone: client.phone ?? '',
      clientAddress: client.address ?? '',
      clientPin: client.pin ?? '',
    }))
  }

  function submitInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData()
    data.set('id', form.id)
    data.set('clientId', form.clientId)
    data.set('updateClient', form.updateClient ? 'yes' : '')
    data.set('clientName', form.clientName)
    data.set('clientEmail', form.clientEmail)
    data.set('clientPhone', form.clientPhone)
    data.set('clientAddress', form.clientAddress)
    data.set('clientPin', form.clientPin)
    data.set('issueDate', form.issueDate)
    data.set('dueDate', form.dueDate)
    data.set('vatEnabled', form.vatEnabled ? 'yes' : '')
    data.set('vatRate', form.vatRate)
    data.set('companyPin', form.companyPin)
    data.set('notes', form.notes)
    data.set('lines', JSON.stringify(form.lines))
    for (const id of form.paymentIds) data.append('paymentId', id)
    run(() => saveInvoice(data), 'Invoice saved.', (result) => {
      if (!result?.id) return
      setForm((current) => ({ ...current, id: result.id ?? current.id, clientId: result.clientId ?? current.clientId }))
    })
  }

  function useCurrentSettings() {
    setForm((current) => ({
      ...current,
      vatEnabled: desk.invoiceSettings.vatEnabled,
      vatRate: vatRateInput(desk.invoiceSettings.vatRateBps),
      companyPin: desk.invoiceSettings.companyPin ?? '',
    }))
  }

  function openFile(mode: 'print' | 'download') {
    if (!form.id) return
    run(async () => {
      const result = await previewInvoice(form.id)
      if (result && 'error' in result && result.error) return result
      if (!result || !('html' in result) || !result.html || !result.filename) return { error: 'The invoice could not be prepared.' }
      if (mode === 'print') {
        if (!printHtml(result.html)) return { error: 'Allow pop-up windows so the invoice can open for printing.' }
        return { notice: 'The invoice opened for printing. From that window you can also save it as a PDF.' }
      }
      downloadBytes(result.filename, new TextEncoder().encode(result.html), 'text/html')
      return { notice: 'Invoice downloaded. Attach this file if you send the email yourself.' }
    }, 'Invoice ready.')
  }

  function openOutlook(mode: 'file' | 'now') {
    if (!form.id) return
    run(async () => {
      const result = await outlookInvoice(form.id)
      if (result && 'error' in result && result.error) return result
      if (mode === 'file' && result && 'base64' in result && result.base64 && result.filename) {
        downloadBytes(result.filename, Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0)), 'message/rfc822')
        return { notice: 'A message file was downloaded. Open it, and Outlook shows the address, subject, message, and the invoice already attached. You press Send.' }
      }
      if (mode === 'now' && result && 'mailto' in result && result.mailto) {
        window.location.href = result.mailto
        return { notice: 'Outlook should open with the address, subject, and message filled in. Download the invoice and attach it, then press Send.' }
      }
      return { error: 'Outlook could not be prepared from this invoice.' }
    }, 'Outlook ready.')
  }

  const overdue = desk.invoices.filter((invoice) => invoice.status === 'sent' && invoice.dueDate != null && invoice.dueDate < desk.today)

  return (
    <div className="invoice-book">
      <header className="office-module-head">
        <div>
          <h2>Invoices</h2>
          <p className="office-summary">
            {desk.invoices.length} saved{overdue.length ? ` · ${overdue.length} past the due date` : ''}
          </p>
        </div>
        <div className="office-module-actions">
          <Button type="button" className="create-button" onClick={() => openInvoice(blankInvoice(desk))}>
            New invoice
          </Button>
          <button type="button" className={`office-quiet${drawer === 'clients' ? ' selected' : ''}`} onClick={() => setDrawer('clients')}>
            Clients
          </button>
          <button type="button" className={`office-quiet${drawer === 'payments' ? ' selected' : ''}`} onClick={() => setDrawer('payments')}>
            VAT and payment details
          </button>
        </div>
      </header>

      <div className="panel office-record">
        {desk.invoices.length === 0 ? <p className="empty-state">No invoices yet. Start one when you are ready to bill a client.</p> : null}
        <ul className="invoice-list">
          {desk.invoices.map((invoice) => {
            const total = invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps)
            const late = invoice.status === 'sent' && invoice.dueDate != null && invoice.dueDate < desk.today
            return (
              <li key={invoice.id}>
                <button
                  type="button"
                  className={form.id === invoice.id && drawer === 'invoice' ? 'selected' : ''}
                  onClick={() => openInvoice(formFromInvoice(invoice))}
                >
                  <strong>{invoice.documentNumber ?? 'Draft'}</strong>
                  <span>{invoice.clientName}</span>
                  <em>
                    <i className={`office-chip office-chip-${late || invoice.status === 'void' ? 'attention' : invoice.status === 'paid' ? 'good' : 'calm'}`}>
                      {late ? 'Overdue' : STATUS_LABEL[invoice.status]}
                    </i>
                    {formatMoney(total.totalCents)}
                  </em>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {drawer === 'invoice' ? (
        <OfficeDrawer
          title={saved?.documentNumber ?? 'New invoice'}
          subtitle={saved ? saved.clientName : form.clientName || 'Fill in the client and lines, then save.'}
          badge={
            <span
              className={`office-chip office-chip-${
                saved?.status === 'paid' ? 'good' : saved?.status === 'void' ? 'attention' : 'calm'
              }`}
            >
              {saved ? STATUS_LABEL[saved.status] : 'Not saved yet'}
            </span>
          }
          onClose={closeDrawer}
        >
          <form className="office-drawer-form invoice-drawer-form" onSubmit={submitInvoice}>
            <section className="invoice-section invoice-section-client">
              <header className="invoice-section-head">
                <div>
                  <h3>Client</h3>
                  <p>Who this invoice is billed to</p>
                </div>
              </header>
              <div className="invoice-grid">
                <label>
                  Saved client
                  <select value={form.clientId} onChange={(event) => chooseClient(event.target.value)}>
                    <option value="">New client</option>
                    {desk.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Invoice date
                  <input type="date" value={form.issueDate} onChange={(event) => patch('issueDate', event.target.value)} required />
                </label>
                <label className="invoice-span">
                  Bill to
                  <input value={form.clientName} onChange={(event) => patch('clientName', event.target.value)} required />
                </label>
                <label>
                  Email
                  <input type="email" value={form.clientEmail} onChange={(event) => patch('clientEmail', event.target.value)} />
                </label>
                <label>
                  Phone
                  <input value={form.clientPhone} onChange={(event) => patch('clientPhone', event.target.value)} />
                </label>
                <label>
                  Their PIN
                  <input value={form.clientPin} onChange={(event) => patch('clientPin', event.target.value)} />
                </label>
                <label>
                  Due date
                  <input type="date" value={form.dueDate} onChange={(event) => patch('dueDate', event.target.value)} />
                </label>
                <label className="invoice-span">
                  Address
                  <textarea rows={2} value={form.clientAddress} onChange={(event) => patch('clientAddress', event.target.value)} />
                </label>
              </div>
              {form.clientId ? (
                <label className="invoice-check">
                  <input type="checkbox" checked={form.updateClient} onChange={(event) => patch('updateClient', event.target.checked)} />
                  <span>Save these details back onto the client for the next invoice</span>
                </label>
              ) : (
                <p className="invoice-note">A new name is saved as a client you can pick again.</p>
              )}
            </section>

            <section className="invoice-section invoice-section-lines">
              <header className="invoice-section-head">
                <div>
                  <h3>Line items</h3>
                  <p>What you are charging for</p>
                </div>
              </header>
              <div className="invoice-lines">
                <div className="invoice-line invoice-line-head" aria-hidden="true">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Rate (KES)</span>
                  <span>Amount</span>
                </div>
                {form.lines.map((line, index) => {
                  const quantityHundredths = parseQuantity(line.quantity)
                  const rateCents = parseAmountText(line.rate)
                  const amount =
                    quantityHundredths != null && rateCents != null
                      ? Math.round((quantityHundredths * rateCents) / 100)
                      : null
                  return (
                    <div key={index} className="invoice-line">
                      <label className="invoice-line-desc">
                        <span className="sr-only">Description</span>
                        <input
                          value={line.description}
                          placeholder="Description"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, description: event.target.value } : item,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span className="sr-only">Qty</span>
                        <input
                          value={line.quantity}
                          inputMode="decimal"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, quantity: event.target.value } : item,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span className="sr-only">Rate</span>
                        <input
                          value={line.rate}
                          inputMode="decimal"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              lines: current.lines.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, rate: event.target.value } : item,
                              ),
                            }))
                          }
                        />
                      </label>
                      <div className="invoice-line-amount">
                        <strong>{amount != null ? formatMoney(amount) : '—'}</strong>
                        {form.lines.length > 1 ? (
                          <button
                            type="button"
                            className="invoice-line-remove"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                lines: current.lines.filter((_, itemIndex) => itemIndex !== index),
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
                    setForm((current) => ({
                      ...current,
                      lines: [...current.lines, { description: '', quantity: '1', rate: '' }],
                    }))
                  }
                >
                  Add a line
                </Button>
              </div>
            </section>

            <section className="invoice-section invoice-section-tax">
              <header className="invoice-section-head">
                <div>
                  <h3>VAT and company PIN</h3>
                  <p>Locked onto this invoice when you save</p>
                </div>
              </header>
              <label className="invoice-check">
                <input type="checkbox" checked={form.vatEnabled} onChange={(event) => patch('vatEnabled', event.target.checked)} />
                <span>Show VAT on this invoice</span>
              </label>
              <div className="invoice-grid">
                <label>
                  VAT rate (%)
                  <input value={form.vatRate} onChange={(event) => patch('vatRate', event.target.value)} disabled={!form.vatEnabled} />
                </label>
                <label>
                  Company PIN
                  <input value={form.companyPin} onChange={(event) => patch('companyPin', event.target.value)} />
                </label>
              </div>
              <div className="invoice-section-actions">
                <Button type="button" variant="outline" onClick={useCurrentSettings}>
                  Use current company settings
                </Button>
              </div>
              <p className="invoice-note">Changing company settings later does not rewrite invoices you have already saved.</p>
            </section>

            <section className="invoice-section invoice-section-pay">
              <header className="invoice-section-head">
                <div>
                  <h3>Ways to pay</h3>
                  <p>Copied onto the invoice when you save</p>
                </div>
              </header>
              {saved && saved.payments.some((payment) => !desk.paymentAccounts.some((account) => account.id === payment.id)) ? (
                <p className="invoice-note invoice-note-warn">
                  This invoice still has payment wording from an account that was removed. Saving drops that wording unless you add the account again first.
                </p>
              ) : null}
              {desk.paymentAccounts.length === 0 ? (
                <p className="invoice-note">No bank or paybill details yet. Add them under VAT and payment details.</p>
              ) : (
                <div className="invoice-pay-list">
                  {desk.paymentAccounts.map((account) => (
                    <label key={account.id} className={`invoice-pay-option${form.paymentIds.includes(account.id) ? ' selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={form.paymentIds.includes(account.id)}
                        onChange={(event) =>
                          patch(
                            'paymentIds',
                            event.target.checked ? [...form.paymentIds, account.id] : form.paymentIds.filter((id) => id !== account.id),
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
                  <p>Optional message printed on the invoice</p>
                </div>
              </header>
              <label className="invoice-span-label">
                <span className="sr-only">Note on the invoice</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) => patch('notes', event.target.value)}
                  placeholder="Thank you for your business."
                />
              </label>
            </section>

            <div className="invoice-summary">
              <div className="invoice-summary-figures">
                {totals ? (
                  <>
                    {form.vatEnabled ? (
                      <>
                        <div>
                          <span>Subtotal</span>
                          <strong>{formatMoney(totals.subtotalCents)}</strong>
                        </div>
                        <div>
                          <span>VAT</span>
                          <strong>{formatMoney(totals.vatCents)}</strong>
                        </div>
                      </>
                    ) : null}
                    <div className="invoice-summary-total">
                      <span>Total</span>
                      <strong>{formatMoney(totals.totalCents)}</strong>
                    </div>
                  </>
                ) : (
                  <p className="invoice-note">Add a description, quantity, and rate on each line to see the total.</p>
                )}
              </div>
              <div className="invoice-summary-actions">
                <Button type="submit" disabled={pending || saved?.status === 'void'}>
                  {form.id ? 'Save invoice' : 'Save draft'}
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={() => openInvoice(blankInvoice(desk))}>
                  New invoice
                </Button>
                {saved?.status === 'draft' ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm('Delete this draft?')) return
                      run(() => deleteInvoice(saved.id), 'Draft deleted.', () => {
                        setForm(blankInvoice(desk))
                        closeDrawer()
                      })
                    }}
                  >
                    Delete draft
                  </Button>
                ) : null}
              </div>
              {saved?.status === 'void' ? <p className="invoice-note">This invoice is void. Start a new invoice for a replacement.</p> : null}
            </div>

            {saved ? (
              <section className="invoice-section invoice-section-send">
                <header className="invoice-section-head">
                  <div>
                    <h3>Send or download</h3>
                    <p>Uses the saved invoice. Save first if you just changed it.</p>
                  </div>
                </header>
                <div className="invoice-action-row">
                  <Button type="button" variant="outline" disabled={pending} onClick={() => openFile('print')}>
                    Print or save PDF
                  </Button>
                  <Button type="button" variant="outline" disabled={pending} onClick={() => openFile('download')}>
                    Download invoice
                  </Button>
                  {saved.status !== 'void' ? (
                    <>
                      <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setInvoiceStatus(saved.id, 'sent'), 'Marked as sent.')}>
                        Mark as sent
                      </Button>
                      <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setInvoiceStatus(saved.id, 'paid'), 'Marked as paid.')}>
                        Mark as paid
                      </Button>
                      <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setInvoiceStatus(saved.id, 'void'), 'Invoice voided.')}>
                        Void
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => setInvoiceStatus(saved.id, 'draft'), 'Marked as a draft.')}>
                      Restore as draft
                    </Button>
                  )}
                </div>
                {saved.status !== 'void' ? (
                  <div className="invoice-mail-grid">
                    <div className="invoice-mail">
                      <strong>Send from Task Buddy</strong>
                      <p>
                        Emails the client from the company mailbox with the invoice attached.
                        {desk.mailReady ? '' : ' This mailbox is not set up on this workspace yet, so use Outlook until it is.'}
                      </p>
                      <Button type="button" disabled={pending || !desk.mailReady} onClick={() => run(() => emailInvoice(saved.id), 'Invoice emailed.')}>
                        Send from Task Buddy
                      </Button>
                    </div>
                    <div className="invoice-mail">
                      <strong>Outlook message file</strong>
                      <p>Downloads a message with the address, subject, and invoice attached. Open it in Outlook and press Send.</p>
                      <Button type="button" variant="outline" disabled={pending} onClick={() => openOutlook('file')}>
                        Download Outlook message
                      </Button>
                    </div>
                    <div className="invoice-mail">
                      <strong>Open Outlook now</strong>
                      <p>Opens Outlook with the address and message filled in. Download the invoice first and attach it before you send.</p>
                      <Button type="button" variant="outline" disabled={pending} onClick={() => openOutlook('now')}>
                        Open Outlook now
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          </form>
        </OfficeDrawer>
      ) : null}

      {drawer === 'clients' ? (
        <OfficeDrawer title="Clients" subtitle="Saved clients can be picked on the next invoice." onClose={closeDrawer}>
          <ClientsView desk={desk} pending={pending} form={clientForm} setForm={setClientForm} run={run} />
        </OfficeDrawer>
      ) : null}

      {drawer === 'payments' ? (
        <OfficeDrawer title="VAT and payment details" subtitle="Starting values for new invoices." onClose={closeDrawer}>
          <PaymentsView desk={desk} pending={pending} form={paymentForm} setForm={setPaymentForm} run={run} />
        </OfficeDrawer>
      ) : null}
    </div>
  )
}

function PaymentsView({
  desk,
  pending,
  form,
  setForm,
  run,
}: {
  desk: OfficeDesk
  pending: boolean
  form: { id: string; label: string; kind: 'bank' | 'paybill' | 'other'; details: string; active: boolean }
  setForm: (value: { id: string; label: string; kind: 'bank' | 'paybill' | 'other'; details: string; active: boolean }) => void
  run: Run
}) {
  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    run(() => saveInvoiceSettings(data), 'VAT settings saved.')
  }

  function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData()
    data.set('id', form.id)
    data.set('label', form.label)
    data.set('kind', form.kind)
    data.set('details', form.details)
    data.set('active', form.active ? 'yes' : 'no')
    run(() => savePaymentAccount(data), 'Payment details saved.', () => setForm(blankPayment()))
  }

  return (
    <div className="office-drawer-stack">
      <form className="card" key={`${desk.invoiceSettings.vatEnabled}-${desk.invoiceSettings.vatRateBps}-${desk.invoiceSettings.companyPin ?? ''}`} onSubmit={submitSettings}>
        <div className="card-head">
          <strong>VAT and company PIN</strong>
        </div>
        <p className="field-hint">
          These are the starting values for a new invoice. Change the rate or PIN whenever they change. Each invoice keeps the values it was saved with, so old invoices stay as they were issued.
        </p>
        <div className="form-grid">
          <label className="expense-replace">
            <input type="checkbox" name="vatEnabled" value="yes" defaultChecked={desk.invoiceSettings.vatEnabled} />
            New invoices show VAT
          </label>
          <label>
            VAT rate (%)
            <input name="vatRate" defaultValue={vatRateInput(desk.invoiceSettings.vatRateBps)} required />
          </label>
          <label className="category-custom">
            Company PIN
            <input name="companyPin" defaultValue={desk.invoiceSettings.companyPin ?? ''} placeholder="Type the KRA PIN when you have it" />
          </label>
        </div>
        <Button type="submit" disabled={pending}>
          Save VAT and PIN
        </Button>
      </form>
      <form className="card" onSubmit={submitPayment}>
        <div className="card-head">
          <strong>{form.id ? 'Edit a way to pay' : 'Add a way to pay'}</strong>
        </div>
        <p className="field-hint">
          Add the bank account, the paybill, or both. On each invoice you choose which of these to show, so one client can be asked to pay by bank and another by paybill.
        </p>
        <div className="form-grid">
          <label>
            Name
            <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="KCB account" required />
          </label>
          <label>
            Kind
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as 'bank' | 'paybill' | 'other' })}>
              <option value="bank">Bank</option>
              <option value="paybill">Paybill</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="category-custom">
            Details printed on the invoice
            <textarea
              rows={5}
              value={form.details}
              onChange={(event) => setForm({ ...form, details: event.target.value })}
              placeholder={'Account name:\nAccount number:\nBranch:'}
              required
            />
          </label>
          <label className="expense-replace">
            <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
            Offer this on new invoices
          </label>
        </div>
        <div className="row-actions">
          <Button type="submit" disabled={pending}>
            {form.id ? 'Update' : 'Add'}
          </Button>
          {form.id ? (
            <Button type="button" variant="outline" onClick={() => setForm(blankPayment())}>
              Cancel
            </Button>
          ) : null}
        </div>
        <ul className="invoice-list">
          {desk.paymentAccounts.map((account) => (
            <li key={account.id}>
              <button type="button" onClick={() => setForm(accountForm(account))}>
                <strong>{account.label}</strong>
                <span>{account.kind === 'paybill' ? 'Paybill' : account.kind === 'bank' ? 'Bank' : 'Other'}{account.active ? '' : ' · paused'}</span>
                <em>{account.details}</em>
              </button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm('Remove these payment details? Invoices already saved keep the wording they have.')) return
                  run(() => deletePaymentAccount(account.id), 'Payment details removed.')
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </form>
    </div>
  )
}

function accountForm(account: OfficePaymentAccount) {
  return { id: account.id, label: account.label, kind: account.kind, details: account.details, active: account.active }
}

function ClientsView({
  desk,
  pending,
  form,
  setForm,
  run,
}: {
  desk: OfficeDesk
  pending: boolean
  form: { id: string; name: string; email: string; phone: string; address: string; pin: string }
  setForm: (value: { id: string; name: string; email: string; phone: string; address: string; pin: string }) => void
  run: Run
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData()
    data.set('id', form.id)
    data.set('name', form.name)
    data.set('email', form.email)
    data.set('phone', form.phone)
    data.set('address', form.address)
    data.set('pin', form.pin)
    run(() => saveClient(data), 'Client saved.', () => setForm(blankClient()))
  }

  return (
    <div className="office-drawer-stack">
      <form className="card" onSubmit={submit}>
        <div className="card-head">
          <strong>{form.id ? 'Edit client' : 'New client'}</strong>
        </div>
        <p className="field-hint">Saved clients can be picked on the next invoice. Changing a client here does not rewrite invoices already saved.</p>
        <div className="form-grid">
          <label className="category-custom">
            Name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </label>
          <label>
            Their PIN
            <input value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value })} />
          </label>
          <label className="category-custom">
            Address
            <textarea rows={3} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </label>
        </div>
        <div className="row-actions">
          <Button type="submit" disabled={pending}>
            {form.id ? 'Update client' : 'Save client'}
          </Button>
          {form.id ? (
            <Button type="button" variant="outline" onClick={() => setForm(blankClient())}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
      <div className="card">
        <div className="card-head">
          <strong>Saved clients</strong>
          <span>{desk.clients.length}</span>
        </div>
        {desk.clients.length === 0 ? <p className="field-hint">No clients yet. The first invoice you write will save its client here too.</p> : null}
        <ul className="invoice-list">
          {desk.clients.map((client) => (
            <li key={client.id}>
              <button type="button" onClick={() => setForm(clientFields(client))}>
                <strong>{client.name}</strong>
                <span>{client.email || 'No email yet'}</span>
                <em>{client.pin || 'No PIN yet'}</em>
              </button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm('Remove this client? Invoices already written keep the name that was on them.')) return
                  run(() => deleteClient(client.id), 'Client removed.', () => {
                    if (form.id === client.id) setForm(blankClient())
                  })
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function clientFields(client: OfficeClient) {
  return {
    id: client.id,
    name: client.name,
    email: client.email ?? '',
    phone: client.phone ?? '',
    address: client.address ?? '',
    pin: client.pin ?? '',
  }
}
