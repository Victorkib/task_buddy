'use server'

import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { parseInvoiceLineRows, invoiceFile, type ParsedInvoiceLine } from '@/lib/admin-office/invoice-records'
import { amountWithinLimit, invoiceTotals, lineAmountCents, parseVatRate, type PaymentKind } from '@/lib/admin-office/invoices'
import { embeddedLetterheadSrc } from '@/lib/admin-office/letterhead-embed'
import { isIsoDate, nairobiToday } from '@/lib/admin-office/leave'
import { allocationError, receiptFiles, settlementLines, type ReceiptCover } from '@/lib/admin-office/receipts'
import { hasFullClientAccess } from '@/lib/auth/permissions'
import { getDb } from '@/lib/db'
import { invoiceInvolves, loadClientScope } from '@/lib/db/clients'
import { nextOfficeNumber } from '@/lib/db/office'
import { getCurrentUser } from '@/lib/db/queries'
import { officeClientLinks, officeClients, officeInvoiceLines, officeInvoices, officePaymentAccounts, officeReceiptAllocations, officeReceipts } from '@/lib/db/schema'

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

function coverFromInvoice(
  invoice: {
    documentNumber: string | null
    clientId: string | null
    clientName: string
    vatEnabled: boolean
    vatRateBps: number
    lines: { subjectClientId: string | null; description: string; quantityHundredths: number; rateCents: number }[]
  },
  appliedCents: number,
  nameOf: Map<string, string>,
): ReceiptCover {
  const totals = invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps)
  const subjects = [...new Set(invoice.lines.map((line) => line.subjectClientId).filter((id): id is string => Boolean(id)))]
  const personId = subjects.length === 1 ? (subjects[0] ?? null) : invoice.clientId
  const personName =
    subjects.length === 1
      ? (nameOf.get(subjects[0] ?? '') ?? invoice.clientName)
      : subjects.length > 1
        ? subjects.map((id) => nameOf.get(id) ?? 'Student').join(' & ')
        : invoice.clientName
  return {
    personId,
    personName,
    invoiceNumber: invoice.documentNumber,
    amountCents: appliedCents,
    lines: settlementLines({
      appliedCents,
      vatCents: totals.vatCents,
      lines: invoice.lines.map((line) => ({
        personId: line.subjectClientId ?? invoice.clientId,
        personName: line.subjectClientId ? (nameOf.get(line.subjectClientId) ?? invoice.clientName) : invoice.clientName,
        description: line.description,
        amountCents: lineAmountCents(line.quantityHundredths, line.rateCents),
      })),
    }),
  }
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
  const linked = await receiptNumbersOnInvoice(id)
  if (linked.length) {
    return { error: `Delete ${linked.join(', ')} first. This invoice still has that payment on it.` as const }
  }
  if (found.invoice.status !== 'draft' && !gate.canIssue) {
    return { error: 'Full client access is required to delete an invoice that has been issued.' as const }
  }
  if (found.invoice.status === 'draft' && !gate.canIssue && found.invoice.createdById !== gate.currentUser.id) {
    return { error: 'Only someone with full client access, or the person who prepared this draft, can delete it.' as const }
  }
  await getDb().delete(officeInvoices).where(eq(officeInvoices.id, id))
  refresh()
  return { ok: true as const, notice: found.invoice.status === 'draft' ? 'Draft deleted.' : 'Invoice deleted.' }
}

async function receiptNumbersOnInvoice(invoiceId: string) {
  const db = getDb()
  const [allocated, legacy] = await Promise.all([
    db
      .select({ documentNumber: officeReceipts.documentNumber })
      .from(officeReceiptAllocations)
      .innerJoin(officeReceipts, eq(officeReceiptAllocations.receiptId, officeReceipts.id))
      .where(eq(officeReceiptAllocations.invoiceId, invoiceId)),
    db.select({ documentNumber: officeReceipts.documentNumber }).from(officeReceipts).where(eq(officeReceipts.invoiceId, invoiceId)),
  ])
  return [...new Set([...allocated, ...legacy].map((row) => row.documentNumber ?? 'a receipt'))]
}

function receiptVisible(
  row: { clientId: string | null; relatedClientId: string | null },
  subjects: (string | null)[],
  visibleIds: Set<string>,
) {
  if ((row.clientId != null && visibleIds.has(row.clientId)) || (row.relatedClientId != null && visibleIds.has(row.relatedClientId))) return true
  return subjects.some((id) => id != null && visibleIds.has(id))
}

function firstDocumentRow(result: unknown) {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown[] }).rows)
      ? (result as { rows: unknown[] }).rows
      : []
  const row = rows[0]
  if (!row || typeof row !== 'object') return null
  const number = (row as { document_number?: unknown }).document_number
  return typeof number === 'string' ? number : null
}

async function appliedByInvoice(invoiceIds: string[]) {
  const applied = new Map<string, number>()
  if (!invoiceIds.length) return applied
  const db = getDb()
  const [allocations, legacy] = await Promise.all([
    db
      .select({ invoiceId: officeReceiptAllocations.invoiceId, amountCents: officeReceiptAllocations.amountCents, receiptId: officeReceiptAllocations.receiptId })
      .from(officeReceiptAllocations)
      .where(inArray(officeReceiptAllocations.invoiceId, invoiceIds)),
    db
      .select({ id: officeReceipts.id, invoiceId: officeReceipts.invoiceId, amountCents: officeReceipts.amountCents })
      .from(officeReceipts)
      .where(inArray(officeReceipts.invoiceId, invoiceIds)),
  ])
  const covered = new Set(allocations.map((row) => `${row.receiptId}:${row.invoiceId}`))
  for (const row of allocations) applied.set(row.invoiceId, (applied.get(row.invoiceId) ?? 0) + row.amountCents)
  for (const row of legacy) {
    if (!row.invoiceId || covered.has(`${row.id}:${row.invoiceId}`)) continue
    applied.set(row.invoiceId, (applied.get(row.invoiceId) ?? 0) + row.amountCents)
  }
  return applied
}

/** Records an M-PESA payment as a letterhead receipt. One payment may be split across several invoices. */
export async function saveClientReceipt(payload: unknown) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  if (!gate.canIssue) return { error: 'Full client access is required to record a payment and issue a receipt.' as const }
  if (!payload || typeof payload !== 'object') return { error: 'Paste the M-PESA confirmation, then check the details.' as const }
  const input = payload as Record<string, unknown>
  const clientId = text(input.clientId, 64)
  const openedFromId = text(input.openedFromId, 64)
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
  const requested = Array.isArray(input.allocations) ? input.allocations : []
  if (!UUID.test(clientId) || !gate.scope.visibleIds.has(clientId)) {
    return { error: 'Choose a student, parent, or guardian you can manage.' as const }
  }
  if (!payerName) return { error: 'The receipt needs the name of the person who paid.' as const }
  if (!description) return { error: 'Say what the payment was for, such as term fees.' as const }
  if (amountCents == null || !amountWithinLimit(amountCents) || amountCents <= 0) return { error: 'Enter the amount that was received.' as const }
  if (!isIsoDate(paidOn)) return { error: 'The payment date is not valid.' as const }
  if (!/^[A-Z0-9]{6,20}$/.test(mpesaRef)) return { error: 'The M-PESA reference should look like UK4I1124QF.' as const }
  const relatedClientId = UUID.test(openedFromId) && openedFromId !== clientId && gate.scope.visibleIds.has(openedFromId) ? openedFromId : null

  const wanted = new Map<string, number>()
  for (const entry of requested) {
    if (!entry || typeof entry !== 'object') return { error: 'Choose the invoices this payment covers.' as const }
    const row = entry as { invoiceId?: unknown; amountCents?: unknown }
    const invoiceId = text(row.invoiceId, 64)
    if (!UUID.test(invoiceId) || typeof row.amountCents !== 'number' || !Number.isInteger(row.amountCents)) {
      return { error: 'Choose the invoices this payment covers.' as const }
    }
    wanted.set(invoiceId, (wanted.get(invoiceId) ?? 0) + row.amountCents)
  }

  const db = getDb()
  const duplicate = await db
    .select({ documentNumber: officeReceipts.documentNumber })
    .from(officeReceipts)
    .where(and(eq(officeReceipts.companyId, gate.currentUser.companyId), eq(officeReceipts.mpesaRef, mpesaRef)))
  if (duplicate[0]) {
    return { error: `Reference ${mpesaRef} is already on receipt ${duplicate[0].documentNumber ?? 'another receipt'}.` }
  }

  const anchors = [clientId, relatedClientId].filter((id): id is string => Boolean(id))
  const links = await db
    .select({ fromClientId: officeClientLinks.fromClientId, toClientId: officeClientLinks.toClientId })
    .from(officeClientLinks)
    .where(or(inArray(officeClientLinks.fromClientId, anchors), inArray(officeClientLinks.toClientId, anchors)))
  const family = new Set(anchors)
  for (const link of links) {
    family.add(link.fromClientId)
    family.add(link.toClientId)
  }

  const invoiceIds = [...wanted.keys()]
  const invoices = invoiceIds.length
    ? await db.query.officeInvoices.findMany({ where: inArray(officeInvoices.id, invoiceIds), with: { lines: true } })
    : []
  if (invoices.length !== invoiceIds.length) return { error: 'One of those invoices is no longer there.' as const }
  const applied = await appliedByInvoice(invoiceIds)
  const subjectIds = [...new Set(invoices.flatMap((invoice) => invoice.lines.map((line) => line.subjectClientId).filter((id): id is string => Boolean(id))))]
  const named = subjectIds.length
    ? await db.select({ id: officeClients.id, name: officeClients.name }).from(officeClients).where(inArray(officeClients.id, subjectIds))
    : []
  const nameOf = new Map(named.map((person) => [person.id, person.name]))
  const prepared = invoices.map((invoice) => {
    const amount = wanted.get(invoice.id) ?? 0
    const subjects = [...new Set(invoice.lines.map((line) => line.subjectClientId).filter((id): id is string => Boolean(id)))]
    const personId = subjects.length === 1 ? subjects[0] : invoice.clientId
    const personName = subjects.length === 1 ? nameOf.get(subjects[0] ?? '') ?? invoice.clientName : subjects.length > 1 ? subjects.map((id) => nameOf.get(id) ?? 'Student').join(' & ') : invoice.clientName
    const total = invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps).totalCents
    const outstanding = Math.max(0, total - (applied.get(invoice.id) ?? 0))
    return { invoice, amount, personId, personName, total, outstanding }
  })
  for (const row of prepared) {
    if (row.invoice.companyId !== gate.currentUser.companyId) return { error: 'One of those invoices is no longer there.' as const }
    if (!invoiceInvolves(row.invoice, gate.scope.visibleIds)) return { error: 'That invoice is for someone outside the records you manage.' as const }
    if (row.invoice.status === 'void') return { error: 'A void invoice cannot take a receipt.' as const }
    if (!invoiceInvolves(row.invoice, family)) return { error: 'That invoice is not for this family.' as const }
  }
  const problem = allocationError(
    amountCents,
    prepared.map((row) => ({ label: row.invoice.documentNumber ?? row.personName, amountCents: row.amount, outstandingCents: row.outstanding })),
  )
  if (problem) return { error: problem }

  const paidIds = prepared
    .filter((row) => (row.invoice.status === 'draft' || row.invoice.status === 'sent') && (applied.get(row.invoice.id) ?? 0) + row.amount >= row.total)
    .map((row) => row.invoice.id)
  const receiptId = crypto.randomUUID()
  const year = Number(nairobiToday().slice(0, 4))
  const key = `GCS-RCT-${year}`
  const singleInvoiceId = prepared.length === 1 ? prepared[0]?.invoice.id ?? null : null
  const guard = prepared.length
    ? sql`guard AS (
        SELECT 1
        WHERE EXISTS (SELECT 1 FROM locked)
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES ${sql.join(
              prepared.map((row) => sql`(${row.invoice.id}::uuid, ${row.amount}::int, ${row.total}::int)`),
              sql`, `,
            )}) AS v(invoice_id, amount_cents, total_cents)
            LEFT JOIN (
              SELECT invoice_id, COALESCE(SUM(amount_cents), 0) AS applied
              FROM office_receipt_allocations
              WHERE invoice_id IN (${sql.join(prepared.map((row) => sql`${row.invoice.id}::uuid`), sql`, `)})
              GROUP BY invoice_id
            ) already ON already.invoice_id = v.invoice_id
            WHERE COALESCE(already.applied, 0) + v.amount_cents > v.total_cents
          )
      ),`
    : sql`guard AS (SELECT 1),`
  const locked = prepared.length
    ? sql`locked AS (
        SELECT id FROM office_invoices
        WHERE id IN (${sql.join(prepared.map((row) => sql`${row.invoice.id}::uuid`), sql`, `)})
        FOR UPDATE
      ),`
    : sql``
  const alloc = prepared.length
    ? sql`, alloc AS (
        INSERT INTO office_receipt_allocations (id, receipt_id, invoice_id, subject_client_id, person_name, invoice_number, amount_cents, description)
        SELECT * FROM (VALUES ${sql.join(
          prepared.map(
            (row) => sql`(
              ${crypto.randomUUID()}::uuid,
              ${receiptId}::uuid,
              ${row.invoice.id}::uuid,
              ${row.personId ? sql`${row.personId}::uuid` : sql`NULL::uuid`},
              ${row.personName},
              ${row.invoice.documentNumber},
              ${row.amount}::int,
              ${description}
            )`,
          ),
          sql`, `,
        )}) AS v(id, receipt_id, invoice_id, subject_client_id, person_name, invoice_number, amount_cents, description)
        WHERE EXISTS (SELECT 1 FROM receipt)
        RETURNING invoice_id
      )`
    : sql``
  const paid = paidIds.length
    ? sql`, paid AS (
        UPDATE office_invoices
        SET status = 'paid', updated_at = now()
        WHERE id IN (${sql.join(paidIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND status IN ('draft', 'sent')
          AND EXISTS (SELECT 1 FROM receipt)
        RETURNING id
      )`
    : sql``

  let documentNumber: string | null = null
  try {
    const saved = await db.execute(sql`
      WITH ${locked}
      ${guard}
      seq AS (
        INSERT INTO office_sequences (key, last_value)
        SELECT ${key}, 1 FROM guard
        ON CONFLICT (key) DO UPDATE SET last_value = office_sequences.last_value + 1
        RETURNING key, last_value
      ),
      receipt AS (
        INSERT INTO office_receipts (
          id, company_id, client_id, related_client_id, invoice_id, document_number,
          amount_cents, payer_name, payer_phone, account_name, account_number,
          paid_on, paid_at_label, mpesa_ref, description, source_text, created_by_id
        )
        SELECT
          ${receiptId}::uuid,
          ${gate.currentUser.companyId}::uuid,
          ${clientId}::uuid,
          ${relatedClientId ? sql`${relatedClientId}::uuid` : sql`NULL::uuid`},
          ${singleInvoiceId ? sql`${singleInvoiceId}::uuid` : sql`NULL::uuid`},
          (SELECT key FROM seq) || '-' || lpad((SELECT last_value FROM seq)::text, 4, '0'),
          ${amountCents}::int,
          ${payerName},
          ${payerPhone || null},
          ${accountName || null},
          ${accountNumber || null},
          ${paidOn}::date,
          ${paidAtLabel || null},
          ${mpesaRef},
          ${description},
          ${sourceText || null},
          ${gate.currentUser.id}::uuid
        FROM seq
        RETURNING document_number
      )
      ${alloc}
      ${paid}
      SELECT document_number FROM receipt
    `)
    documentNumber = firstDocumentRow(saved)
  } catch (error) {
    const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : ''
    if (detail.includes('office_receipts_ref_idx') || detail.includes('duplicate key')) {
      return { error: `Reference ${mpesaRef} is already on a receipt.` }
    }
    throw error
  }
  if (!documentNumber) return { error: 'Those invoices changed while this receipt was saving. Check the amounts and try again.' as const }

  const client = await db.query.officeClients.findFirst({ where: eq(officeClients.id, clientId), columns: { name: true, email: true } })
  const covers: ReceiptCover[] = prepared.map((row) => coverFromInvoice(row.invoice, row.amount, nameOf))
  const files = receiptFiles({
    letterhead: embeddedLetterheadSrc(),
    documentNumber,
    paidOn,
    paidAtLabel: paidAtLabel || null,
    payerName,
    payerPhone: payerPhone || null,
    clientName: client?.name ?? payerName,
    clientEmail: client?.email ?? null,
    description,
    amountCents,
    mpesaRef,
    accountNumber: accountNumber || null,
    accountName: accountName || null,
    covers,
  })
  refresh()
  const paidNumbers = prepared.filter((row) => paidIds.includes(row.invoice.id)).map((row) => row.invoice.documentNumber ?? 'An invoice')
  const openNumbers = prepared.filter((row) => !paidIds.includes(row.invoice.id) && row.invoice.status !== 'paid').map((row) => row.invoice.documentNumber ?? 'An invoice')
  const paidNote = paidNumbers.length ? ` Marked paid: ${paidNumbers.join(', ')}.` : ''
  const openNote = openNumbers.length ? ` Still open: ${openNumbers.join(', ')}.` : ''
  return {
    ok: true as const,
    id: receiptId,
    documentNumber,
    html: files.combined.html,
    filename: files.combined.filename,
    files: [files.combined, ...files.people],
    notice: `Receipt ${documentNumber} saved.${paidNote}${openNote}`.trim(),
  }
}

async function loadReceiptFiles(id: string, companyId: string) {
  const db = getDb()
  const [row] = await db.select().from(officeReceipts).where(eq(officeReceipts.id, id))
  if (!row || row.companyId !== companyId) return null
  const allocations = await db.select().from(officeReceiptAllocations).where(eq(officeReceiptAllocations.receiptId, id))
  const allocatedIds = [...new Set(allocations.map((allocation) => allocation.invoiceId))]
  const allocatedInvoices = allocatedIds.length
    ? await db.query.officeInvoices.findMany({ where: inArray(officeInvoices.id, allocatedIds), with: { lines: true } })
    : []
  const subjectIds = [
    ...new Set(allocatedInvoices.flatMap((invoice) => invoice.lines.map((line) => line.subjectClientId).filter((subjectId): subjectId is string => Boolean(subjectId)))),
  ]
  const named = subjectIds.length
    ? await db.select({ id: officeClients.id, name: officeClients.name }).from(officeClients).where(inArray(officeClients.id, subjectIds))
    : []
  const nameOf = new Map(named.map((person) => [person.id, person.name]))
  const invoiceById = new Map(allocatedInvoices.map((invoice) => [invoice.id, invoice]))
  const covers: ReceiptCover[] = allocations.map((allocation) => {
    const invoice = invoiceById.get(allocation.invoiceId)
    if (!invoice) {
      return {
        personId: allocation.subjectClientId,
        personName: allocation.personName,
        invoiceNumber: allocation.invoiceNumber,
        amountCents: allocation.amountCents,
      }
    }
    return coverFromInvoice(invoice, allocation.amountCents, nameOf)
  })
  if (!covers.length && row.invoiceId) {
    const invoice = await db.query.officeInvoices.findFirst({ where: eq(officeInvoices.id, row.invoiceId), columns: { documentNumber: true, clientName: true, clientId: true } })
    if (invoice) {
      covers.push({
        personId: row.clientId ?? invoice.clientId,
        personName: invoice.clientName,
        invoiceNumber: invoice.documentNumber,
        amountCents: row.amountCents,
      })
    }
  }
  const client = row.clientId
    ? await db.query.officeClients.findFirst({ where: eq(officeClients.id, row.clientId), columns: { name: true, email: true } })
    : null
  return {
    row,
    subjects: covers.flatMap((cover) => [cover.personId, ...(cover.lines ?? []).map((line) => line.personId)]),
    files: receiptFiles({
      letterhead: embeddedLetterheadSrc(),
      documentNumber: row.documentNumber ?? 'Receipt',
      paidOn: String(row.paidOn).slice(0, 10),
      paidAtLabel: row.paidAtLabel,
      payerName: row.payerName,
      payerPhone: row.payerPhone,
      clientName: client?.name ?? row.payerName,
      clientEmail: client?.email ?? null,
      description: row.description,
      amountCents: row.amountCents,
      mpesaRef: row.mpesaRef,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
      covers,
    }),
  }
}

/** `part` is `combined`, `all`, or a person id from the receipt. */
export async function clientReceiptFile(id: string, part = 'combined') {
  const gate = await billingGate()
  if ('error' in gate) return gate
  if (!UUID.test(id)) return { error: 'That receipt is no longer there.' as const }
  const loaded = await loadReceiptFiles(id, gate.currentUser.companyId)
  if (!loaded) return { error: 'That receipt is no longer there.' as const }
  if (!receiptVisible(loaded.row, loaded.subjects, gate.scope.visibleIds)) {
    return { error: 'That receipt is for someone outside the records you manage.' as const }
  }
  const { combined, people } = loaded.files
  const chosen = part === 'all' ? (people.length > 1 ? people : [combined]) : part === 'combined' ? [combined] : people.filter((file) => file.personId === part)
  if (!chosen.length) return { error: 'That receipt copy is no longer there.' as const }
  return { ok: true as const, files: chosen.map((file) => ({ html: file.html, filename: file.filename, label: file.label })) }
}

/** Removes a receipt and reopens any invoice that this payment had fully covered. */
export async function deleteClientReceipt(id: string) {
  const gate = await billingGate()
  if ('error' in gate) return gate
  if (!gate.canIssue) return { error: 'Full client access is required to delete a receipt.' as const }
  if (!UUID.test(id)) return { error: 'That receipt is no longer there.' as const }
  const db = getDb()
  const [row] = await db.select().from(officeReceipts).where(eq(officeReceipts.id, id))
  if (!row || row.companyId !== gate.currentUser.companyId) return { error: 'That receipt is no longer there.' as const }
  const allocations = await db.select().from(officeReceiptAllocations).where(eq(officeReceiptAllocations.receiptId, id))
  if (!receiptVisible(row, allocations.map((allocation) => allocation.subjectClientId), gate.scope.visibleIds)) {
    return { error: 'That receipt is for someone outside the records you manage.' as const }
  }
  const invoiceIds = [...new Set([...allocations.map((allocation) => allocation.invoiceId), ...(row.invoiceId ? [row.invoiceId] : [])])]
  const invoices = invoiceIds.length ? await db.query.officeInvoices.findMany({ where: inArray(officeInvoices.id, invoiceIds), with: { lines: true } }) : []
  const applied = await appliedByInvoice(invoiceIds)
  const reopen = invoices
    .filter((invoice) => invoice.status === 'paid')
    .filter((invoice) => {
      const fromThis = allocations.filter((allocation) => allocation.invoiceId === invoice.id).reduce((sum, allocation) => sum + allocation.amountCents, 0)
      const legacy = row.invoiceId === invoice.id && allocations.every((allocation) => allocation.invoiceId !== invoice.id) ? row.amountCents : 0
      const remaining = (applied.get(invoice.id) ?? 0) - fromThis - legacy
      const total = invoiceTotals(invoice.lines, invoice.vatEnabled, invoice.vatRateBps).totalCents
      return remaining < total
    })
    .map((invoice) => invoice.id)

  const reopenSql = reopen.length
    ? sql`, reopen AS (
        UPDATE office_invoices
        SET status = 'sent', updated_at = now()
        WHERE id IN (${sql.join(reopen.map((invoiceId) => sql`${invoiceId}::uuid`), sql`, `)})
          AND status = 'paid'
          AND EXISTS (SELECT 1 FROM gone)
        RETURNING id
      )`
    : sql``
  await db.execute(sql`
    WITH gone AS (
      DELETE FROM office_receipts
      WHERE id = ${id}::uuid AND company_id = ${gate.currentUser.companyId}::uuid
      RETURNING id
    )
    ${reopenSql}
    SELECT id FROM gone
  `)
  refresh()
  return { ok: true as const, notice: `Receipt ${row.documentNumber ?? ''} deleted.`.trim() }
}
