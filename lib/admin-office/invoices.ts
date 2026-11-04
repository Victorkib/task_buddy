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

/** Official M-PESA details printed on every invoice. */
export const GLOBECON_MPESA = {
  paybill: '522533',
  account: '8004596',
  accountName: 'GlobeCon Convergence Solutions Ltd',
} as const

export function mpesaInstruction() {
  const pay = GLOBECON_MPESA
  return `Kindly make payment through M-PESA Paybill Number ${pay.paybill} and Account Number ${pay.account} (${pay.accountName}).`
}

/** Shown beside optional extra accounts in the invoice form. */
export const MPESA_ON_EVERY_INVOICE = `M-PESA Paybill ${GLOBECON_MPESA.paybill}, account ${GLOBECON_MPESA.account} (${GLOBECON_MPESA.accountName}) is printed on every invoice.`

function extraPayments(payments: PaymentSnapshot[]) {
  return payments.filter(
    (payment) => !(payment.details.includes(GLOBECON_MPESA.paybill) && payment.details.includes(GLOBECON_MPESA.account)),
  )
}

function htmlBlock(value: string) {
  return escapeHtml(value).replaceAll('\n', '<br>')
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
        <td>${htmlBlock(line.description)}</td>
        <td class="num">${formatQuantity(line.quantityHundredths)}</td>
        <td class="num">${formatMoney(line.rateCents)}</td>
        <td class="num">${formatMoney(amount)}</td>
      </tr>`
    })
    .join('')
  const extras = extraPayments(input.payments)
    .map(
      (payment) => `<div class="pay extra">
        <strong>${escapeHtml(payment.label)}</strong>
        <p>${htmlBlock(payment.details)}</p>
      </div>`,
    )
    .join('')
  const clientPin = input.clientPin ? `<p>KRA PIN: ${escapeHtml(input.clientPin)}</p>` : ''
  const vatRow = input.vatEnabled
    ? `<tr><td>VAT ${formatVatRate(input.vatRateBps)}</td><td class="num">${formatMoney(totals.vatCents)}</td></tr>`
    : ''
  const title = input.vatEnabled ? 'TAX INVOICE' : 'INVOICE'
  const firm = GLOBECON_STATIONERY
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.documentNumber)}</title>
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #e8eef6; }
    .sheet {
      position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; box-sizing: border-box;
      padding: 42mm 16mm 34mm; background: #fff; color: #1c2430;
      font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.4;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .sheet::before, .sheet::after {
      content: ""; position: absolute; left: 0; width: 210mm; pointer-events: none; z-index: 0;
      background: #fff url('${src}') no-repeat; background-size: 210mm 297mm;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .sheet::before { top: 0; height: 48mm; background-position: top center; }
    .sheet::after { bottom: 0; height: 32mm; background-position: bottom center; }
    .sheet > * { position: relative; z-index: 1; }
    .banner { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 8px; border-bottom: 2px solid #1a2f6b; }
    h1 { margin: 0; font-size: 22pt; color: #1a2f6b; letter-spacing: .14em; }
    .doc { text-align: right; }
    .doc p, .who p { margin: 1px 0; }
    .doc .num { font-size: 12pt; font-weight: 700; color: #1a2f6b; }
    .parties { display: flex; justify-content: space-between; gap: 28px; margin-top: 12px; }
    .who p { line-height: 1.35; font-size: 10.5pt; }
    .parties > div { flex: 1; min-width: 0; }
    .label { margin: 0 0 3px; font-size: 8.5pt; letter-spacing: .12em; text-transform: uppercase; color: #5c6b82; }
    .who strong { color: #1a2f6b; font-size: 12pt; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { text-align: left; font-size: 9pt; letter-spacing: .06em; text-transform: uppercase; color: #5c6b82; background: #f4f7fb; border-bottom: 2px solid #1a2f6b; padding: 7px 6px; }
    td { border-bottom: 1px solid #d5deea; padding: 6px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .totals { width: 250px; margin-left: auto; margin-top: 6px; }
    .totals td { border: 0; padding: 3px 0; background: transparent; }
    .totals tr.grand td { border-top: 2px solid #1a2f6b; font-weight: 700; font-size: 12pt; color: #1a2f6b; padding-top: 6px; }
    h2 { margin: 14px 0 6px; font-size: 12pt; color: #1a2f6b; }
    .pay { border: 1px solid #d5deea; border-left: 4px solid #1a2f6b; background: #f8fafc; padding: 10px 12px; }
    .pay p { margin: 0; }
    .pay-grid { display: grid; grid-template-columns: 148px 1fr; gap: 3px 12px; margin: 8px 0 0; }
    .pay-grid dt { margin: 0; color: #5c6b82; }
    .pay-grid dd { margin: 0; font-weight: 700; }
    .pay.extra { margin-top: 8px; }
    .pay.extra p { margin-top: 2px; white-space: pre-wrap; }
    .notes { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d5deea; }
    .notes p { margin: 2px 0 0; }
    @media print {
      html, body { background: #fff; }
      .sheet { margin: 0; box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <article class="sheet">
    <header class="banner">
      <h1>${title}</h1>
      <div class="doc">
        <p class="num">${escapeHtml(input.documentNumber)}</p>
        <p>Issued ${escapeHtml(globeconDate(input.issueDate))}</p>
        ${input.dueDate ? `<p>Due ${escapeHtml(globeconDate(input.dueDate))}</p>` : ''}
      </div>
    </header>
    <div class="parties">
      <div class="who">
        <p class="label">From</p>
        <strong>${escapeHtml(firm.name)}</strong>
        <p>${escapeHtml(firm.box)}</p>
        <p>${escapeHtml(firm.office)}</p>
        <p>${escapeHtml(firm.phone)} · ${escapeHtml(firm.phoneAlt)}</p>
        <p>${escapeHtml(firm.email)} · ${escapeHtml(firm.infoEmail)}</p>
        <p>${escapeHtml(firm.gmail)}</p>
        <p>${escapeHtml(firm.website)}${input.companyPin ? ` · KRA PIN: ${escapeHtml(input.companyPin)}` : ''}</p>
      </div>
      <div class="who">
        <p class="label">Bill to</p>
        <strong>${escapeHtml(input.clientName)}</strong>
        ${input.clientAddress ? `<p>${htmlBlock(input.clientAddress)}</p>` : ''}
        ${input.clientEmail ? `<p>${escapeHtml(input.clientEmail)}</p>` : ''}
        ${clientPin}
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No lines on this invoice.</td></tr>'}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="num">${formatMoney(totals.subtotalCents)}</td></tr>
      ${vatRow}
      <tr class="grand"><td>Total due</td><td class="num">${formatMoney(totals.totalCents)}</td></tr>
    </table>
    <h2>How to pay</h2>
    <div class="pay">
      <p>${escapeHtml(mpesaInstruction())}</p>
      <dl class="pay-grid">
        <dt>Paybill number</dt><dd>${GLOBECON_MPESA.paybill}</dd>
        <dt>Account number</dt><dd>${GLOBECON_MPESA.account}</dd>
        <dt>Account name</dt><dd>${escapeHtml(GLOBECON_MPESA.accountName)}</dd>
      </dl>
    </div>
    ${extras}
    ${input.notes ? `<div class="notes"><strong>Note</strong><p>${htmlBlock(input.notes)}</p></div>` : ''}
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
  const extras = extraPayments(input.payments)
    .map((payment) => `${payment.label}\n${payment.details}`)
    .join('\n\n')
  const firm = GLOBECON_STATIONERY
  return [
    `Invoice ${input.documentNumber}`,
    `From ${firm.name}`,
    firm.box,
    firm.office,
    `${firm.phone} · ${firm.phoneAlt}`,
    `${firm.email} · ${firm.infoEmail}`,
    firm.website,
    input.companyPin ? `KRA PIN: ${input.companyPin}` : '',
    `Bill to: ${input.clientName}`,
    `Issued ${input.issueDate}`,
    input.dueDate ? `Due ${input.dueDate}` : '',
    '',
    lines,
    '',
    `Subtotal: ${formatMoney(totals.subtotalCents)}`,
    input.vatEnabled ? `VAT ${formatVatRate(input.vatRateBps)}: ${formatMoney(totals.vatCents)}` : '',
    `Total due: ${formatMoney(totals.totalCents)}`,
    '',
    `How to pay:\n${mpesaInstruction()}${extras ? `\n\n${extras}` : ''}`,
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
