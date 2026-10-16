import {
  centsToAmount,
  expenseFingerprint,
  formatExpenseKes,
  isStandardExpenseCategory,
  mergeExpenseCategories,
  parseAmountText,
  STANDARD_EXPENSE_CATEGORIES,
} from './expenses'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

assert(parseAmountText('7300') === 730_000, 'whole shillings become cents')
assert(parseAmountText('10,027.11') === 1_002_711, 'cents survive commas')
assert(parseAmountText('=200+3890') === 409_000, 'a simple addition formula is totaled')
assert(parseAmountText('=1850+9300') === 1_115_000, 'the cafe split is totaled')
assert(parseAmountText('KES 1,500') === 150_000, 'a currency label is ignored')
assert(parseAmountText('=2*3') === null, 'anything besides addition is refused')
assert(parseAmountText('') === null, 'a blank amount stays blank')
assert(formatExpenseKes(1_002_711) === 'KES 10,027.11', 'cents are shown')
assert(formatExpenseKes(730_000) === 'KES 7,300', 'whole amounts stay whole')
assert(formatExpenseKes(null) === '—', 'a missing amount is visible')
assert(centsToAmount(1_002_711) === '10027.11', 'the editor receives a plain amount')
assert(
  expenseFingerprint({
    spentOn: '2026-09-18',
    paidTo: 'The Daily cafe',
    description: 'Refreshments',
    amountCents: 409_000,
    receiptNo: '5623 & 5688',
  }) === expenseFingerprint({
    spentOn: '2026-09-18',
    paidTo: ' the daily cafe ',
    description: 'refreshments',
    amountCents: 409_000,
    receiptNo: '5623 & 5688',
  }),
  'the same expense matches regardless of spacing and case',
)

assert(STANDARD_EXPENSE_CATEGORIES.includes('Petty cash'), 'Petty cash is on the standard list')
assert(STANDARD_EXPENSE_CATEGORIES.includes('Caffe Leo'), 'Caffe Leo is on the standard list')
assert(isStandardExpenseCategory('KPLC'), 'KPLC is treated as standard')
assert(
  mergeExpenseCategories(['Office tea'], ['Google', null, 'Legacy label'])[0] === 'Petty cash',
  'standard categories stay first',
)
assert(
  mergeExpenseCategories(['Office tea'], ['Legacy label']).includes('Office tea') &&
    mergeExpenseCategories(['Office tea'], ['Legacy label']).includes('Legacy label'),
  'custom and legacy labels stay available for tidy-up',
)

console.log('expense tests passed')
