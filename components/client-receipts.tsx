'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { Download, Printer, Receipt, Trash2 } from 'lucide-react'
import { clientReceiptFile, deleteClientReceipt, saveClientReceipt } from '@/app/client-invoice-actions'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/confirm-dialog'
import { downloadHtml, openPrintWindow, wait, writeAndPrint } from '@/lib/admin-office/invoice-download'
import { formatMoney, invoiceTotals } from '@/lib/admin-office/invoices'
import { globeconDate } from '@/lib/admin-office/letters'
import { formatMpesaPhone, parseMpesaConfirmation, type MpesaPayment } from '@/lib/admin-office/receipts'
import type { ClientBilling, ClientInvoiceView, ClientReceiptView, ClientRecord } from '@/lib/clients/types'

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

function centsFromText(value: string) {
  const cleaned = value.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2))
}

function appliedToInvoice(billing: ClientBilling, invoiceId: string) {
  return billing.receipts.reduce(
    (sum, receipt) => sum + receipt.allocations.filter((allocation) => allocation.invoiceId === invoiceId).reduce((inner, allocation) => inner + allocation.amountCents, 0),
    0,
  )
}

function invoiceOwing(invoice: ClientInvoiceView) {
  return invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps).totalCents
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
  const { ask, dialog } = useConfirm()
  const [seen, setSeen] = useState(composeToken)
  const [message, setMessage] = useState('')
  const [payment, setPayment] = useState<MpesaPayment>(blankPayment())
  const [parsed, setParsed] = useState(false)
  const [clientId, setClientId] = useState(record.id)
  const [description, setDescription] = useState('')
  const [applied, setApplied] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (composeToken !== seen) {
    setSeen(composeToken)
    if (composeToken > 0) {
      const preset = presetInvoiceId ? billing.invoices.find((invoice) => invoice.id === presetInvoiceId) : null
      const presetOwe = preset ? Math.max(0, invoiceOwing(preset) - appliedToInvoice(billing, preset.id)) : 0
      setOpen(true)
      setApplied(preset && presetOwe > 0 ? { [preset.id]: (presetOwe / 100).toFixed(2) } : {})
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
      billing.receipts.filter((receipt) => {
        if (receipt.clientId === record.id || receipt.relatedClientId === record.id) return true
        return receipt.allocations.some((allocation) => {
          if (allocation.subjectClientId === record.id) return true
          const invoice = billing.invoices.find((item) => item.id === allocation.invoiceId)
          return Boolean(invoice && (invoice.clientId === record.id || invoice.lines.some((line) => line.subjectClientId === record.id)))
        })
      }),
    [billing.invoices, billing.receipts, record.id],
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
      const owing = invoiceOwing(invoice) - appliedToInvoice(billing, invoice.id)
      if (owing <= 0 && !applied[invoice.id]) return false
      const fits = (invoice.clientId != null && ids.has(invoice.clientId)) || invoice.lines.some((line) => line.subjectClientId != null && ids.has(line.subjectClientId))
      return fits
    })
  }, [applied, billing, parties])

  const receiptFor = parties.find((person) => person.id === clientId) ?? record
  const phoneMatch = Boolean(payment.payerPhone && digits(receiptFor.phone).endsWith(payment.payerPhone.slice(-9)))
  const amountLabel = payment.amountCents > 0 ? formatMoney(payment.amountCents) : ''
  const appliedCents = Object.values(applied).reduce((sum, value) => sum + (centsFromText(value) ?? 0), 0)
  const unapplied = payment.amountCents - appliedCents

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
    const rows = openInvoices
      .map((invoice) => ({ invoice, owe: Math.max(0, invoiceOwing(invoice) - appliedToInvoice(billing, invoice.id)) }))
      .filter((row) => row.owe > 0)
    const nextApplied: Record<string, string> = {}
    const covered = rows.reduce((sum, row) => sum + row.owe, 0)
    if (rows.length > 0 && covered === next.amountCents) {
      for (const row of rows) nextApplied[row.invoice.id] = (row.owe / 100).toFixed(2)
    } else {
      const exact = rows.filter((row) => row.owe === next.amountCents)
      if (exact.length === 1 && exact[0]) nextApplied[exact[0].invoice.id] = (next.amountCents / 100).toFixed(2)
    }
    setApplied(nextApplied)
  }

  function patch<K extends keyof MpesaPayment>(key: K, value: MpesaPayment[K]) {
    setPayment((current) => ({ ...current, [key]: value }))
  }

  function filesOf(result: unknown) {
    if (!result || typeof result !== 'object' || !('files' in result) || !Array.isArray((result as { files?: unknown }).files)) return []
    return (result as { files: { html?: string; filename?: string; label?: string }[] }).files.filter(
      (file): file is { html: string; filename: string; label: string } => Boolean(file.html && file.filename),
    )
  }

  function download(id: string, part = 'combined') {
    setError(null)
    startTransition(async () => {
      const result = await clientReceiptFile(id, part)
      const problem = errorOf(result)
      const files = filesOf(result)
      if (problem || files.length === 0) {
        setError(problem ?? 'The receipt could not be prepared.')
        return
      }
      for (const [index, file] of files.entries()) {
        if (index > 0) await wait(400)
        downloadHtml(file.filename, file.html)
      }
      setNotice(files.length > 1 ? `${files.length} receipts downloaded.` : 'Receipt downloaded.')
    })
  }

  function print(id: string, part = 'combined') {
    const win = openPrintWindow('receipt')
    if (!win) {
      setError('Allow pop-up windows so the receipt can open for printing.')
      return
    }
    startTransition(async () => {
      const result = await clientReceiptFile(id, part)
      const problem = errorOf(result)
      const file = filesOf(result)[0]
      if (problem || !file) {
        win.close()
        setError(problem ?? 'The receipt could not be prepared.')
        return
      }
      writeAndPrint(win, file.html)
    })
  }

  function remove(receipt: ClientReceiptView) {
    const label = receipt.documentNumber ?? 'this receipt'
    ask({
      title: `Delete ${label}?`,
      description: 'Invoices that this payment had fully covered go back to sent.',
      confirmLabel: 'Delete receipt',
      onConfirm: () => {
        setError(null)
        startTransition(async () => {
          const result = await deleteClientReceipt(receipt.id)
          const problem = errorOf(result)
          if (problem) {
            setError(problem)
            return
          }
          setNotice(noticeOf(result) ?? 'Receipt deleted.')
          onRefresh?.()
        })
      },
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
    const allocations = Object.entries(applied).flatMap(([invoiceId, value]) => {
      const cents = centsFromText(value)
      return cents && cents > 0 ? [{ invoiceId, amountCents: cents }] : []
    })
    startTransition(async () => {
      const result = await saveClientReceipt({
        clientId,
        openedFromId: record.id,
        allocations,
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
      setApplied({})
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
              <fieldset className="client-receipt-alloc">
                <legend>Apply this payment</legend>
                {openInvoices.length === 0 ? <p className="invoice-note">No open invoice for this family. The receipt can still be saved on its own.</p> : null}
                {openInvoices.map((invoice) => {
                  const owe = Math.max(0, invoiceOwing(invoice) - appliedToInvoice(billing, invoice.id))
                  const checked = invoice.id in applied
                  const who = [...new Set(invoice.lines.map((line) => line.subjectClientId).filter((id): id is string => Boolean(id)))]
                    .map((id) => clientsById.get(id)?.name)
                    .filter((name): name is string => Boolean(name))
                  return (
                    <label key={invoice.id} className="client-receipt-alloc-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setApplied((current) => {
                            const next = { ...current }
                            if (event.target.checked) next[invoice.id] = (Math.min(owe, Math.max(0, unapplied)) / 100).toFixed(2)
                            else delete next[invoice.id]
                            return next
                          })
                        }}
                      />
                      <span>
                        <strong>{invoice.documentNumber ?? 'Draft'}</strong>
                        <small>
                          {who.length ? who.join(' & ') : invoice.clientName} · {formatMoney(owe)} still open
                        </small>
                      </span>
                      <input
                        inputMode="decimal"
                        disabled={!checked}
                        value={applied[invoice.id] ?? ''}
                        aria-label={`Amount for ${invoice.documentNumber ?? 'invoice'}`}
                        onChange={(event) => {
                          const value = event.target.value.replace(/,/g, '')
                          if (value && !/^\d*\.?\d{0,2}$/.test(value)) return
                          setApplied((current) => ({ ...current, [invoice.id]: value }))
                        }}
                      />
                    </label>
                  )
                })}
              </fieldset>
              {payment.amountCents > 0 ? (
                <p className={`invoice-note${unapplied === 0 || appliedCents === 0 ? '' : ' invoice-note-warn'}`}>
                  {appliedCents === 0
                    ? `${amountLabel} will be saved as a receipt with no invoice.`
                    : unapplied === 0
                      ? `${amountLabel} is fully applied. Each invoice is marked paid when its balance is covered.`
                      : unapplied > 0
                        ? `${formatMoney(unapplied)} is not on an invoice yet.`
                        : `${formatMoney(Math.abs(unapplied))} is more than the payment.`}
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
            <ReceiptRow
              key={receipt.id}
              receipt={receipt}
              pending={pending}
              canDelete={billing.canIssue}
              onDownload={download}
              onPrint={print}
              onDelete={remove}
            />
          ))}
        </ul>
      ) : null}
      {dialog}
    </section>
  )
}

function ReceiptRow({
  receipt,
  pending,
  canDelete,
  onDownload,
  onPrint,
  onDelete,
}: {
  receipt: ClientReceiptView
  pending: boolean
  canDelete: boolean
  onDownload: (id: string, part?: string) => void
  onPrint: (id: string, part?: string) => void
  onDelete: (receipt: ClientReceiptView) => void
}) {
  const people = [...new Map(receipt.allocations.map((allocation) => [allocation.subjectClientId ?? `name:${allocation.personName}`, allocation])).values()]
  return (
    <li>
      <div className="clients-invoice-open is-static">
        <Receipt aria-hidden="true" />
        <span>
          <strong>{receipt.documentNumber ?? 'Receipt'}</strong>
          <small>
            {globeconDate(receipt.paidOn)}
            {receipt.paidAtLabel ? ` · ${receipt.paidAtLabel}` : ''} · {receipt.payerName} · {receipt.mpesaRef}
            {people.length ? ` · ${people.map((person) => person.personName).join(', ')}` : ''}
          </small>
        </span>
        <em>{formatMoney(receipt.amountCents)}</em>
      </div>
      <div className="clients-invoice-actions client-receipt-copies">
        <button type="button" disabled={pending} onClick={() => onDownload(receipt.id, 'combined')}>
          <Download aria-hidden="true" /> One receipt
        </button>
        <button type="button" disabled={pending} aria-label={`Print ${receipt.documentNumber ?? 'receipt'}`} onClick={() => onPrint(receipt.id, 'combined')}>
          <Printer aria-hidden="true" />
        </button>
        {people.length > 1 ? (
          <button type="button" disabled={pending} onClick={() => onDownload(receipt.id, 'all')}>
            <Download aria-hidden="true" /> Each child
          </button>
        ) : null}
        {people.length > 1
          ? people.map((person) => (
              <button key={person.subjectClientId ?? person.personName} type="button" disabled={pending || !person.subjectClientId} onClick={() => person.subjectClientId && onDownload(receipt.id, person.subjectClientId)}>
                <Download aria-hidden="true" /> {person.personName}
              </button>
            ))
          : null}
        {canDelete ? (
          <button type="button" disabled={pending} aria-label={`Delete ${receipt.documentNumber ?? 'receipt'}`} onClick={() => onDelete(receipt)}>
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  )
}
