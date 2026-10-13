import {
  buildInvoiceHtml,
  formatVatRate,
  invoicePlainText,
  invoiceTotals,
  outlookMailLink,
  outlookMessage,
  parseQuantity,
  parseVatRate,
} from './invoices'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

assert(parseVatRate('16') === 1600, '16% is stored so it can be changed later')
assert(parseVatRate('16.5') === 1650, 'a half percent is kept')
assert(parseVatRate('101') === null, 'a rate over 100% is refused')
assert(formatVatRate(1600) === '16%', 'a whole rate prints cleanly')
assert(parseQuantity('1.5') === 150, 'quantity keeps two decimals')
assert(parseQuantity('0') === null, 'a zero quantity is refused')

const lines = [
  { description: 'Website support', quantityHundredths: 200, rateCents: 2_500_000 },
  { description: 'Hosting', quantityHundredths: 100, rateCents: 500_000 },
]
const totals = invoiceTotals(lines, true, 1600)
assert(totals.subtotalCents === 5_500_000, 'line amounts add up')
assert(totals.vatCents === 880_000, 'VAT uses the rate on the invoice')
assert(invoiceTotals(lines, true, 800).vatCents === 440_000, 'a different saved rate changes the VAT')
assert(totals.totalCents === 6_380_000, 'total includes VAT')
assert(invoiceTotals(lines, false, 1600).vatCents === 0, 'VAT can be turned off for one invoice')

const html = buildInvoiceHtml({
  documentNumber: 'GCS-INV-2026-0001',
  issueDate: '2026-10-13',
  dueDate: '2026-10-27',
  clientName: 'Hewane School of Music',
  clientEmail: 'accounts@example.com',
  clientAddress: 'Nairobi',
  clientPin: 'P000000000A',
  companyPin: 'P051234567B',
  vatEnabled: true,
  vatRateBps: 1600,
  lines,
  payments: [
    { id: '1', label: 'Bank', kind: 'bank', details: 'Account name: Globecon' },
    { id: '2', label: 'Paybill', kind: 'paybill', details: 'Paybill: 123456' },
  ],
  notes: 'Thank you.',
})
assert(html.includes('P051234567B'), 'the company PIN on the invoice is the one saved for it')
assert(html.includes('Paybill: 123456'), 'the chosen paybill is printed')
assert(html.includes('globecon-letterhead.png'), 'the invoice uses the Globecon letterhead')
assert(html.includes('KES 63,800.00'), 'the total is printed')

const text = invoicePlainText({
  documentNumber: 'GCS-INV-2026-0001',
  issueDate: '2026-10-13',
  dueDate: null,
  clientName: 'Hewane School of Music',
  companyPin: 'P051234567B',
  vatEnabled: true,
  vatRateBps: 1600,
  lines,
  payments: [{ id: '1', label: 'Bank', kind: 'bank', details: 'Account name: Globecon' }],
  notes: null,
})
const message = outlookMessage({
  to: 'accounts@example.com',
  subject: 'Invoice GCS-INV-2026-0001',
  text,
  filename: 'GCS-INV-2026-0001.html',
  html,
})
assert(message.startsWith('To: accounts@example.com'), 'Outlook opens addressed to the client')
assert(message.includes('Subject: Invoice GCS-INV-2026-0001'), 'the subject is filled in')
assert(message.includes('Content-Disposition: attachment'), 'the invoice is attached')
assert(outlookMailLink({ to: 'accounts@example.com', subject: 'Invoice', body: 'Hello' }).startsWith('mailto:'), 'a direct Outlook link is a mailto')
assert(outlookMailLink({ to: 'accounts@example.com', subject: 'Invoice', body: 'x'.repeat(2000) }).includes('full%20details'), 'a long Outlook message stays short enough to open')

console.log('invoice tests passed')
