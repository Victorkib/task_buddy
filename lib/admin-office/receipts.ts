import { letterheadSrc } from '@/lib/admin-office/letterhead'
import { escapeHtml, globeconDate, GLOBECON_STATIONERY } from '@/lib/admin-office/letters'
import { formatMoney, GLOBECON_MPESA } from '@/lib/admin-office/invoices'

export type MpesaPayment = {
  amountCents: number
  payerName: string
  payerPhone: string
  accountName: string
  accountNumber: string
  paidOn: string
  paidAtLabel: string
  mpesaRef: string
}

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function under100(value: number) {
  if (value < 20) return ONES[value] ?? ''
  const ten = Math.floor(value / 10)
  const one = value % 10
  return one ? `${TENS[ten]}-${ONES[one]}` : (TENS[ten] ?? '')
}

function under1000(value: number) {
  if (value < 100) return under100(value)
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  return rest ? `${ONES[hundreds]} hundred ${under100(rest)}` : `${ONES[hundreds]} hundred`
}

function wholeWords(value: number) {
  if (value === 0) return 'zero'
  const millions = Math.floor(value / 1_000_000)
  const thousands = Math.floor((value % 1_000_000) / 1000)
  const rest = value % 1000
  const parts = [
    millions ? `${under1000(millions)} million` : '',
    thousands ? `${under1000(thousands)} thousand` : '',
    rest ? under1000(rest) : '',
  ].filter(Boolean)
  return parts.join(' ')
}

/** "Kenya Shillings Thirteen Thousand Only" */
export function shillingsInWords(cents: number) {
  const shillings = Math.trunc(Math.abs(cents) / 100)
  const frac = Math.abs(cents) % 100
  const words = wholeWords(shillings)
  const titled = words.charAt(0).toUpperCase() + words.slice(1)
  return frac ? `Kenya Shillings ${titled} and ${String(frac).padStart(2, '0')}/100` : `Kenya Shillings ${titled} Only`
}

export function titleName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
}

export function formatMpesaPhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (/^254\d{9}$/.test(digits)) return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
  return value.trim()
}

function parseAmountCents(value: string) {
  const cleaned = value.replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  if (!Number.isSafeInteger(cents) || cents <= 0) return null
  return cents
}

function parsePaidOn(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const check = new Date(`${iso}T00:00:00Z`)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null
  return iso
}

/**
 * Reads a Safaricom confirmation such as
 * "Confirmed KES 13000 received from SAMUEL IMATHIU 254711437418 to a/c … 8004596 on 04/11/2026 12:17 PM. Ref UK4I1124QF."
 */
export function parseMpesaConfirmation(raw: string): MpesaPayment | null {
  const text = raw.replace(/\s+/g, ' ').trim()
  const match =
    /Confirmed\s+KES\s+([\d,]+(?:\.\d{1,2})?)\s+received from\s+(.+?)\s+(254\d{6,12})\s+to\s+a\/c\s+(.+?)\s+(\d{4,12})\s+on\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\.?\s*Ref\.?\s*([A-Z0-9]+)/i.exec(
      text,
    )
  if (!match) return null
  const amountCents = parseAmountCents(match[1] ?? '')
  const paidOn = parsePaidOn(match[6] ?? '')
  const payerName = titleName(match[2] ?? '')
  const mpesaRef = (match[8] ?? '').toUpperCase()
  if (amountCents == null || !paidOn || !payerName || !/^[A-Z0-9]{6,20}$/.test(mpesaRef)) return null
  return {
    amountCents,
    payerName,
    payerPhone: (match[3] ?? '').replace(/\D/g, ''),
    accountName: (match[4] ?? '').trim(),
    accountNumber: match[5] ?? '',
    paidOn,
    paidAtLabel: (match[7] ?? '').replace(/\s+/g, ' ').toUpperCase(),
    mpesaRef,
  }
}

export type ReceiptCover = {
  personId: string | null
  personName: string
  invoiceNumber: string | null
  amountCents: number
}

export function allocationError(
  paymentCents: number,
  rows: { label: string; amountCents: number; outstandingCents: number }[],
) {
  if (rows.length === 0) return null
  if (rows.length > 20) return 'A receipt can cover up to 20 invoices.'
  if (rows.some((row) => !Number.isInteger(row.amountCents) || row.amountCents <= 0)) {
    return 'Enter how much of this payment applies to each selected invoice.'
  }
  const over = rows.find((row) => row.amountCents > row.outstandingCents)
  if (over) return `${over.label} only has ${formatMoney(over.outstandingCents)} still open.`
  const applied = rows.reduce((sum, row) => sum + row.amountCents, 0)
  if (applied > paymentCents) return 'The amounts on the invoices are more than the payment received.'
  if (applied < paymentCents) {
    return `${formatMoney(paymentCents - applied)} of this payment is not on an invoice. Apply the full amount, or remove an invoice and record the receipt on its own.`
  }
  return null
}

export function buildReceiptHtml(input: {
  assetBase?: string
  letterhead?: string
  documentNumber: string
  paidOn: string
  paidAtLabel: string | null
  payerName: string
  payerPhone: string | null
  clientName: string
  clientEmail: string | null
  subjectName: string | null
  description: string
  amountCents: number
  mpesaRef: string
  accountNumber: string | null
  accountName: string | null
  invoiceNumber: string | null
  covers?: ReceiptCover[]
  shareNote?: string | null
}) {
  const src = input.letterhead ?? letterheadSrc(input.assetBase)
  const firm = GLOBECON_STATIONERY
  const when = `${globeconDate(input.paidOn)}${input.paidAtLabel ? `, ${input.paidAtLabel}` : ''}`
  const account = input.accountNumber
    ? `${escapeHtml(input.accountNumber)}${input.accountName ? ` · ${escapeHtml(input.accountName)}` : ''}`
    : escapeHtml(GLOBECON_MPESA.account)
  const covers = input.covers ?? []
  const coverRows = covers
    .map(
      (cover) =>
        `<tr><td>${escapeHtml(cover.personName)}</td><td>${escapeHtml(cover.invoiceNumber ?? 'Invoice')}</td><td class="num">${formatMoney(cover.amountCents)}</td></tr>`,
    )
    .join('')
  const coverBlock = covers.length
    ? `<tr><th>Applied to</th><td><table class="covers"><thead><tr><th>For</th><th>Invoice</th><th></th></tr></thead><tbody>${coverRows}</tbody></table></td></tr>`
    : input.invoiceNumber
      ? `<tr><th>Invoice</th><td>${escapeHtml(input.invoiceNumber)}</td></tr>`
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
    .doc p { margin: 1px 0; }
    .doc .num { font-size: 12pt; font-weight: 700; color: #1a2f6b; }
    .amount {
      margin: 16px 0; padding: 14px 16px; border-radius: 10px;
      background: #f4f7fb; border: 1px solid #d5deea;
    }
    .amount strong { display: block; font-size: 20pt; color: #1a2f6b; letter-spacing: -.02em; }
    .amount span { color: #5c6b82; }
    .facts { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .facts th { text-align: left; width: 34%; padding: 8px 6px; color: #5c6b82; font-weight: 650; font-size: 10pt; border-bottom: 1px solid #d5deea; }
    .facts td { padding: 8px 6px; border-bottom: 1px solid #d5deea; }
    .covers { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .covers th { text-align: left; font-size: 9pt; color: #5c6b82; font-weight: 650; padding: 4px 0; border-bottom: 1px solid #d5deea; }
    .covers td { padding: 5px 8px 5px 0; border-bottom: 1px solid #e6edf5; }
    .covers td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .thanks { margin-top: 22px; font-size: 12pt; color: #1a2f6b; }
    .who { margin-top: 14px; font-size: 10pt; color: #243044; }
    .who p { margin: 1px 0; }
    @media print {
      html, body { background: #fff; }
      .sheet { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <article class="sheet">
    <header class="banner">
      <h1>RECEIPT</h1>
      <div class="doc">
        <p class="num">${escapeHtml(input.documentNumber)}</p>
        <p>${escapeHtml(when)}</p>
      </div>
    </header>
    <div class="amount">
      <span>Amount received</span>
      <strong>${formatMoney(input.amountCents)}</strong>
      <span>${escapeHtml(shillingsInWords(input.amountCents))}</span>
    </div>
    <table class="facts">
      <tr><th>Received from</th><td>${escapeHtml(input.payerName)}${input.payerPhone ? `<br>${escapeHtml(formatMpesaPhone(input.payerPhone))}` : ''}</td></tr>
      <tr><th>Receipt for</th><td>${escapeHtml(input.clientName)}${input.subjectName && input.subjectName !== input.clientName ? `<br>For ${escapeHtml(input.subjectName)}` : ''}${input.clientEmail ? `<br>${escapeHtml(input.clientEmail)}` : ''}</td></tr>
      <tr><th>Being payment for</th><td>${escapeHtml(input.description)}</td></tr>
      <tr><th>M-PESA reference</th><td>${escapeHtml(input.mpesaRef)}</td></tr>
      <tr><th>Paid to account</th><td>${account}</td></tr>
      ${coverBlock}
    </table>
    ${input.shareNote ? `<p class="who">${escapeHtml(input.shareNote)}</p>` : ''}
    <p class="thanks">Payment received with thanks.</p>
    <div class="who">
      <p><strong>${escapeHtml(firm.name)}</strong></p>
      <p>${escapeHtml(firm.box)} · ${escapeHtml(firm.office)}</p>
      <p>${escapeHtml(firm.phone)} · ${escapeHtml(firm.phoneAlt)} · ${escapeHtml(firm.website)}</p>
    </div>
  </article>
</body>
</html>`
}

export type ReceiptFile = { filename: string; html: string; label: string; personId: string | null }

function fileSlug(value: string) {
  return value.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'receipt'
}

/** One letterhead receipt for the whole payment, plus one receipt for each person it covers. */
export function receiptFiles(input: {
  assetBase?: string
  letterhead?: string
  documentNumber: string
  paidOn: string
  paidAtLabel: string | null
  payerName: string
  payerPhone: string | null
  clientName: string
  clientEmail: string | null
  description: string
  amountCents: number
  mpesaRef: string
  accountNumber: string | null
  accountName: string | null
  covers: ReceiptCover[]
}): { combined: ReceiptFile; people: ReceiptFile[] } {
  const shared = {
    assetBase: input.assetBase,
    letterhead: input.letterhead,
    paidOn: input.paidOn,
    paidAtLabel: input.paidAtLabel,
    payerName: input.payerName,
    payerPhone: input.payerPhone,
    description: input.description,
    mpesaRef: input.mpesaRef,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
  }
  const combined = {
    label: 'Everyone on this payment',
    personId: null,
    filename: `${fileSlug(input.documentNumber)}.html`,
    html: buildReceiptHtml({
      ...shared,
      documentNumber: input.documentNumber,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      subjectName: null,
      amountCents: input.amountCents,
      invoiceNumber: input.covers.length === 1 ? input.covers[0]?.invoiceNumber ?? null : null,
      covers: input.covers.length > 1 ? input.covers : input.covers.length === 1 ? input.covers : [],
    }),
  }
  const groups = new Map<string, ReceiptCover[]>()
  for (const cover of input.covers) {
    const key = cover.personId ?? `name:${cover.personName}`
    const list = groups.get(key) ?? []
    list.push(cover)
    groups.set(key, list)
  }
  const people = [...groups.entries()].map(([, covers], index) => {
    const personName = covers[0]?.personName ?? 'Client'
    const amountCents = covers.reduce((sum, cover) => sum + cover.amountCents, 0)
    const number = groups.size > 1 ? `${input.documentNumber}-${index + 1}` : input.documentNumber
    return {
      label: personName,
      personId: covers[0]?.personId ?? null,
      filename: `${fileSlug(number)}-${fileSlug(personName)}.html`,
      html: buildReceiptHtml({
        ...shared,
        documentNumber: number,
        clientName: personName,
        clientEmail: null,
        subjectName: null,
        amountCents,
        invoiceNumber: null,
        covers,
        shareNote:
          groups.size > 1
            ? `This receipt is ${personName}'s share of ${input.documentNumber}. The payment received was ${formatMoney(input.amountCents)} from ${input.payerName}, reference ${input.mpesaRef}.`
            : null,
      }),
    }
  })
  return { combined, people }
}
