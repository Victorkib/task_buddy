'use server'

import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { parseInvoiceLineRows, invoiceFile, type ParsedInvoiceLine } from '@/lib/admin-office/invoice-records'
import { amountWithinLimit, invoiceTotals, parseVatRate, type PaymentKind } from '@/lib/admin-office/invoices'
import { isIsoDate } from '@/lib/admin-office/leave'
import { canRunAdminOffice } from '@/lib/auth/permissions'
import { getDb } from '@/lib/db'
import { invoiceInvolves, loadClientScope } from '@/lib/db/clients'
import { nextOfficeNumber } from '@/lib/db/office'
import { getCurrentUser } from '@/lib/db/queries'
import { officeClients, officeInvoiceLines, officeInvoices, officePaymentAccounts } from '@/lib/db/schema'

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

/** Admin office issues invoices; anyone who can create client records may prepare drafts. */
async function billingGate() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return { error: 'Not signed in.' as const }
  const scope = await loadClientScope(currentUser)
  if (!scope) return { error: 'You are not allowed to open client management.' as const }
  const canIssue = canRunAdminOffice(currentUser)
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
      return { error: 'This invoice has been sent. Only the admin office can change it now.' as const }
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

/** Drafts only. Staff outside the admin office may remove drafts they prepared themselves. */
export async function deleteClientInvoice(id: string) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  const found = await findInvoice(gate, id)
  if ('error' in found) return found
  if (found.invoice.status !== 'draft') {
    return { error: 'Only a draft can be deleted. Void a sent invoice instead, so the number stays on record.' as const }
  }
  if (!gate.canIssue && found.invoice.createdById !== gate.currentUser.id) {
    return { error: 'Only the admin office, or the person who prepared this draft, can delete it.' as const }
  }
  await getDb().delete(officeInvoices).where(eq(officeInvoices.id, id))
  refresh()
  return { ok: true as const, notice: 'Draft deleted.' }
}
