'use server'

import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { parseInvoiceLineRows, invoiceFile, type ParsedInvoiceLine } from '@/lib/admin-office/invoice-records'
import { amountWithinLimit, invoiceTotals, parseVatRate, type PaymentKind } from '@/lib/admin-office/invoices'
import { embeddedLetterheadSrc } from '@/lib/admin-office/letterhead-embed'
import { isIsoDate } from '@/lib/admin-office/leave'
import { buildReceiptHtml } from '@/lib/admin-office/receipts'
import { hasFullClientAccess } from '@/lib/auth/permissions'
import { getDb } from '@/lib/db'
import { invoiceInvolves, loadClientScope } from '@/lib/db/clients'
import { nextOfficeNumber } from '@/lib/db/office'
import { getCurrentUser } from '@/lib/db/queries'
import { officeClients, officeInvoiceLines, officeInvoices, officePaymentAccounts, officeReceipts } from '@/lib/db/schema'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_INVOICES_PER_SAVE = 20

function refresh() {
  revalidatePath('/')
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : ''
}

function emailOrEmpty(value: string) {
  if (!value) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 200) return undefined
  return value
}

/** Full client access issues invoices. Create access is enough to prepare drafts. */
async function billingGate() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' as const }
  const scope = await loadClientScope(currentUser)
  if (!scope) return { error: 'You are not allowed to open client management.' as const }
  const canIssue = hasFullClientAccess(scope.capabilities)
  if (!canIssue && !scope.capabilities.canCreate) {
    return { error: 'You are not allowed to prepare invoices. Ask leadership for create access under Clients.' as const }
  }
  return { currentUser, scope, canIssue }
}

type Gate = Exclude<Awaited<ReturnType<typeof billingGate>>, { error: string }>

async function findInvoice(gate: Gate, id: string) {
  if (!UUID.test(id)) return { error: 'That invoice is no longer there.' as const }
  const invoice = await getDb().query.officeInvoices.findFirst({ where: eq(officeInvoices.id, id), with: { lines: true } })
  if (!invoice || invoice.companyId !== gate.currentUser.companyId) return { error: 'That invoice is no longer there.' as const }
  if (!gate.canIssue && !invoiceInvolves(invoice, gate.scope.visibleIds)) {
    return { error: 'That invoice is for someone outside the records you manage.' as const }
  }
  return { invoice }
}

type InvoicePlan = { lines: ParsedInvoiceLine[]; notes: string | null }

/**
 * Saves one invoice (editing) or several (one per child) from the Clients portal.
 * Every line may name the student it is for, so each family member's invoice history stays findable.
 */
export async function saveClientInvoices(payload: unknown) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  if (!payload || typeof payload !== 'object') return { error: 'Fill in the invoice, then save.' as const }
  const input = payload as Record<string, unknown>
  const { currentUser, scope, canIssue } = gate

  const billToId = text(input.billToId, 64)
  if (!UUID.test(billToId)) return { error: 'Choose who this invoice is billed to.' as const }
  const billToRow = scope.clientById.get(billToId)
  if (!billToRow || !scope.visibleIds.has(billToId)) {
    return { error: 'That bill-to party is no longer saved, or is outside what you can manage.' as const }
  }

  const billToInput = input.billTo && typeof input.billTo === 'object' ? (input.billTo as Record<string, unknown>) : {}
  const clientName = text(billToInput.name, 200) || billToRow.name
  const clientEmail = emailOrEmpty(text(billToInput.email, 200))
  if (clientEmail === undefined) return { error: 'Enter a real email for the bill-to party, or leave it blank until you are ready to send.' as const }
  const billTo = {
    clientName,
    clientEmail,
    clientPhone: text(billToInput.phone, 40) || null,
    clientAddress: text(billToInput.address, 500) || null,
    clientPin: text(billToInput.pin, 40) || null,
  }

  const issueDate = text(input.issueDate, 10)
  if (!isIsoDate(issueDate)) return { error: 'Enter the invoice date.' as const }
  const dueRaw = text(input.dueDate, 10)
  if (dueRaw && !isIsoDate(dueRaw)) return { error: 'Enter a real due date, or leave it blank.' as const }
  const dueDate = dueRaw || null
  if (dueDate && dueDate < issueDate) return { error: 'The due date cannot be before the invoice date.' as const }
  const vatEnabled = input.vatEnabled === true
  const vatRateBps = parseVatRate(text(input.vatRate, 10) || '0')
  if (vatRateBps == null) return { error: 'Enter the VAT rate for this invoice, such as 16.' as const }
  const companyPin = text(input.companyPin, 40) || null
  const sharedNotes = text(input.notes, 1000) || null

  const rawInvoices = Array.isArray(input.invoices) ? input.invoices : []
  if (rawInvoices.length === 0) return { error: 'Add at least one line to the invoice.' as const }
  if (rawInvoices.length > MAX_INVOICES_PER_SAVE) {
    return { error: `Save at most ${MAX_INVOICES_PER_SAVE} invoices at once.` as const }
  }
  const invoiceId = text(input.invoiceId, 64)
  if (invoiceId && rawInvoices.length !== 1) return { error: 'An existing invoice is saved on its own.' as const }

  const plans: InvoicePlan[] = []
  for (const raw of rawInvoices) {
    const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const parsed = parseInvoiceLineRows(row.lines)
    if ('error' in parsed) return { error: parsed.error }
    for (const line of parsed.lines) {
      if (line.subjectClientId && !scope.visibleIds.has(line.subjectClientId)) {
        return { error: 'One of the students on this invoice is no longer saved, or is outside what you can manage.' as const }
      }
    }
    const totals = invoiceTotals(parsed.lines, vatEnabled, vatRateBps)
    if (!amountWithinLimit(totals.totalCents)) return { error: 'One of the invoice totals is too large.' as const }
    plans.push({ lines: parsed.lines, notes: text(row.notes, 1000) || sharedNotes })
  }

  const paymentIds = (Array.isArray(input.paymentIds) ? input.paymentIds : []).filter(
    (value): value is string => typeof value === 'string' && UUID.test(value),
  )
  const accounts = paymentIds.length
    ? await getDb()
        .select()
        .from(officePaymentAccounts)
        .where(and(eq(officePaymentAccounts.companyId, currentUser.companyId), inArray(officePaymentAccounts.id, paymentIds)))
    : []
  const payments = paymentIds.flatMap((id) => {
    const account = accounts.find((row) => row.id === id)
    if (!account) return []
    const kind: PaymentKind = account.kind === 'bank' || account.kind === 'paybill' || account.kind === 'other' ? account.kind : 'other'
    return [{ id: account.id, label: account.label, kind, details: account.details }]
  })

  const snapshot = {
    clientId: billToId,
    ...billTo,
    issueDate,
    dueDate,
    vatEnabled,
    vatRateBps,
    companyPin,
    paymentSnapshot: JSON.stringify(payments),
    updatedAt: new Date(),
  }

  if (invoiceId) {
    const found = await findInvoice(gate, invoiceId)
    if ('error' in found) return found
    const existing = found.invoice
    if (existing.status === 'void') return { error: 'A void invoice stays as it was. Start a new invoice instead.' as const }
    if (!canIssue && existing.status !== 'draft') {
      return { error: 'This invoice has been sent. Full client access is required to change it now.' as const }
    }
    const [plan] = plans
    await getDb()
      .update(officeInvoices)
      .set({ ...snapshot, notes: plan.notes })
      .where(eq(officeInvoices.id, invoiceId))
    const previous = existing.lines.map((line) => line.id)
    await getDb()
      .insert(officeInvoiceLines)
      .values(plan.lines.map((line, position) => ({ invoiceId, position, ...line })))
    if (previous.length > 0) await getDb().delete(officeInvoiceLines).where(inArray(officeInvoiceLines.id, previous))
    await saveContactBack(gate, input, billToId, billTo)
    refresh()
    return {
      ok: true as const,
      invoices: [{ id: invoiceId, documentNumber: existing.documentNumber }],
      notice: 'Invoice saved.',
    }
  }

  const saved: { id: string; documentNumber: string }[] = []
  for (const plan of plans) {
    const documentNumber = await nextOfficeNumber('INV')
    const [created] = await getDb()
      .insert(officeInvoices)
      .values({
        companyId: currentUser.companyId,
        createdById: currentUser.id,
        documentNumber,
        status: 'draft',
        ...snapshot,
        notes: plan.notes,
      })
      .returning({ id: officeInvoices.id })
    if (!created) continue
    await getDb()
      .insert(officeInvoiceLines)
      .values(plan.lines.map((line, position) => ({ invoiceId: created.id, position, ...line })))
    saved.push({ id: created.id, documentNumber })
  }
  if (saved.length === 0) return { error: 'The invoice could not be saved. Try again.' as const }
  await saveContactBack(gate, input, billToId, billTo)
  refresh()
  return {
    ok: true as const,
    invoices: saved,
    notice:
      saved.length === 1
        ? `Invoice ${saved[0].documentNumber} saved as a draft.`
        : `${saved.length} invoices saved as drafts, one per child.`,
  }
}

async function saveContactBack(
  gate: Gate,
  input: Record<string, unknown>,
  billToId: string,
  billTo: { clientEmail: string | null; clientPhone: string | null; clientAddress: string | null; clientPin: string | null },
) {
  if (input.updateClient !== true || !gate.scope.capabilities.canUpdate) return
  await getDb()
    .update(officeClients)
    .set({
      email: billTo.clientEmail,
      phone: billTo.clientPhone,
      address: billTo.clientAddress,
      pin: billTo.clientPin,
      updatedAt: new Date(),
    })
    .where(and(eq(officeClients.id, billToId), eq(officeClients.companyId, gate.currentUser.companyId)))
}

/** The printable invoice file, for download or print, for anyone who can see who it is for. */
export async function clientInvoiceFile(id: string) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  const found = await findInvoice(gate, id)
  if ('error' in found) return found
  if (found.invoice.lines.length === 0) return { error: 'Add a line and save the invoice first.' as const }
  const file = invoiceFile(found.invoice)
  return { ok: true as const, html: file.html, filename: file.filename }
}

/** Drafts only. Full client access may remove any draft they can see. Create access may remove drafts they prepared. */
export async function deleteClientInvoice(id: string) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  const found = await findInvoice(gate, id)
  if ('error' in found) return found
  if (found.invoice.status !== 'draft') {
    return { error: 'Only a draft can be deleted. Void a sent invoice instead, so the number stays on record.' as const }
  }
  if (!gate.canIssue && found.invoice.createdById !== gate.currentUser.id) {
    return { error: 'Only someone with full client access, or the person who prepared this draft, can delete it.' as const }
  }
  await getDb().delete(officeInvoices).where(eq(officeInvoices.id, id))
  refresh()
  return { ok: true as const, notice: 'Draft deleted.' }
}

function receiptInvolves(row: { clientId: string | null; relatedClientId: string | null }, visibleIds: Set<string>) {
  return (row.clientId != null && visibleIds.has(row.clientId)) || (row.relatedClientId != null && visibleIds.has(row.relatedClientId))
}

async function receiptDocument(row: {
  documentNumber: string | null
  paidOn: string
  paidAtLabel: string | null
  payerName: string
  payerPhone: string | null
  clientId: string | null
  relatedClientId: string | null
  invoiceId: string | null
  description: string
  amountCents: number
  mpesaRef: string
  accountNumber: string | null
  accountName: string | null
}) {
  const db = getDb()
  const ids = [row.clientId, row.relatedClientId].filter((id): id is string => Boolean(id))
  const people = ids.length
    ? await db.select({ id: officeClients.id, name: officeClients.name, email: officeClients.email }).from(officeClients).where(inArray(officeClients.id, ids))
    : []
  const client = people.find((person) => person.id === row.clientId)
  const related = people.find((person) => person.id === row.relatedClientId)
  const invoice = row.invoiceId
    ? await db.query.officeInvoices.findFirst({ where: eq(officeInvoices.id, row.invoiceId), columns: { documentNumber: true } })
    : null
  const html = buildReceiptHtml({
    letterhead: embeddedLetterheadSrc(),
    documentNumber: row.documentNumber ?? 'Receipt',
    paidOn: String(row.paidOn).slice(0, 10),
    paidAtLabel: row.paidAtLabel,
    payerName: row.payerName,
    payerPhone: row.payerPhone,
    clientName: client?.name ?? row.payerName,
    clientEmail: client?.email ?? null,
    subjectName: related && related.id !== client?.id ? related.name : null,
    description: row.description,
    amountCents: row.amountCents,
    mpesaRef: row.mpesaRef,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    invoiceNumber: invoice?.documentNumber ?? null,
  })
  const filename = `${(row.documentNumber ?? 'receipt').replace(/[^\w.-]+/g, '-')}.html`
  return { html, filename }
}

/** Records an M-PESA payment as a letterhead receipt. Full client access only, and only for people they can see. */
export async function saveClientReceipt(payload: unknown) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  if (!gate.canIssue) return { error: 'Full client access is required to record a payment and issue a receipt.' as const }
  if (!payload || typeof payload !== 'object') return { error: 'Paste the M-PESA confirmation, then check the details.' as const }
  const input = payload as Record<string, unknown>
  const clientId = text(input.clientId, 64)
  const openedFromId = text(input.openedFromId, 64)
  const invoiceId = text(input.invoiceId, 64)
  const description = text(input.description, 300)
  const payerName = text(input.payerName, 160)
  const payerPhone = text(input.payerPhone, 20).replace(/\D/g, '')
  const accountName = text(input.accountName, 160)
  const accountNumber = text(input.accountNumber, 20).replace(/\D/g, '')
  const paidOn = text(input.paidOn, 10)
  const paidAtLabel = text(input.paidAtLabel, 20)
  const mpesaRef = text(input.mpesaRef, 20).toUpperCase()
  const sourceText = text(input.sourceText, 1000)
  const amountCents = typeof input.amountCents === 'number' && Number.isInteger(input.amountCents) ? input.amountCents : null
  if (!UUID.test(clientId) || !gate.scope.visibleIds.has(clientId)) {
    return { error: 'Choose a student, parent, or guardian you can manage.' as const }
  }
  if (!payerName) return { error: 'The receipt needs the name of the person who paid.' as const }
  if (!description) return { error: 'Say what the payment was for, such as term fees.' as const }
  if (amountCents == null || !amountWithinLimit(amountCents) || amountCents <= 0) return { error: 'Enter the amount that was received.' as const }
  if (!isIsoDate(paidOn)) return { error: 'The payment date is not valid.' as const }
  if (!/^[A-Z0-9]{6,20}$/.test(mpesaRef)) return { error: 'The M-PESA reference should look like UK4I1124QF.' as const }
  const relatedClientId = UUID.test(openedFromId) && openedFromId !== clientId && gate.scope.visibleIds.has(openedFromId) ? openedFromId : null

  const db = getDb()
  const duplicate = await db
    .select({ documentNumber: officeReceipts.documentNumber })
    .from(officeReceipts)
    .where(and(eq(officeReceipts.companyId, gate.currentUser.companyId), eq(officeReceipts.mpesaRef, mpesaRef)))
  if (duplicate[0]) {
    return { error: `Reference ${mpesaRef} is already on receipt ${duplicate[0].documentNumber ?? 'another receipt'}.` }
  }

  let invoiceNumber: string | null = null
  let invoiceStatus: string | null = null
  let markPaid = false
  if (invoiceId) {
    if (!UUID.test(invoiceId)) return { error: 'That invoice is no longer there.' as const }
    const found = await findInvoice(gate, invoiceId)
    if ('error' in found) return found
    const invoice = found.invoice
    if (!invoiceInvolves(invoice, gate.scope.visibleIds)) {
      return { error: 'That invoice is for someone outside the records you manage.' as const }
    }
    if (invoice.status === 'void') return { error: 'A void invoice cannot take a receipt. Start from another invoice.' as const }
    const fits =
      invoice.clientId === clientId ||
      invoice.clientId === relatedClientId ||
      invoice.lines.some((line) => line.subjectClientId === clientId || line.subjectClientId === relatedClientId)
    if (!fits) return { error: 'That invoice is not for the person on this receipt.' as const }
    invoiceNumber = invoice.documentNumber
    invoiceStatus = invoice.status
    const total = invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps).totalCents
    markPaid = (invoice.status === 'draft' || invoice.status === 'sent') && amountCents >= total
  }

  const documentNumber = await nextOfficeNumber('RCT')
  let created: { id: string } | undefined
  try {
    const rows = await db
      .insert(officeReceipts)
      .values({
        companyId: gate.currentUser.companyId,
        clientId,
        relatedClientId,
        invoiceId: invoiceId && UUID.test(invoiceId) ? invoiceId : null,
        documentNumber,
        amountCents,
        payerName,
        payerPhone: payerPhone || null,
        accountName: accountName || null,
        accountNumber: accountNumber || null,
        paidOn,
        paidAtLabel: paidAtLabel || null,
        mpesaRef,
        description,
        sourceText: sourceText || null,
        createdById: gate.currentUser.id,
      })
      .returning({ id: officeReceipts.id })
    created = rows[0]
  } catch (error) {
    const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : ''
    if (detail.includes('office_receipts_ref_idx') || detail.includes('duplicate key')) {
      return { error: `Reference ${mpesaRef} is already on a receipt.` }
    }
    throw error
  }
  if (!created) return { error: 'The receipt could not be saved. Try again.' as const }
  if (markPaid && invoiceId) {
    await db.update(officeInvoices).set({ status: 'paid', updatedAt: new Date() }).where(eq(officeInvoices.id, invoiceId))
  }
  const file = await receiptDocument({
    documentNumber,
    paidOn,
    paidAtLabel: paidAtLabel || null,
    payerName,
    payerPhone: payerPhone || null,
    clientId,
    relatedClientId,
    invoiceId: invoiceId && UUID.test(invoiceId) ? invoiceId : null,
    description,
    amountCents,
    mpesaRef,
    accountNumber: accountNumber || null,
    accountName: accountName || null,
  })
  refresh()
  const invoiceNote = !invoiceNumber
    ? ''
    : markPaid
      ? ` Invoice ${invoiceNumber} is marked paid.`
      : invoiceStatus === 'paid'
        ? ` Linked to ${invoiceNumber}, which is already paid.`
        : ` Invoice ${invoiceNumber} stays open because this payment does not cover it.`
  return {
    ok: true as const,
    id: created.id,
    documentNumber,
    html: file.html,
    filename: file.filename,
    notice: `Receipt ${documentNumber} saved.${invoiceNote}`.trim(),
  }
}

export async function clientReceiptFile(id: string) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  if (!UUID.test(id)) return { error: 'That receipt is no longer there.' as const }
  const [row] = await getDb().select().from(officeReceipts).where(eq(officeReceipts.id, id))
  if (!row || row.companyId !== gate.currentUser.companyId) return { error: 'That receipt is no longer there.' as const }
  if (!receiptInvolves(row, gate.scope.visibleIds)) return { error: 'That receipt is for someone outside the records you manage.' as const }
  const file = await receiptDocument(row)
  return { ok: true as const, html: file.html, filename: file.filename }
}
