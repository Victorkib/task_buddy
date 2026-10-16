'use client'

import { useMemo, useState, type ComponentProps, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import {
  deleteExpense,
  deleteExpenseCategory,
  exportExpenses,
  importExpenses,
  reassignExpenseCategories,
  saveExpense,
  saveExpenseCategory,
  saveVendor,
} from '@/app/admin-office-actions'
import {
  centsToAmount,
  expenseMonth,
  formatExpenseKes,
  isStandardExpenseCategory,
  mergeExpenseCategories,
  STANDARD_EXPENSE_CATEGORIES,
} from '@/lib/admin-office/expenses'
import { formatKes } from '@/lib/admin-office/policy'
import type { OfficeDesk, OfficeExpense } from '@/lib/admin-office/types'
import { Button } from '@/components/ui/button'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const METHODS = ['Mpesa', 'Cash', 'Card', 'Bank', 'Pesapal']

type Run = (
  action: () => Promise<{ error?: string; notice?: string; name?: string; id?: string; clientId?: string | null } | void>,
  fallback: string,
  onSuccess?: (result?: { name?: string; id?: string; clientId?: string | null; notice?: string }) => void,
  busy?: string,
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

function BusyButton({
  pending,
  label,
  busy,
  className,
  ...props
}: ComponentProps<typeof Button> & { pending: boolean; label: string; busy: string }) {
  return (
    <Button {...props} className={className} disabled={pending || props.disabled}>
      {pending ? (
        <>
          <Loader2 className="expense-spinner" aria-hidden="true" />
          {busy}
        </>
      ) : (
        label
      )}
    </Button>
  )
}

export function ExpensesPanel({
  desk,
  colleagues,
  pending,
  busyLabel,
  run,
}: {
  desk: OfficeDesk
  colleagues: { id: string; firstName: string; lastName: string }[]
  pending: boolean
  busyLabel: string | null
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
  const [sheet, setSheet] = useState<'none' | 'record' | 'upload' | 'organise'>('none')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkMode, setBulkMode] = useState<'selected' | 'from'>('selected')
  const [fromCategory, setFromCategory] = useState('__none__')
  const [toCategory, setToCategory] = useState<string>(STANDARD_EXPENSE_CATEGORIES[0])
  const [newCategory, setNewCategory] = useState('')

  const categories = useMemo(
    () => mergeExpenseCategories(desk.expenseCategories, desk.expenses.map((row) => row.category)),
    [desk.expenseCategories, desk.expenses],
  )
  const customCategories = useMemo(
    () => categories.filter((name) => !isStandardExpenseCategory(name)),
    [categories],
  )
  const usedCategories = useMemo(() => {
    const names = new Map<string, number>()
    for (const row of desk.expenses) {
      const key = row.category?.trim() || '__none__'
      names.set(key, (names.get(key) ?? 0) + 1)
    }
    return [...names.entries()].sort((a, b) => {
      if (a[0] === '__none__') return 1
      if (b[0] === '__none__') return -1
      return a[0].localeCompare(b[0])
    })
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

  const bookTotal = desk.expenses.reduce((sum, row) => sum + (row.amountCents ?? 0), 0)
  const totalCents = filtered.reduce((sum, row) => sum + (row.amountCents ?? 0), 0)
  const thisMonthKey = desk.today.slice(0, 7)
  const thisMonthCents = desk.expenses
    .filter((row) => expenseMonth(row.spentOn) === thisMonthKey)
    .reduce((sum, row) => sum + (row.amountCents ?? 0), 0)
  const missingAmount = desk.expenses.filter((row) => row.amountCents == null).length
  const missingReceipt = desk.expenses.filter((row) => row.amountCents != null && !row.receiptNo).length
  const uncategorised = desk.expenses.filter((row) => !row.category?.trim()).length
  const categoryTotals = new Map<string, number>()
  for (const row of filtered) {
    const name = row.category || 'Uncategorised'
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + (row.amountCents ?? 0))
  }
  const categoryChips = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const filtersActive = month !== 'all' || category !== 'all' || method !== 'all' || query.trim().length > 0
  const selectedInView = filtered.filter((row) => selectedIds.includes(row.id)).length
  const allFilteredSelected = filtered.length > 0 && selectedInView === filtered.length

  function setField(key: keyof ReturnType<typeof blankForm>, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function openRecord(row?: OfficeExpense) {
    setForm(row ? formFromExpense(row) : blankForm())
    setSheet('record')
  }

  function closeSheet() {
    setForm(blankForm())
    setSheet('none')
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      const drop = new Set(filtered.map((row) => row.id))
      setSelectedIds((current) => current.filter((id) => !drop.has(id)))
      return
    }
    setSelectedIds((current) => [...new Set([...current, ...filtered.map((row) => row.id)])])
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const data = new FormData()
    for (const [key, value] of Object.entries(form)) data.set(key, value)
    run(() => saveExpense(data), form.id ? 'Expense updated.' : 'Expense recorded.', closeSheet, form.id ? 'Saving expense…' : 'Adding expense…')
  }

  function upload() {
    if (!file) return
    const data = new FormData()
    data.set('file', file)
    if (replaceBook) data.set('replace', 'yes')
    run(
      () => importExpenses(data),
      'Workbook imported.',
      () => {
        setFile(null)
        setReplaceBook(false)
        setSheet('none')
      },
      replaceBook ? 'Replacing the book…' : 'Uploading workbook…',
    )
  }

  function download() {
    run(
      async () => {
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
      },
      'Petty cash workbook downloaded.',
      undefined,
      'Preparing Excel…',
    )
  }

  function addCategory(event: FormEvent) {
    event.preventDefault()
    const data = new FormData()
    data.set('name', newCategory)
    run(
      () => saveExpenseCategory(data),
      'Category added.',
      (result) => {
        const name = result?.name ?? newCategory.trim()
        setNewCategory('')
        if (name) {
          setToCategory(name)
          if (!form.category) setField('category', name)
        }
      },
      'Saving category…',
    )
  }

  function moveCategories(event: FormEvent) {
    event.preventDefault()
    const data = new FormData()
    data.set('mode', bulkMode)
    data.set('toCategory', toCategory)
    if (bulkMode === 'from') data.set('fromCategory', fromCategory)
    else for (const id of selectedIds) data.append('expenseId', id)
    run(
      () => reassignExpenseCategories(data),
      'Categories updated.',
      () => {
        setSelectedIds([])
        setSheet('none')
      },
      'Updating categories…',
    )
  }

  return (
    <div className={`expense-book${sheet !== 'none' ? ' is-editing' : ''}${pending ? ' is-busy' : ''}`}>
      <header className="expense-hero">
        <div className="expense-hero-copy">
          <p className="expense-kicker">Petty cash book</p>
          <h2>Expenses</h2>
          <p>Use the standard categories, add your own when needed, and move older rows in bulk when the labels need a tidy-up.</p>
        </div>
        <div className="expense-hero-actions">
          <BusyButton pending={pending} label="Record expense" busy="Working…" className="create-button" type="button" onClick={() => openRecord()} />
          <Button type="button" variant="outline" disabled={pending} onClick={() => setSheet(sheet === 'organise' ? 'none' : 'organise')}>
            Organise categories
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setSheet(sheet === 'upload' ? 'none' : 'upload')}>
            Upload Excel
          </Button>
          <BusyButton
            pending={pending && busyLabel === 'Preparing Excel…'}
            label="Download"
            busy="Preparing…"
            type="button"
            variant="outline"
            disabled={pending || desk.expenses.length === 0}
            onClick={download}
          />
        </div>
      </header>

      {pending && busyLabel ? (
        <div className="expense-busy" role="status" aria-live="polite">
          <Loader2 className="expense-spinner" aria-hidden="true" />
          <span>{busyLabel}</span>
        </div>
      ) : null}

      <div className="expense-metrics" aria-label="Expense totals">
        <article>
          <span>In the book</span>
          <strong>{formatExpenseKes(bookTotal)}</strong>
          <em>{desk.expenses.length} expenses</em>
        </article>
        <article>
          <span>This month</span>
          <strong>{formatExpenseKes(thisMonthCents)}</strong>
          <em>{monthLabel(thisMonthKey)}</em>
        </article>
        <article className={missingAmount > 0 ? 'is-attention' : ''}>
          <span>Needs an amount</span>
          <strong>{missingAmount}</strong>
          <em>{missingAmount === 0 ? 'All rows have amounts' : 'Open a row and fill it in'}</em>
        </article>
        <article className={uncategorised > 0 ? 'is-attention' : ''}>
          <span>No category yet</span>
          <strong>{uncategorised}</strong>
          <em>{uncategorised === 0 ? 'Every row is labelled' : 'Use Organise categories to move them'}</em>
        </article>
      </div>

      <div className="expense-layout">
        <section className="expense-ledger">
          <div className="expense-toolbar">
            <label className="expense-search">
              <span>Search</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Payee, voucher, receipt, or note" disabled={pending} />
            </label>
            <label>
              <span>Month</span>
              <select value={month} onChange={(event) => setMonth(event.target.value)} disabled={pending}>
                <option value="all">All months</option>
                {months.map((key) => (
                  <option key={key} value={key}>
                    {monthLabel(key)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)} disabled={pending}>
                <option value="all">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value="Uncategorised">Uncategorised</option>
              </select>
            </label>
            <label>
              <span>Method</span>
              <select value={method} onChange={(event) => setMethod(event.target.value)} disabled={pending}>
                <option value="all">All methods</option>
                {METHODS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value="Not set">Not set</option>
              </select>
            </label>
            {filtersActive ? (
              <button
                type="button"
                className="expense-clear"
                disabled={pending}
                onClick={() => {
                  setQuery('')
                  setMonth('all')
                  setCategory('all')
                  setMethod('all')
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>

          <div className="expense-ledger-meta">
            <strong>{formatExpenseKes(totalCents)}</strong>
            <span>
              {filtered.length} of {desk.expenses.length} shown
              {selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ''}
              {missingReceipt > 0 ? ` · ${missingReceipt} without a receipt number` : ''}
              {desk.imprestOutstandingKes > 0 ? ` · ${formatKes(desk.imprestOutstandingKes)} imprest still out` : ''}
            </span>
            {filtered.length > 0 ? (
              <button type="button" className="expense-clear" disabled={pending} onClick={toggleAllFiltered}>
                {allFilteredSelected ? 'Clear ticks in this view' : 'Tick all in this view'}
              </button>
            ) : null}
          </div>

          {categoryChips.length > 0 ? (
            <div className="expense-chips" aria-label="Spend by category">
              {categoryChips.map(([name, cents]) => (
                <button
                  key={name}
                  type="button"
                  className={category === name ? 'selected' : ''}
                  disabled={pending}
                  onClick={() => setCategory(category === name ? 'all' : name)}
                >
                  <span>{name}</span>
                  <em>{formatExpenseKes(cents)}</em>
                </button>
              ))}
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <div className="expense-empty">
              <strong>No expenses in this view</strong>
              <p>Record one, clear the filters, or upload the petty cash workbook.</p>
            </div>
          ) : (
            <div className="expense-table-wrap">
              <table className="expense-table">
                <thead>
                  <tr>
                    <th className="check">
                      <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} disabled={pending} aria-label="Select expenses in this view" />
                    </th>
                    <th>Date</th>
                    <th>What was paid</th>
                    <th>Category</th>
                    <th>Method</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const editing = form.id === row.id && sheet === 'record'
                    const missing = row.amountCents == null
                    const checked = selectedIds.includes(row.id)
                    return (
                      <tr
                        key={row.id}
                        className={editing ? 'is-selected' : missing ? 'is-missing' : checked ? 'is-checked' : ''}
                        onClick={() => openRecord(row)}
                      >
                        <td className="check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={pending}
                            onChange={() => toggleSelected(row.id)}
                            aria-label={`Select ${row.description || row.paidTo || 'expense'}`}
                          />
                        </td>
                        <td>
                          <strong>{prettyDate(row.spentOn)}</strong>
                          {row.voucherNo ? <span className="expense-sub">{row.voucherNo}</span> : null}
                        </td>
                        <td>
                          <strong>{row.description || row.paidTo || '—'}</strong>
                          <span className="expense-sub">
                            {[row.paidTo, row.receiptNo ? `Receipt ${row.receiptNo}` : null, row.approvedBy ? `Approved ${row.approvedBy}` : null]
                              .filter(Boolean)
                              .join(' · ') || 'No payee yet'}
                          </span>
                          {row.remarks ? <span className="expense-note">{row.remarks}</span> : null}
                        </td>
                        <td>
                          {row.category || <span className="expense-flag">No category</span>}
                        </td>
                        <td>{row.paymentMethod || '—'}</td>
                        <td className="num">
                          <span className="expense-amount">{formatExpenseKes(row.amountCents)}</span>
                          {missing ? <span className="expense-flag">Needs amount</span> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {sheet === 'record' ? (
          <form className="expense-sheet" onSubmit={save}>
            <div className="expense-sheet-head">
              <div>
                <p className="expense-kicker">{form.id ? 'Edit row' : 'New row'}</p>
                <h3>{form.id ? 'Update expense' : 'Record expense'}</h3>
              </div>
              <button type="button" onClick={closeSheet} disabled={pending}>
                Close
              </button>
            </div>
            <div className="expense-sheet-grid">
              <label>
                Date
                <input type="date" value={form.spentOn} onChange={(event) => setField('spentOn', event.target.value)} disabled={pending} />
              </label>
              <label>
                Voucher No.
                <input value={form.voucherNo} onChange={(event) => setField('voucherNo', event.target.value)} placeholder="GC - 006" disabled={pending} />
              </label>
              <label className="span-2">
                Description
                <input value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Office stationery" disabled={pending} />
              </label>
              <label>
                Paid to
                <input value={form.paidTo} onChange={(event) => setField('paidTo', event.target.value)} placeholder="Supplier or person" disabled={pending} />
              </label>
              <label>
                Category
                <select value={form.category} onChange={(event) => setField('category', event.target.value)} disabled={pending} required>
                  <option value="">Choose a category</option>
                  <optgroup label="Standard">
                    {STANDARD_EXPENSE_CATEGORIES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                  {customCategories.length > 0 ? (
                    <optgroup label="Added by the office">
                      {customCategories.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <label>
                Amount (KES)
                <input value={form.amount} onChange={(event) => setField('amount', event.target.value)} inputMode="decimal" placeholder="1500" disabled={pending} />
              </label>
              <label>
                Payment method
                <input value={form.paymentMethod} onChange={(event) => setField('paymentMethod', event.target.value)} list="expense-methods" placeholder="Mpesa" disabled={pending} />
              </label>
              <label>
                Receipt No.
                <input value={form.receiptNo} onChange={(event) => setField('receiptNo', event.target.value)} disabled={pending} />
              </label>
              <label>
                Approved by
                <input value={form.approvedBy} onChange={(event) => setField('approvedBy', event.target.value)} placeholder="Director" disabled={pending} />
              </label>
              <label className="span-2">
                Remarks
                <textarea rows={2} value={form.remarks} onChange={(event) => setField('remarks', event.target.value)} placeholder="Any note for the book" disabled={pending} />
              </label>
            </div>
            <datalist id="expense-methods">{METHODS.map((name) => <option key={name} value={name} />)}</datalist>
            <p className="expense-sheet-copy">Need a category that is not on the list? Open Organise categories and add it there.</p>
            <div className="expense-sheet-actions">
              <BusyButton
                pending={pending}
                label={form.id ? 'Save changes' : 'Add to the book'}
                busy={form.id ? 'Saving…' : 'Adding…'}
                className="create-button"
                type="submit"
              />
              {form.id ? (
                <BusyButton
                  pending={pending}
                  label="Remove"
                  busy="Removing…"
                  type="button"
                  variant="outline"
                  onClick={() => run(() => deleteExpense(form.id), 'Expense removed.', closeSheet, 'Removing expense…')}
                />
              ) : null}
            </div>
          </form>
        ) : null}

        {sheet === 'upload' ? (
          <aside className="expense-sheet">
            <div className="expense-sheet-head">
              <div>
                <p className="expense-kicker">Excel</p>
                <h3>Upload workbook</h3>
              </div>
              <button type="button" onClick={() => setSheet('none')} disabled={pending}>
                Close
              </button>
            </div>
            <p className="expense-sheet-copy">
              Use the sheet with Date, Voucher No., Description, Paid To, Category, Amount, Payment Method, Receipt No., Approved By, and Remarks. After it lands, use Organise categories if the old labels need moving onto the standard list.
            </p>
            <div className="expense-upload">
              <label className="expense-file">
                <span>{file ? file.name : 'Choose an .xlsx file'}</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={pending}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <label className="expense-replace">
                <input type="checkbox" checked={replaceBook} disabled={pending} onChange={(event) => setReplaceBook(event.target.checked)} />
                Replace the expenses already saved
              </label>
              <BusyButton
                pending={pending}
                label={replaceBook ? 'Replace from Excel' : 'Add from Excel'}
                busy={replaceBook ? 'Replacing…' : 'Uploading…'}
                className="create-button"
                type="button"
                disabled={!file}
                onClick={upload}
              />
            </div>
          </aside>
        ) : null}

        {sheet === 'organise' ? (
          <aside className="expense-sheet">
            <div className="expense-sheet-head">
              <div>
                <p className="expense-kicker">Categories</p>
                <h3>Organise the book</h3>
              </div>
              <button type="button" onClick={() => setSheet('none')} disabled={pending}>
                Close
              </button>
            </div>

            <section className="expense-organise-block">
              <h4>Standard list</h4>
              <p className="expense-sheet-copy">These stay available on every expense.</p>
              <ul className="expense-category-pills">
                {STANDARD_EXPENSE_CATEGORIES.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </section>

            <section className="expense-organise-block">
              <h4>Add a category</h4>
              <form className="expense-add-category" onSubmit={addCategory}>
                <input
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  placeholder="e.g. Office tea"
                  disabled={pending}
                  required
                />
                <BusyButton pending={pending} label="Add" busy="Saving…" className="create-button" type="submit" disabled={!newCategory.trim()} />
              </form>
              {customCategories.length > 0 ? (
                <ul className="expense-custom-list">
                  {customCategories.map((name) => (
                    <li key={name}>
                      <span>{name}</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => deleteExpenseCategory(name), 'Category removed.', undefined, 'Removing category…')}
                      >
                        Remove from list
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="expense-empty-inline">No custom categories yet.</p>
              )}
            </section>

            <section className="expense-organise-block">
              <h4>Move expenses in bulk</h4>
              <p className="expense-sheet-copy">
                Tick rows in the book, or move every expense that still carries an old label onto one of the categories above.
              </p>
              <form className="expense-bulk" onSubmit={moveCategories}>
                <div className="expense-bulk-modes">
                  <label className="expense-replace">
                    <input type="radio" name="bulkMode" checked={bulkMode === 'selected'} disabled={pending} onChange={() => setBulkMode('selected')} />
                    Move the {selectedIds.length} ticked expense{selectedIds.length === 1 ? '' : 's'}
                  </label>
                  <label className="expense-replace">
                    <input type="radio" name="bulkMode" checked={bulkMode === 'from'} disabled={pending} onChange={() => setBulkMode('from')} />
                    Move everything currently in one category
                  </label>
                </div>
                {bulkMode === 'from' ? (
                  <label>
                    From
                    <select value={fromCategory} onChange={(event) => setFromCategory(event.target.value)} disabled={pending}>
                      {usedCategories.map(([name, count]) => (
                        <option key={name} value={name}>
                          {name === '__none__' ? 'No category yet' : name} ({count})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="expense-empty-inline">
                    {selectedIds.length === 0
                      ? 'Tick one or more rows in the book first.'
                      : `${selectedIds.length} selected${selectedInView !== selectedIds.length ? ` · ${selectedInView} visible in this filter` : ''}.`}
                  </p>
                )}
                <label>
                  Into
                  <select value={toCategory} onChange={(event) => setToCategory(event.target.value)} disabled={pending}>
                    <optgroup label="Standard">
                      {STANDARD_EXPENSE_CATEGORIES.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </optgroup>
                    {customCategories.length > 0 ? (
                      <optgroup label="Added by the office">
                        {customCategories.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </label>
                <BusyButton
                  pending={pending}
                  label="Move expenses"
                  busy="Updating…"
                  className="create-button"
                  type="submit"
                  disabled={bulkMode === 'selected' ? selectedIds.length === 0 : usedCategories.length === 0}
                />
              </form>
            </section>
          </aside>
        ) : null}
      </div>

      <section className="expense-vendors">
        <button type="button" className="expense-vendors-toggle" onClick={() => setShowVendors((value) => !value)}>
          <span>
            <strong>Vendors</strong>
            <em>{desk.vendors.length} on file · renewals in 45 days still appear on Today</em>
          </span>
          <span>{showVendors ? 'Hide' : 'Show'}</span>
        </button>
        {showVendors ? (
          <div className="expense-vendors-body">
            <form
              className="expense-sheet-grid"
              onSubmit={(event) => {
                event.preventDefault()
                const node = event.currentTarget
                run(() => saveVendor(new FormData(node)), 'Vendor saved.', () => node.reset(), 'Saving vendor…')
              }}
            >
              <label>
                Name
                <input name="name" required disabled={pending} />
              </label>
              <label>
                Category
                <input name="category" placeholder="software, lease, insurance" disabled={pending} />
              </label>
              <label>
                Renewal
                <input type="date" name="renewalDate" disabled={pending} />
              </label>
              <label>
                Amount (KES)
                <input name="amountKes" defaultValue="0" disabled={pending} />
              </label>
              <label className="span-2">
                Owner
                <select name="ownerId" defaultValue="" disabled={pending}>
                  <option value="">Unassigned</option>
                  {colleagues.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.firstName} {person.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span-2">
                Notes
                <textarea name="notes" rows={2} disabled={pending} />
              </label>
              <div className="expense-sheet-actions span-2">
                <BusyButton pending={pending} label="Add vendor" busy="Saving…" className="create-button" type="submit" />
              </div>
            </form>
            {desk.vendors.length === 0 ? (
              <p className="expense-empty-inline">No vendors saved yet.</p>
            ) : (
              <ul className="expense-vendor-list">
                {desk.vendors.map((vendor) => (
                  <li key={vendor.id}>
                    <strong>{vendor.name}</strong>
                    <span>
                      {vendor.category}
                      {vendor.renewalDate ? ` · renews ${prettyDate(vendor.renewalDate)}` : ''}
                      {vendor.amountKes ? ` · ${formatKes(vendor.amountKes)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
