import { allocationError, buildReceiptHtml, parseMpesaConfirmation, receiptFiles, settlementLines, shillingsInWords } from './receipts'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

const sample =
  'Confirmed KES 13000 received from SAMUEL IMATHIU 254711437418 to a/c GLOBECONCONVERGENCESOLUTIONSLTD 8004596 on 04/11/2026 12:17 PM. Ref UK4I1124QF.'

const parsed = parseMpesaConfirmation(sample)
assert(parsed, 'the Safaricom confirmation is read')
assert(parsed?.amountCents === 1_300_000, 'thirteen thousand shillings')
assert(parsed?.payerName === 'Samuel Imathiu', 'the payer name is readable')
assert(parsed?.payerPhone === '254711437418', 'the phone is kept')
assert(parsed?.accountNumber === '8004596', 'the account number is the GlobeCon paybill account')
assert(parsed?.paidOn === '2026-11-04', 'the Kenyan date becomes an ISO date')
assert(parsed?.paidAtLabel === '12:17 PM', 'the time is kept')
assert(parsed?.mpesaRef === 'UK4I1124QF', 'the reference is kept')
assert(parseMpesaConfirmation('hello') == null, 'a message that is not a confirmation is refused')
assert(parseMpesaConfirmation(sample.replace('04/11/2026', '31/02/2026')) == null, 'an impossible date is refused')
assert(shillingsInWords(1_300_000) === 'Kenya Shillings Thirteen thousand Only', 'the amount is written in words')

const html = buildReceiptHtml({
  documentNumber: 'GCS-RCT-2026-0001',
  paidOn: '2026-11-04',
  paidAtLabel: '12:17 PM',
  payerName: 'Samuel Imathiu',
  payerPhone: '254711437418',
  clientName: 'Anthony Waliaula Barasa',
  clientEmail: null,
  subjectName: 'Myles Barasa Waliaula',
  description: 'Term fees',
  amountCents: 1_300_000,
  mpesaRef: 'UK4I1124QF',
  accountNumber: '8004596',
  accountName: 'GlobeCon Convergence Solutions Ltd',
  invoiceNumber: 'GCS-INV-2026-0008',
})
assert(html.includes('RECEIPT'), 'the document is a receipt')
assert(html.includes('UK4I1124QF'), 'the M-PESA reference is printed')
assert(html.includes('KES 13,000.00'), 'the amount is printed')
assert(html.includes('globecon-letterhead.jpg'), 'the receipt uses the Globecon letterhead')
assert(html.includes('GCS-INV-2026-0008'), 'a linked invoice is printed')
assert(html.includes('Payment applied'), 'a receipt itemises what the payment covers')
assert(html.includes('Myles Barasa Waliaula'), 'a single receipt names the child')
assert(!html.includes('How to pay'), 'a receipt does not ask for payment')

assert(
  allocationError(3_000_000, [
    { label: 'Myles', amountCents: 1_000_000, outstandingCents: 1_000_000 },
    { label: 'Anthony', amountCents: 2_000_000, outstandingCents: 2_000_000 },
  ]) == null,
  'one payment can cover several invoices when the amounts match',
)
assert(
  allocationError(4_000_000, [{ label: 'Myles', amountCents: 4_000_000, outstandingCents: 1_000_000 }])?.includes('still open'),
  'a payment cannot put more on an invoice than it still owes',
)
assert(
  allocationError(3_000_000, [{ label: 'Myles', amountCents: 1_000_000, outstandingCents: 1_000_000 }])?.includes('not on an invoice'),
  'money left over has to be applied or left off the invoices',
)

const files = receiptFiles({
  documentNumber: 'GCS-RCT-2026-0001',
  paidOn: '2026-11-04',
  paidAtLabel: '12:17 PM',
  payerName: 'Samuel Imathiu',
  payerPhone: '254711437418',
  clientName: 'Samuel Imathiu',
  clientEmail: null,
  description: 'Term fees',
  amountCents: 3_000_000,
  mpesaRef: 'UK4I1124QF',
  accountNumber: '8004596',
  accountName: 'GlobeCon Convergence Solutions Ltd',
  covers: [
    { personId: 'myles', personName: 'Myles Barasa', invoiceNumber: 'GCS-INV-2026-0008', amountCents: 1_000_000 },
    { personId: 'anthony', personName: 'Anthony Barasa', invoiceNumber: 'GCS-INV-2026-0009', amountCents: 2_000_000 },
  ],
})
assert(files.combined.html.includes('Myles Barasa') && files.combined.html.includes('Anthony Barasa'), 'the combined receipt names everyone')
assert(files.combined.html.includes('KES 30,000.00'), 'the combined receipt shows the whole payment')
assert(files.people.length === 2, 'each child gets a receipt')
assert(files.people[0]?.html.includes('KES 10,000.00') && files.people[0].html.includes('GCS-RCT-2026-0001'), 'a child receipt shows their share and the payment')
assert(!files.people[0]?.html.includes('KES 20,000.00'), 'a child receipt does not include another child')

const settled = settlementLines({
  appliedCents: 1_300_000,
  lines: [
    { personId: 'bryce', personName: 'Bryce Muthomi', description: 'Tuition — Bryce Muthomi (Web design)', amountCents: 650_000 },
    { personId: 'sean', personName: 'Sean Kirimi', description: 'Tuition — Sean Kirimi (Digital skills)', amountCents: 650_000 },
  ],
})
assert(settled.reduce((sum, line) => sum + line.amountCents, 0) === 1_300_000, 'course lines add up to the payment')
assert(settled[0]?.amountCents === 650_000 && settled[1]?.amountCents === 650_000, 'a full payment keeps each course amount')

const combinedInvoice = receiptFiles({
  documentNumber: 'GCS-RCT-2026-0003',
  paidOn: '2026-11-04',
  paidAtLabel: '12:17 PM',
  payerName: 'Samuel Imathiu',
  payerPhone: '254711437418',
  clientName: 'Samuel Imathiu',
  clientEmail: 'smutembei@yahoo.com',
  description: 'Fees',
  amountCents: 1_300_000,
  mpesaRef: 'UK4I1124QF',
  accountNumber: '8004596',
  accountName: 'GlobeCon Convergence Solutions Ltd',
  covers: [
    {
      personId: 'samuel',
      personName: 'Bryce Muthomi & Sean Kirimi',
      invoiceNumber: 'GCS-INV-2026-0005',
      amountCents: 1_300_000,
      lines: settled,
    },
  ],
})
assert(combinedInvoice.combined.html.includes('Bryce Muthomi') && combinedInvoice.combined.html.includes('Sean Kirimi'), 'a combined invoice names each child')
assert(combinedInvoice.combined.html.includes('Web design') && combinedInvoice.combined.html.includes('Digital skills'), 'a combined invoice names each course')
assert(combinedInvoice.combined.html.includes('GCS-INV-2026-0005'), 'the invoice number stays with the courses')
assert(!combinedInvoice.combined.html.includes('Bryce Muthomi &amp; Sean Kirimi'), 'children are not squeezed onto one line')
assert(combinedInvoice.people.length === 2, 'each child on a combined invoice gets a receipt')
assert(combinedInvoice.people[0]?.html.includes('Web design') && combinedInvoice.people[0].html.includes('KES 6,500.00'), 'a child receipt shows that child and their course')
assert(!combinedInvoice.people[0]?.html.includes('Digital skills'), 'a child receipt leaves the other course off')

console.log('receipt tests passed')
