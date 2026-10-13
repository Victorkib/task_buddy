export type ExpenseDraft = {
  spentOn: string | null
  voucherNo: string
  description: string
  paidTo: string
  category: string
  amountCents: number | null
  paymentMethod: string
  receiptNo: string
  approvedBy: string
  remarks: string
}

const MAX_CENTS = 50_000_000 * 100

export function formatExpenseKes(cents: number | null | undefined) {
  if (cents == null) return '—'
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = absolute % 100
  if (frac === 0) return `KES ${sign}${whole}`
  return `KES ${sign}${whole}.${String(frac).padStart(2, '0')}`
}

export function centsToAmount(cents: number | null | undefined) {
  if (cents == null) return ''
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100)
  const frac = absolute % 100
  if (frac === 0) return `${sign}${whole}`
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`
}

export function parseAmountText(value: string) {
  const trimmed = value.trim().replace(/kes/gi, '').replace(/,/g, '').replace(/^=/, '').trim()
  if (!trimmed) return null
  if (!/^[\d.\s+]+$/.test(trimmed)) return null
  const parts = trimmed.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null
  let total = 0
  for (const part of parts) {
    const cents = decimalToCents(part)
    if (cents == null) return null
    total += cents
  }
  if (total < 0 || total > MAX_CENTS) return null
  return total
}

function decimalToCents(value: string) {
  const [whole, frac = ''] = value.split('.')
  if (!/^\d+$/.test(whole)) return null
  const padded = `${frac}00`
  let cents = Number(whole) * 100 + Number(padded.slice(0, 2))
  if (padded[2] >= '5') cents += 1
  return cents
}

export function expenseMonth(spentOn: string | null) {
  return spentOn ? spentOn.slice(0, 7) : ''
}

export function expenseFingerprint(row: Pick<ExpenseDraft, 'spentOn' | 'paidTo' | 'description' | 'amountCents' | 'receiptNo'>) {
  return [
    row.spentOn ?? '',
    row.paidTo.trim().toLowerCase(),
    row.description.trim().toLowerCase(),
    row.amountCents ?? '',
    row.receiptNo.trim().toLowerCase(),
  ].join('|')
}

export function emptyExpense(): ExpenseDraft {
  return {
    spentOn: null,
    voucherNo: '',
    description: '',
    paidTo: '',
    category: '',
    amountCents: null,
    paymentMethod: '',
    receiptNo: '',
    approvedBy: '',
    remarks: '',
  }
}
