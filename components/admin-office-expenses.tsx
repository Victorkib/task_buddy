'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { deleteExpense, exportExpenses, importExpenses, saveExpense, saveVendor } from '@/app/admin-office-actions'
import { centsToAmount, expenseMonth, formatExpenseKes } from '@/lib/admin-office/expenses'
import { formatKes } from '@/lib/admin-office/policy'
import type { OfficeDesk, OfficeExpense } from '@/lib/admin-office/types'
import { Button } from '@/components/ui/button'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const METHODS = ['Mpesa', 'Cash', 'Card', 'Bank', 'Pesapal']

type Run = (
  action: () => Promise<{ error?: string; notice?: string } | void>,
  fallback: string,
  onSuccess?: () => void,
) => void

function prettyDate(value: string | null) {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

function monthLabel(key: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return 'No date'
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

function blankForm() {
  return {
    id: '',
    spentOn: '',
    voucherNo: '',
    description: '',
    paidTo: '',
    category: '',
    amount: '',
    paymentMethod: '',
    receiptNo: '',
    approvedBy: '',
    remarks: '',
  }
}

function formFromExpense(row: OfficeExpense) {
  return {
    id: row.id,
    spentOn: row.spentOn ?? '',
    voucherNo: row.voucherNo ?? '',
    description: row.description,
    paidTo: row.paidTo ?? '',
    category: row.category ?? '',
    amount: centsToAmount(row.amountCents),
    paymentMethod: row.paymentMethod ?? '',
    receiptNo: row.receiptNo ?? '',
    approvedBy: row.approvedBy ?? '',
    remarks: row.remarks ?? '',
  }
}

export function ExpensesPanel({
  desk,
  colleagues,
  pending,
  run,
}: {
  desk: OfficeDesk
  colleagues: { id: string; firstName: string; lastName: string }[]
  pending: boolean
  run: Run
}) {
  const [form, setForm] = useState(blankForm)
  const [query, setQuery] = useState('')
  const [month, setMonth] = useState('all')
  const [category, setCategory] = useState('all')
  const [method, setMethod] = useState('all')
  const [file, setFile] = useState<File | null>(null)
  const [replaceBook, setReplaceBook] = useState(false)
  const [showVendors, setShowVendors] = useState(false)
  const [sheet, setSheet] = useState<'none' | 'record' | 'upload'>('none')

  const categories = useMemo(() => {
    const names = new Set<string>()
    for (const row of desk.expenses) if (row.category) names.add(row.category)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [desk.expenses])

  const months = useMemo(() => {
    const keys = new Set<string>()
    for (const row of desk.expenses) {
      const key = expenseMonth(row.spentOn)
      if (key) keys.add(key)
    }
    return [...keys].sort().reverse()
  }, [desk.expenses])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...desk.expenses].reverse().filter((row) => {
      if (month !== 'all' && expenseMonth(row.spentOn) !== month) return false
      if (category !== 'all' && (row.category || 'Uncategorised') !== category) return false
      if (method !== 'all' && (row.paymentMethod || 'Not set') !== method) return false
      if (!needle) return true
      return [row.description, row.paidTo, row.voucherNo, row.receiptNo, row.remarks, row.category, row.approvedBy]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [desk.expenses, query, month, category, method])

  const totalCents = filtered.reduce((sum, row) => sum + (row.amountCents ?? 0), 0)
  const thisMonthKey = desk.today.slice(0, 7)
  const thisMonthCents = desk.expenses
    .filter((row) => expenseMonth(row.spentOn) === thisMonthKey)
    .reduce((sum, row) => sum + (row.amountCents ?? 0), 0)
  const missingAmount = desk.expenses.filter((row) => row.amountCents == null).length
  const missingReceipt = desk.expenses.filter((row) => row.amountCents != null && !row.receiptNo).length
  const categoryTotals = new Map<string, number>()
  for (const row of filtered) {
    const name = row.category || 'Uncategorised'
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + (row.amountCents ?? 0))
  }
  const categoryChips = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  function setField(key: keyof ReturnType<typeof blankForm>, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const data = new FormData()
    for (const [key, value] of Object.entries(form)) data.set(key, value)
    run(() => saveExpense(data), form.id ? 'Expense updated.' : 'Expense recorded.', () => {
      setForm(blankForm())
      setSheet('none')
    })
  }

  function upload() {
    if (!file) return
    const data = new FormData()
    data.set('file', file)
    if (replaceBook) data.set('replace', 'yes')
    run(() => importExpenses(data), 'Workbook imported.', () => {
      setFile(null)
      setReplaceBook(false)
    })
  }

  function download() {
    run(async () => {
      const result = await exportExpenses()
      if (result && 'error' in result && result.error) return result
      if (result && 'base64' in result && result.base64) {
        const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.filename
        link.click()
        URL.revokeObjectURL(url)
      }
      return { notice: 'Petty cash workbook downloaded.' }
    }, 'Petty cash workbook downloaded.')
  }

  return (
    <div className="expense-book">
      <header className="office-module-head">
        <div>
          <h2>Expenses</h2>
          <p className="office-summary">
            {formatExpenseKes(desk.expenses.reduce((sum, row) => sum + (row.amountCents ?? 0), 0))} in the book
            {' · '}
            {formatExpenseKes(thisMonthCents)} in {monthLabel(thisMonthKey)}
            {missingAmount > 0 ? ` · ${missingAmount} still need an amount` : ''}
            {missingReceipt > 0 ? ` · ${missingReceipt} without a receipt number` : ''}
          </p>
        </div>
        <div className="office-module-actions">
          <Button type="button" className="create-button" onClick={() => { setForm(blankForm()); setSheet('record') }}>Record</Button>
          <Button type="button" variant="outline" onClick={() => setSheet(sheet === 'upload' ? 'none' : 'upload')}>Upload Excel</Button>
          <Button type="button" variant="outline" disabled={pending || desk.expenses.length === 0} onClick={download}>Download</Button>
        </div>
      </header>
      <div className="office-work">
      <section className="panel office-record">
        <p className="office-summary">{formatExpenseKes(totalCents)} in this view · {filtered.length} of {desk.expenses.length}{desk.imprestOutstandingKes > 0 ? ` · ${formatKes(desk.imprestOutstandingKes)} of imprest is still out` : ''}</p>
        <div className="expense-filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payee, receipt, voucher, or note" />
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            <option value="all">All months</option>
            {months.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value="Uncategorised">Uncategorised</option>
          </select>
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="all">All methods</option>
            {METHODS.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value="Not set">Not set</option>
          </select>
        </div>
        {categoryChips.length > 0 ? (
          <div className="expense-chips">
            {categoryChips.map(([name, cents]) => (
              <button key={name} type="button" className={category === name ? 'selected' : ''} onClick={() => setCategory(category === name ? 'all' : name)}>
                {name} · {formatExpenseKes(cents)}
              </button>
            ))}
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <p className="empty-state">No expenses in this view. Record one, or upload the petty cash workbook.</p>
        ) : (
          <div className="expense-table-wrap">
            <table className="expense-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Description</th>
                  <th>Paid to</th>
                  <th>Category</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Receipt</th>
                  <th>Approved</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className={form.id === row.id ? 'is-selected' : row.amountCents == null ? 'is-missing' : ''}
                    onClick={() => { setForm(formFromExpense(row)); setSheet('record') }}
                  >
                    <td>{prettyDate(row.spentOn)}</td>
                    <td>{row.voucherNo || '—'}</td>
                    <td>{row.description || '—'}</td>
                    <td>{row.paidTo || '—'}</td>
                    <td>{row.category || '—'}</td>
                    <td className="expense-amount">{formatExpenseKes(row.amountCents)}</td>
                    <td>{row.paymentMethod || '—'}</td>
                    <td>{row.receiptNo || '—'}</td>
                    <td>{row.approvedBy || '—'}</td>
                    <td>{row.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {sheet === 'record' ? (
        <form className="office-sheet form-grid" onSubmit={save}>
          <div className="office-sheet-head span-2">
            <h2>{form.id ? 'Update this expense' : 'Record an expense'}</h2>
            <button type="button" onClick={() => { setForm(blankForm()); setSheet('none') }}>Close</button>
          </div>
          <p className="field-hint span-2">Date, voucher, what it was, who was paid, and the receipt. The same columns as the petty cash book.</p>
          <label>Date<input type="date" value={form.spentOn} onChange={(event) => setField('spentOn', event.target.value)} /></label>
          <label>Voucher No.<input value={form.voucherNo} onChange={(event) => setField('voucherNo', event.target.value)} placeholder="GC - 006" /></label>
          <label className="span-2">Description / Particulars<input value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Office stationery" /></label>
          <label>Paid To<input value={form.paidTo} onChange={(event) => setField('paidTo', event.target.value)} placeholder="Supplier or person" /></label>
          <label>Category<input value={form.category} onChange={(event) => setField('category', event.target.value)} list="expense-categories" placeholder="Stationery" /></label>
          <label>Amount (KES)<input value={form.amount} onChange={(event) => setField('amount', event.target.value)} inputMode="decimal" placeholder="1500" /></label>
          <label>Payment Method<input value={form.paymentMethod} onChange={(event) => setField('paymentMethod', event.target.value)} list="expense-methods" placeholder="Mpesa" /></label>
          <label>Receipt No.<input value={form.receiptNo} onChange={(event) => setField('receiptNo', event.target.value)} /></label>
          <label>Approved By<input value={form.approvedBy} onChange={(event) => setField('approvedBy', event.target.value)} placeholder="Director" /></label>
          <label className="span-2">Remarks<textarea rows={2} value={form.remarks} onChange={(event) => setField('remarks', event.target.value)} placeholder="PIN of Company included" /></label>
          <datalist id="expense-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
          <datalist id="expense-methods">{METHODS.map((name) => <option key={name} value={name} />)}</datalist>
          <div className="modal-actions span-2">
            <Button className="create-button" type="submit" disabled={pending}>{form.id ? 'Save changes' : 'Add expense'}</Button>
            {form.id ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => deleteExpense(form.id), 'Expense removed.', () => { setForm(blankForm()); setSheet('none') })}>
                Remove
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      {sheet === 'upload' ? (
        <aside className="office-sheet">
          <div className="office-sheet-head">
            <h2>Upload the petty cash workbook</h2>
            <button type="button" onClick={() => setSheet('none')}>Close</button>
          </div>
          <p className="field-hint">Use the sheet with Date, Voucher No., Description, Paid To, Category, Amount, Payment Method, Receipt No., Approved By, and Remarks. You can correct any row after it lands.</p>
          <div className="expense-upload">
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <label className="expense-replace">
              <input type="checkbox" checked={replaceBook} onChange={(event) => setReplaceBook(event.target.checked)} />
              Replace the expenses already saved
            </label>
            <Button type="button" className="create-button" disabled={pending || !file} onClick={upload}>
              {replaceBook ? 'Replace from Excel' : 'Add from Excel'}
            </Button>
          </div>
        </aside>
      ) : null}
      </div>
      <section className="panel office-vendors">
        <div className="panel-heading">
          <div>
            <h2>Vendors</h2>
            <p>Renewals inside 45 days still appear on Today.</p>
          </div>
          <button type="button" className="filter-pill" onClick={() => setShowVendors((value) => !value)}>{showVendors ? 'Hide' : 'Show'}</button>
        </div>
        {showVendors ? (
          <>
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const node = event.currentTarget; run(() => saveVendor(new FormData(node)), 'Vendor saved.', () => node.reset()) }}>
              <label>Name<input name="name" required /></label>
              <label>Category<input name="category" placeholder="software, lease, insurance" /></label>
              <label>Renewal<input type="date" name="renewalDate" /></label>
              <label>Amount (KES)<input name="amountKes" defaultValue="0" /></label>
              <label className="span-2">Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{colleagues.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select></label>
              <label className="span-2">Notes<textarea name="notes" rows={2} /></label>
              <div className="modal-actions span-2"><Button className="create-button" type="submit" disabled={pending}>Add vendor</Button></div>
            </form>
            <ul className="office-list">
              {desk.vendors.map((vendor) => (
                <li key={vendor.id}><strong>{vendor.name}</strong> · {vendor.category}{vendor.renewalDate ? ` · renews ${prettyDate(vendor.renewalDate)}` : ''}{vendor.amountKes ? ` · ${formatKes(vendor.amountKes)}` : ''}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  )
}
