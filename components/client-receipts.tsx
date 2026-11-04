'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { Download, Printer, Receipt } from 'lucide-react'
import { clientReceiptFile, saveClientReceipt } from '@/app/client-invoice-actions'
import { Button } from '@/components/ui/button'
import { downloadHtml, openPrintWindow, writeAndPrint } from '@/lib/admin-office/invoice-download'
import { formatMoney, invoiceTotals } from '@/lib/admin-office/invoices'
import { globeconDate } from '@/lib/admin-office/letters'
import { formatMpesaPhone, parseMpesaConfirmation, type MpesaPayment } from '@/lib/admin-office/receipts'
import type { ClientBilling, ClientReceiptView, ClientRecord } from '@/lib/clients/types'

function errorOf(result: unknown) {
  if (result && typeof result === 'object' && 'error' in result && typeof (result as { error?: unknown }).error === 'string') {
    return (result as { error: string }).error
  }
  return null
}

function noticeOf(result: unknown) {
  if (result && typeof result === 'object' && 'notice' in result && typeof (result as { notice?: unknown }).notice === 'string') {
    return (result as { notice: string }).notice
  }
  return null
}

function digits(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

function blankPayment(): MpesaPayment {
  return {
    amountCents: 0,
    payerName: '',
    payerPhone: '',
    accountName: '',
    accountNumber: '',
    paidOn: '',
    paidAtLabel: '',
    mpesaRef: '',
  }
}

export function ClientReceiptsSection({
  record,
  clientsById,
  billing,
  composeToken,
  presetInvoiceId,
  onRefresh,
}: {
  record: ClientRecord
  clientsById: Map<string, ClientRecord>
  billing: ClientBilling
  composeToken: number
  presetInvoiceId: string | null
  onRefresh?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(composeToken)
  const [message, setMessage] = useState('')
  const [payment, setPayment] = useState<MpesaPayment>(blankPayment())
  const [parsed, setParsed] = useState(false)
  const [clientId, setClientId] = useState(record.id)
  const [description, setDescription] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (composeToken !== seen) {
    setSeen(composeToken)
    if (composeToken > 0) {
      setOpen(true)
      setInvoiceId(presetInvoiceId ?? '')
      setClientId(record.id)
      setMessage('')
      setPayment(blankPayment())
      setParsed(false)
      setDescription('')
      setError(null)
      setNotice(null)
    }
  }

  const receipts = useMemo(
    () =>
      billing.receipts.filter(
        (receipt) => receipt.clientId === record.id || receipt.relatedClientId === record.id,
      ),
    [billing.receipts, record.id],
  )

  const parties = useMemo(() => {
    const ids = [record.id, ...record.links.map((link) => link.otherId)]
    const unique = [...new Set(ids)]
    return unique
      .map((id) => clientsById.get(id) ?? (id === record.id ? record : null))
      .filter((person): person is ClientRecord => Boolean(person))
  }, [clientsById, record])

  const openInvoices = useMemo(() => {
    const ids = new Set(parties.map((person) => person.id))
    return billing.invoices.filter((invoice) => {
      if (invoice.status === 'void') return false
      if (invoice.clientId && ids.has(invoice.clientId)) return true
      return invoice.lines.some((line) => line.subjectClientId != null && ids.has(line.subjectClientId))
    })
  }, [billing.invoices, parties])

  const chosenInvoice = openInvoices.find((invoice) => invoice.id === invoiceId) ?? null
  const chosenTotal = chosenInvoice ? invoiceTotals(chosenInvoice.lines, chosenInvoice.vatEnabled, chosenInvoice.vatRateBps).totalCents : null
  const receiptFor = parties.find((person) => person.id === clientId) ?? record
  const phoneMatch = Boolean(payment.payerPhone && digits(receiptFor.phone).endsWith(payment.payerPhone.slice(-9)))
  const amountLabel = payment.amountCents > 0 ? formatMoney(payment.amountCents) : ''

  function applyMessage(value: string) {
    setMessage(value)
    const next = parseMpesaConfirmation(value)
    if (!next) {
      setParsed(false)
      return
    }
    setPayment(next)
    setParsed(true)
    setError(null)
    const payer = parties.find((person) => digits(person.phone).endsWith(next.payerPhone.slice(-9)))
    if (payer) setClientId(payer.id)
    const match = openInvoices.find((invoice) => invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps).totalCents === next.amountCents)
    if (match && !invoiceId) setInvoiceId(match.id)
  }

  function patch<K extends keyof MpesaPayment>(key: K, value: MpesaPayment[K]) {
    setPayment((current) => ({ ...current, [key]: value }))
  }

  function download(id: string) {
    setError(null)
    startTransition(async () => {
      const result = await clientReceiptFile(id)
      const problem = errorOf(result)
      if (problem || !result || !('html' in result) || !result.html) {
        setError(problem ?? 'The receipt could not be prepared.')
        return
      }
      downloadHtml(result.filename, result.html)
      setNotice('Receipt downloaded.')
    })
  }

  function print(id: string) {
    const win = openPrintWindow('receipt')
    if (!win) {
      setError('Allow pop-up windows so the receipt can open for printing.')
      return
    }
    startTransition(async () => {
      const result = await clientReceiptFile(id)
      const problem = errorOf(result)
      if (problem || !result || !('html' in result) || !result.html) {
        win.close()
        setError(problem ?? 'The receipt could not be prepared.')
        return
      }
      writeAndPrint(win, result.html)
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    const amount = payment.amountCents
    if (amount <= 0 || !payment.mpesaRef || !payment.payerName) {
      setError('Paste the M-PESA confirmation, or fill in the payer, amount, and reference.')
      return
    }
    startTransition(async () => {
      const result = await saveClientReceipt({
        clientId,
        openedFromId: record.id,
        invoiceId: invoiceId || null,
        description,
        sourceText: message,
        amountCents: amount,
        payerName: payment.payerName,
        payerPhone: payment.payerPhone,
        accountName: payment.accountName,
        accountNumber: payment.accountNumber,
        paidOn: payment.paidOn,
        paidAtLabel: payment.paidAtLabel,
        mpesaRef: payment.mpesaRef,
      })
      const problem = errorOf(result)
      if (problem) {
        setError(problem)
        return
      }
      if (result && 'html' in result && result.html && result.filename) downloadHtml(result.filename, result.html)
      setNotice(noticeOf(result) ?? 'Receipt saved.')
      setOpen(false)
      setMessage('')
      setPayment(blankPayment())
      setParsed(false)
      setDescription('')
      setInvoiceId('')
      onRefresh?.()
    })
  }

  return (
    <section className="clients-receipts" aria-label="Receipts">
      <header className="clients-family-head">
        <span className="clients-family-icon is-billing" aria-hidden="true">
          <Receipt />
        </span>
        <div>
          <strong>Receipts</strong>
          <p>
            {receipts.length === 0
              ? `No payment recorded for ${record.name} yet.`
              : `${receipts.length} receipt${receipts.length === 1 ? '' : 's'} · ${formatMoney(receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0))} received`}
          </p>
        </div>
        {billing.canIssue ? (
          <Button type="button" className="create-button clients-invoices-new" onClick={() => setOpen((current) => !current)}>
            {open ? 'Close' : 'Record payment'}
          </Button>
        ) : (
          <p className="invoice-note">Recording a payment needs full client access.</p>
        )}
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="form-success">{notice}</p> : null}

      {open && billing.canIssue ? (
        <form className="client-receipt-form" onSubmit={submit}>
          <label className="invoice-span-label">
            M-PESA confirmation
            <textarea
              rows={4}
              value={message}
              onChange={(event) => applyMessage(event.target.value)}
              placeholder="Paste the confirmation, for example: Confirmed KES 13000 received from SAMUEL IMATHIU…"
            />
          </label>
          {message && !parsed ? <p className="invoice-note invoice-note-warn">That message could not be read. Fill in the payment below.</p> : null}
              <div className="client-receipt-grid">
                <label>
                  Received from
                  <input value={payment.payerName} onChange={(event) => patch('payerName', event.target.value)} />
                </label>
                <label>
                  Phone
                  <input value={payment.payerPhone} onChange={(event) => patch('payerPhone', event.target.value.replace(/\D/g, ''))} />
                </label>
                <label>
                  Amount (KES)
                  <input
                    value={payment.amountCents ? (payment.amountCents / 100).toFixed(2) : ''}
                    onChange={(event) => {
                      const cleaned = event.target.value.replace(/,/g, '')
                      if (!/^\d*\.?\d{0,2}$/.test(cleaned)) return
                      const [whole, frac = ''] = cleaned.split('.')
                      patch('amountCents', (Number(whole || '0') * 100) + Number((frac + '00').slice(0, 2)))
                    }}
                  />
                </label>
                <label>
                  Reference
                  <input value={payment.mpesaRef} onChange={(event) => patch('mpesaRef', event.target.value.toUpperCase())} />
                </label>
                <label>
                  Paid on
                  <input type="date" value={payment.paidOn} onChange={(event) => patch('paidOn', event.target.value)} />
                </label>
                <label>
                  Time
                  <input value={payment.paidAtLabel} onChange={(event) => patch('paidAtLabel', event.target.value)} />
                </label>
                <label>
                  Account number
                  <input value={payment.accountNumber} onChange={(event) => patch('accountNumber', event.target.value)} />
                </label>
                <label>
                  Account name
                  <input value={payment.accountName} onChange={(event) => patch('accountName', event.target.value)} />
                </label>
              </div>
              {payment.payerPhone ? (
                <p className={`invoice-note${phoneMatch ? '' : ' invoice-note-warn'}`}>
                  {phoneMatch
                    ? `Phone matches ${receiptFor.name}.`
                    : `Payer phone ${formatMpesaPhone(payment.payerPhone)} does not match ${receiptFor.name}. Choose who this receipt is for.`}
                </p>
              ) : null}
              <div className="client-receipt-grid">
                <label>
                  Receipt for
                  <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
                    {parties.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                        {person.id === record.id ? '' : ` · ${person.kind}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  What it was for
                  <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Term 1 fees" />
                </label>
              </div>
              <label>
                Apply to an invoice
                <select value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
                  <option value="">No invoice — receipt only</option>
                  {openInvoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.documentNumber ?? 'Draft'} · {invoice.status} · {formatMoney(invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps).totalCents)} · {invoice.clientName}
                    </option>
                  ))}
                </select>
              </label>
              {chosenInvoice && chosenTotal != null && payment.amountCents > 0 ? (
                <p className={`invoice-note${chosenInvoice.status === 'paid' || payment.amountCents >= chosenTotal ? '' : ' invoice-note-warn'}`}>
                  {chosenInvoice.status === 'paid'
                    ? `${chosenInvoice.documentNumber ?? 'This invoice'} is already paid. The receipt will be linked to it.`
                    : payment.amountCents >= chosenTotal
                      ? `${amountLabel} covers ${chosenInvoice.documentNumber ?? 'this invoice'}. It will be marked paid.`
                      : `${amountLabel} is less than ${formatMoney(chosenTotal)}. The invoice stays open.`}
                </p>
              ) : null}
              <div className="invoice-action-row">
                <Button type="submit" className="create-button" disabled={pending}>
                  {pending ? 'Saving…' : 'Save receipt'}
                </Button>
              </div>
        </form>
      ) : null}

      {receipts.length > 0 ? (
        <ul className="clients-invoice-list">
          {receipts.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} pending={pending} onDownload={download} onPrint={print} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ReceiptRow({
  receipt,
  pending,
  onDownload,
  onPrint,
}: {
  receipt: ClientReceiptView
  pending: boolean
  onDownload: (id: string) => void
  onPrint: (id: string) => void
}) {
  return (
    <li>
      <div className="clients-invoice-open is-static">
        <Receipt aria-hidden="true" />
        <span>
          <strong>{receipt.documentNumber ?? 'Receipt'}</strong>
          <small>
            {globeconDate(receipt.paidOn)}
            {receipt.paidAtLabel ? ` · ${receipt.paidAtLabel}` : ''} · {receipt.payerName} · {receipt.mpesaRef}
          </small>
        </span>
        <em>{formatMoney(receipt.amountCents)}</em>
      </div>
      <div className="clients-invoice-actions">
        <button type="button" disabled={pending} aria-label={`Download ${receipt.documentNumber ?? 'receipt'}`} onClick={() => onDownload(receipt.id)}>
          <Download aria-hidden="true" />
        </button>
        <button type="button" disabled={pending} aria-label={`Print ${receipt.documentNumber ?? 'receipt'}`} onClick={() => onPrint(receipt.id)}>
          <Printer aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}
