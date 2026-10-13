'use client'

import { useMemo, useState, type FormEvent } from 'react'
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

export function InvoicesPanel({ desk, pending, run }: { desk: OfficeDesk; pending: boolean; run: Run }) {
  const [view, setView] = useState<'invoices' | 'clients' | 'payments'>('invoices')
  const [form, setForm] = useState<InvoiceForm>(() => blankInvoice(desk))
  const [clientForm, setClientForm] = useState(blankClient)
  const [paymentForm, setPaymentForm] = useState(blankPayment)
  const saved = desk.invoices.find((invoice) => invoice.id === form.id) ?? null

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

  return (
    <div className="invoice-book">
      <div className="expense-chips" role="tablist">
        {(
          [
            ['invoices', 'Invoices'],
            ['clients', 'Clients'],
            ['payments', 'VAT and payment details'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={view === id ? 'selected' : ''} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'payments' ? (
        <PaymentsView
          desk={desk}
          pending={pending}
          form={paymentForm}
          setForm={setPaymentForm}
          run={run}
        />
      ) : null}

      {view === 'clients' ? (
        <ClientsView desk={desk} pending={pending} form={clientForm} setForm={setClientForm} run={run} />
      ) : null}

      {view === 'invoices' ? (
        <div className="office-split">
          <form className="card" onSubmit={submitInvoice}>
            <div className="card-head">
              <strong>{saved?.documentNumber ?? 'New invoice'}</strong>
              {saved ? <span>{STATUS_LABEL[saved.status]}</span> : <span>Not saved yet</span>}
            </div>
            <p className="field-hint">
              Clients are saved, so the next invoice can start from the same company. You can still change the name, email, address, or their PIN on this invoice alone.
            </p>
            <div className="form-grid">
              <label>
                Client
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
              <label className="category-custom">
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
              <label className="category-custom">
                Address
                <textarea rows={2} value={form.clientAddress} onChange={(event) => patch('clientAddress', event.target.value)} />
              </label>
            </div>
            {form.clientId ? (
              <label className="expense-replace">
                <input type="checkbox" checked={form.updateClient} onChange={(event) => patch('updateClient', event.target.checked)} />
                Save these details back onto the client, so the next invoice starts from them.
              </label>
            ) : (
              <p className="field-hint">A new name is saved as a client you can pick again.</p>
            )}

            <div className="invoice-lines">
              {form.lines.map((line, index) => (
                <div key={index} className="invoice-line">
                  <label>
                    Description
                    <input
                      value={line.description}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) => (itemIndex === index ? { ...item, description: event.target.value } : item)),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Qty
                    <input
                      value={line.quantity}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) => (itemIndex === index ? { ...item, quantity: event.target.value } : item)),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Rate (KES)
                    <input
                      value={line.rate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) => (itemIndex === index ? { ...item, rate: event.target.value } : item)),
                        }))
                      }
                    />
                  </label>
                  {form.lines.length > 1 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, itemIndex) => itemIndex !== index) }))}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, { description: '', quantity: '1', rate: '' }] }))}>
                Add a line
              </Button>
            </div>

            <div className="form-grid">
              <label className="expense-replace">
                <input type="checkbox" checked={form.vatEnabled} onChange={(event) => patch('vatEnabled', event.target.checked)} />
                Show VAT on this invoice
              </label>
              <label>
                VAT rate (%)
                <input value={form.vatRate} onChange={(event) => patch('vatRate', event.target.value)} />
              </label>
              <label>
                Company PIN on this invoice
                <input value={form.companyPin} onChange={(event) => patch('companyPin', event.target.value)} />
              </label>
              <div>
                <Button type="button" variant="outline" onClick={useCurrentSettings}>
                  Use the current VAT rate and PIN
                </Button>
              </div>
            </div>
            <p className="field-hint">This invoice keeps the rate and PIN you save on it. Changing the company settings later does not rewrite it.</p>

            <fieldset className="invoice-payments">
              <legend>Show these ways to pay</legend>
              {saved && saved.payments.some((payment) => !desk.paymentAccounts.some((account) => account.id === payment.id)) ? (
                <p className="field-hint">
                  This invoice still has payment wording from an account that was removed. Saving the invoice drops that wording. Add the account again first if it should stay.
                </p>
              ) : null}
              {desk.paymentAccounts.length === 0 ? (
                <p className="field-hint">No bank or paybill details yet. Add them under VAT and payment details, then tick the ones this client should use.</p>
              ) : (
                desk.paymentAccounts.map((account) => (
                  <label key={account.id} className="expense-replace">
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
                    {account.label}
                    <em>{account.kind === 'paybill' ? 'Paybill' : account.kind === 'bank' ? 'Bank' : 'Other'}{account.active ? '' : ' · paused'}</em>
                  </label>
                ))
              )}
            </fieldset>
            <p className="field-hint">Tick the accounts that belong on this invoice. Saving copies that wording onto the invoice, so a later edit to the list does not change invoices you have already saved.</p>
            <label>
              Note on the invoice
              <textarea rows={2} value={form.notes} onChange={(event) => patch('notes', event.target.value)} />
            </label>
            {totals ? (
              <p className="invoice-total">
                {form.vatEnabled ? `Subtotal ${formatMoney(totals.subtotalCents)} · VAT ${formatMoney(totals.vatCents)} · ` : ''}
                <strong>Total {formatMoney(totals.totalCents)}</strong>
              </p>
            ) : (
              <p className="field-hint">The total appears when each line has a description, a quantity, and a rate.</p>
            )}
            <div className="row-actions">
              <Button type="submit" disabled={pending || saved?.status === 'void'}>
                {form.id ? 'Save invoice' : 'Save draft'}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setForm(blankInvoice(desk))}>
                New invoice
              </Button>
              {saved?.status === 'draft' ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm('Delete this draft?')) return
                    run(() => deleteInvoice(saved.id), 'Draft deleted.', () => setForm(blankInvoice(desk)))
                  }}
                >
                  Delete draft
                </Button>
              ) : null}
            </div>
            {saved?.status === 'void' ? <p className="field-hint">This invoice is void, so it stays as it was. Start a new invoice for a replacement.</p> : null}

            {saved ? (
              <div className="invoice-send">
                <h3>Send or download</h3>
                <p>These use the saved invoice. Save first if you have just changed it.</p>
                <div className="row-actions">
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
                  <>
                    <div className="invoice-mail">
                      <strong>Send from Task Buddy</strong>
                      <p>
                        Task Buddy emails the client from the shared company mailbox and attaches the invoice. You stay on this page, and you do not need Outlook open. The client receives a normal email.
                        {desk.mailReady ? '' : ' This mailbox is not set up on this workspace yet, so use Outlook until it is.'}
                      </p>
                      <Button type="button" disabled={pending || !desk.mailReady} onClick={() => run(() => emailInvoice(saved.id), 'Invoice emailed.')}>
                        Send from Task Buddy
                      </Button>
                    </div>
                    <div className="invoice-mail">
                      <strong>Open in Outlook, with the invoice attached</strong>
                      <p>
                        This downloads a message file. Open that file and Outlook fills in the client&apos;s address, the subject, a short message, and the invoice attachment. You check it and press Send yourself. Outlook needs to be the program that opens .eml files.
                      </p>
                      <Button type="button" variant="outline" disabled={pending} onClick={() => openOutlook('file')}>
                        Download Outlook message
                      </Button>
                    </div>
                    <div className="invoice-mail">
                      <strong>Open Outlook now</strong>
                      <p>
                        This opens Outlook straight away with the address, subject, and message already typed. A browser cannot attach the file this way, so download the invoice first and attach it before you press Send.
                      </p>
                      <Button type="button" variant="outline" disabled={pending} onClick={() => openOutlook('now')}>
                        Open Outlook now
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </form>
          <div className="card">
            <div className="card-head">
              <strong>Saved invoices</strong>
              <span>{desk.invoices.length}</span>
            </div>
            {desk.invoices.length === 0 ? <p className="field-hint">No invoices yet.</p> : null}
            <ul className="invoice-list">
              {desk.invoices.map((invoice) => {
                const total = invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps)
                const overdue = invoice.status === 'sent' && invoice.dueDate != null && invoice.dueDate < desk.today
                return (
                  <li key={invoice.id}>
                    <button type="button" className={form.id === invoice.id ? 'selected' : ''} onClick={() => setForm(formFromInvoice(invoice))}>
                      <strong>{invoice.documentNumber ?? 'Draft'}</strong>
                      <span>{invoice.clientName}</span>
                      <em>
                        {STATUS_LABEL[invoice.status]}
                        {overdue ? ' · overdue' : ''} · {formatMoney(total.totalCents)}
                      </em>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
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
    <div className="office-split">
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
    <div className="office-split">
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
