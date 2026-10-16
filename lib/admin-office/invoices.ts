import { letterheadSrc } from '@/lib/admin-office/letterhead'
import { escapeHtml, globeconDate, GLOBECON_STATIONERY } from '@/lib/admin-office/letters'

export type PaymentKind = 'bank' | 'paybill' | 'other'

export type PaymentSnapshot = {
  id: string
  label: string
  kind: PaymentKind
  details: string
}

export type InvoiceLineInput = {
  description: string
  quantityHundredths: number
  rateCents: number
}

export type InvoiceTotals = {
  subtotalCents: number
  vatCents: number
  totalCents: number
}

const MAX_CENTS = 50_000_000 * 100

export function parseVatRate(value: string) {
  const trimmed = value.trim().replace('%', '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, frac = ''] = trimmed.split('.')
  const bps = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  if (bps < 0 || bps > 10_000) return null
  return bps
}

export function formatVatRate(bps: number) {
  const whole = Math.trunc(bps / 100)
  const frac = bps % 100
  if (frac === 0) return `${whole}%`
  return `${whole}.${String(frac).padStart(2, '0')}%`
}

export function vatRateInput(bps: number) {
  return formatVatRate(bps).replace('%', '')
}

export function parsePaymentSnapshot(value: string): PaymentSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const kind = row.kind === 'bank' || row.kind === 'paybill' || row.kind === 'other' ? row.kind : null
      if (!kind || typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.details !== 'string') return []
      return [{ id: row.id, label: row.label.slice(0, 80), kind, details: row.details.slice(0, 1000) }]
    })
  } catch {
    return []
  }
}

export function parseQuantity(value: string) {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, frac = ''] = trimmed.split('.')
  const hundredths = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  if (hundredths <= 0 || hundredths > 1_000_000) return null
  return hundredths
}

export function formatQuantity(hundredths: number) {
  const whole = Math.trunc(hundredths / 100)
  const frac = hundredths % 100
  if (frac === 0) return String(whole)
  return `${whole}.${String(frac).padStart(2, '0')}`
}

export function lineAmountCents(quantityHundredths: number, rateCents: number) {
  return Math.round((quantityHundredths * rateCents) / 100)
}

export function invoiceTotals(lines: InvoiceLineInput[], vatEnabled: boolean, vatRateBps: number): InvoiceTotals {
  const subtotalCents = lines.reduce((sum, line) => sum + lineAmountCents(line.quantityHundredths, line.rateCents), 0)
  const vatCents = vatEnabled ? Math.round((subtotalCents * vatRateBps) / 10_000) : 0
  return { subtotalCents, vatCents, totalCents: subtotalCents + vatCents }
}

export function formatMoney(cents: number) {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = absolute % 100
  return `KES ${sign}${whole}.${String(frac).padStart(2, '0')}`
}

export function amountWithinLimit(cents: number) {
  return cents >= 0 && cents <= MAX_CENTS
}

export function buildInvoiceHtml(input: {
  assetBase?: string
  letterhead?: string
  documentNumber: string
  issueDate: string
  dueDate: string | null
  clientName: string
  clientEmail: string | null
  clientAddress: string | null
  clientPin: string | null
  companyPin: string | null
  vatEnabled: boolean
  vatRateBps: number
  lines: InvoiceLineInput[]
  payments: PaymentSnapshot[]
  notes: string | null
}) {
  const totals = invoiceTotals(input.lines, input.vatEnabled, input.vatRateBps)
  const src = input.letterhead ?? letterheadSrc(input.assetBase)
  const rows = input.lines
    .map((line) => {
      const amount = lineAmountCents(line.quantityHundredths, line.rateCents)
      return `<tr>
        <td>${escapeHtml(line.description)}</td>
        <td class="num">${formatQuantity(line.quantityHundredths)}</td>
        <td class="num">${formatMoney(line.rateCents)}</td>
        <td class="num">${formatMoney(amount)}</td>
      </tr>`
    })
    .join('')
  const payments = input.payments.length
    ? input.payments
        .map(
          (payment) => `<div class="pay">
            <strong>${escapeHtml(payment.label)}</strong>
            <pre>${escapeHtml(payment.details)}</pre>
          </div>`,
        )
        .join('')
    : '<p>Payment details will be added on this invoice.</p>'
  const pin = input.companyPin ? `<p>PIN: ${escapeHtml(input.companyPin)}</p>` : ''
  const clientPin = input.clientPin ? `<p>PIN: ${escapeHtml(input.clientPin)}</p>` : ''
  const vatRow = input.vatEnabled
    ? `<tr><td>VAT ${formatVatRate(input.vatRateBps)}</td><td>${formatMoney(totals.vatCents)}</td></tr>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.documentNumber)}</title>
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #e8eef6; }
    .sheet {
      width: 210mm; min-height: 297mm; margin: 0 auto; box-sizing: border-box;
      padding: 38mm 16mm 28mm; background: #fff url('${src}') no-repeat top center;
      background-size: 210mm 297mm; color: #1c2430;
      font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.4;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    h1 { margin: 0 0 4px; font-size: 20pt; color: #1a2f6b; letter-spacing: .04em; }
    .meta { display: flex; justify-content: space-between; gap: 24px; margin: 8px 0 16px; }
    .meta p, .who p { margin: 2px 0; }
    .who strong { color: #1a2f6b; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { text-align: left; font-size: 10pt; letter-spacing: .04em; text-transform: uppercase; color: #5c6b82; border-bottom: 2px solid #1a2f6b; padding: 6px 4px; }
    td { border-bottom: 1px solid #d5deea; padding: 7px 4px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .totals { width: 240px; margin-left: auto; margin-top: 8px; }
    .totals td { border: 0; padding: 3px 0; }
    .totals tr.grand td { border-top: 2px solid #1a2f6b; font-weight: 700; font-size: 12pt; color: #1a2f6b; }
    .pay { margin-top: 8px; }
    .pay pre { margin: 2px 0 0; font-family: Calibri, "Segoe UI", Arial, sans-serif; white-space: pre-wrap; }
    .notes { margin-top: 14px; }
    h2 { margin: 18px 0 6px; font-size: 12pt; color: #1a2f6b; }
    @media print {
      html, body { background: #fff; }
      .sheet { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <article class="sheet">
    <h1>INVOICE</h1>
    <div class="meta">
      <div class="who">
        <strong>${escapeHtml(GLOBECON_STATIONERY.name)}</strong>
        <p>${escapeHtml(GLOBECON_STATIONERY.box)}</p>
        <p>${escapeHtml(GLOBECON_STATIONERY.office)}</p>
        <p>${escapeHtml(GLOBECON_STATIONERY.email)} · ${escapeHtml(GLOBECON_STATIONERY.phone)}</p>
        ${pin}
      </div>
      <div>
        <p><strong>${escapeHtml(input.documentNumber)}</strong></p>
        <p>Issued ${escapeHtml(globeconDate(input.issueDate))}</p>
        ${input.dueDate ? `<p>Due ${escapeHtml(globeconDate(input.dueDate))}</p>` : ''}
      </div>
    </div>
    <div class="who">
      <p>Bill to</p>
      <strong>${escapeHtml(input.clientName)}</strong>
      ${input.clientAddress ? `<p>${escapeHtml(input.clientAddress).replaceAll('\n', '<br>')}</p>` : ''}
      ${input.clientEmail ? `<p>${escapeHtml(input.clientEmail)}</p>` : ''}
      ${clientPin}
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${formatMoney(totals.subtotalCents)}</td></tr>
      ${vatRow}
      <tr class="grand"><td>Total</td><td class="num">${formatMoney(totals.totalCents)}</td></tr>
    </table>
    <h2>How to pay</h2>
    ${payments}
    ${input.notes ? `<div class="notes"><strong>Note</strong><p>${escapeHtml(input.notes).replaceAll('\n', '<br>')}</p></div>` : ''}
  </article>
</body>
</html>`
}

export function invoicePlainText(input: {
  documentNumber: string
  issueDate: string
  dueDate: string | null
  clientName: string
  companyPin: string | null
  vatEnabled: boolean
  vatRateBps: number
  lines: InvoiceLineInput[]
  payments: PaymentSnapshot[]
  notes: string | null
}) {
  const totals = invoiceTotals(input.lines, input.vatEnabled, input.vatRateBps)
  const lines = input.lines
    .map((line) => `${line.description} × ${formatQuantity(line.quantityHundredths)} = ${formatMoney(lineAmountCents(line.quantityHundredths, line.rateCents))}`)
    .join('\n')
  const payments = input.payments.map((payment) => `${payment.label}\n${payment.details}`).join('\n\n')
  return [
    `Invoice ${input.documentNumber}`,
    `From ${GLOBECON_STATIONERY.name}`,
    input.companyPin ? `PIN: ${input.companyPin}` : '',
    `Bill to: ${input.clientName}`,
    `Issued ${input.issueDate}`,
    input.dueDate ? `Due ${input.dueDate}` : '',
    '',
    lines,
    '',
    `Subtotal: ${formatMoney(totals.subtotalCents)}`,
    input.vatEnabled ? `VAT ${formatVatRate(input.vatRateBps)}: ${formatMoney(totals.vatCents)}` : '',
    `Total: ${formatMoney(totals.totalCents)}`,
    '',
    payments ? `How to pay:\n${payments}` : '',
    input.notes ? `\n${input.notes}` : '',
    '',
    'The invoice is attached.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function outlookMessage(input: { to: string; subject: string; text: string; filename: string; html: string }) {
  const boundary = `gcs-${crypto.randomUUID()}`
  const attachment = Buffer.from(input.html, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n')
  return [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.text.replace(/\n/g, '\r\n'),
    '',
    `--${boundary}`,
    `Content-Type: text/html; name="${input.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${input.filename}"`,
    '',
    attachment.trimEnd(),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

export function outlookMailLink(input: { to: string; subject: string; body: string }) {
  const body = input.body.length > 1500 ? `${input.body.slice(0, 1400)}\n\nThe downloaded invoice has the full details.` : input.body
  return `mailto:${encodeURIComponent(input.to)}?subject=${encodeURIComponent(input.subject)}&body=${encodeURIComponent(body)}`
}
