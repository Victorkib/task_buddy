import { parseAmountText } from '@/lib/admin-office/expenses'
import {
  amountWithinLimit,
  buildInvoiceHtml,
  invoicePlainText,
  lineAmountCents,
  parsePaymentSnapshot,
  parseQuantity,
} from '@/lib/admin-office/invoices'
import { embeddedLetterheadSrc } from '@/lib/admin-office/letterhead-embed'

export type ParsedInvoiceLine = {
  description: string
  quantityHundredths: number
  rateCents: number
  subjectClientId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validates invoice lines sent from a form as `{ description, quantity, rate, subjectClientId? }`. */
export function parseInvoiceLineRows(parsed: unknown): { lines: ParsedInvoiceLine[] } | { error: string } {
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 40) return { error: 'Add between 1 and 40 lines.' }
  const lines: ParsedInvoiceLine[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return { error: 'Check the invoice lines.' }
    const row = item as Record<string, unknown>
    const description = typeof row.description === 'string' ? row.description.replace(/\r\n/g, '\n').trim().slice(0, 300) : ''
    const quantity = typeof row.quantity === 'string' ? parseQuantity(row.quantity) : null
    const rate = typeof row.rate === 'string' ? parseAmountText(row.rate) : null
    const subject = typeof row.subjectClientId === 'string' && UUID.test(row.subjectClientId) ? row.subjectClientId : null
    if (!description) return { error: 'Each line needs a description.' }
    if (quantity == null) return { error: 'Enter a quantity such as 1 or 1.5.' }
    if (rate == null) return { error: 'Enter each rate in shillings, such as 25000.' }
    if (!amountWithinLimit(lineAmountCents(quantity, rate))) return { error: 'One of the line amounts is too large.' }
    lines.push({ description, quantityHundredths: quantity, rateCents: rate, subjectClientId: subject })
  }
  return { lines }
}

export function invoiceFile(invoice: {
  documentNumber: string | null
  issueDate: string
  dueDate: string | null
  clientName: string
  clientEmail: string | null
  clientAddress: string | null
  clientPin: string | null
  companyPin: string | null
  vatEnabled: boolean
  vatRateBps: number
  notes: string | null
  paymentSnapshot: string
  lines: { description: string; quantityHundredths: number; rateCents: number; position?: number }[]
}) {
  const payments = parsePaymentSnapshot(invoice.paymentSnapshot)
  const lines = [...invoice.lines].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const shared = {
    documentNumber: invoice.documentNumber ?? 'Invoice',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    clientName: invoice.clientName,
    companyPin: invoice.companyPin,
    vatEnabled: invoice.vatEnabled,
    vatRateBps: invoice.vatRateBps,
    lines,
    payments: Array.isArray(payments) ? payments : [],
    notes: invoice.notes,
  }
  const html = buildInvoiceHtml({
    ...shared,
    clientEmail: invoice.clientEmail,
    clientAddress: invoice.clientAddress,
    clientPin: invoice.clientPin,
    letterhead: embeddedLetterheadSrc(),
  })
  const filename = `${(invoice.documentNumber ?? 'invoice').replace(/[^\w.-]+/g, '-')}.html`
  return { html, filename, text: invoicePlainText(shared), subject: `Invoice ${shared.documentNumber} from Globecon Convergence Solutions` }
}
