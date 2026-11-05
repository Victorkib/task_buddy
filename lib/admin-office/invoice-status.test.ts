import { invoiceDraftRefusal } from './invoice-status'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

assert(invoiceDraftRefusal('sent', ['GCS-RCT-2026-0002']) === null, 'a sent invoice may return to draft')
assert(invoiceDraftRefusal('void', []) === null, 'a void invoice may be restored as draft')
assert(invoiceDraftRefusal('paid', []) === null, 'a paid invoice with no receipt may return to draft')
assert(invoiceDraftRefusal('draft', ['GCS-RCT-2026-0002']) === null, 'draft is not blocked by this check')

const blocked = invoiceDraftRefusal('paid', ['GCS-RCT-2026-0002'])
assert(
  blocked === 'Delete GCS-RCT-2026-0002 first. This invoice is paid by that receipt.',
  'a paid invoice names the receipt that must be deleted first',
)
assert(
  invoiceDraftRefusal('paid', [' GCS-RCT-2026-0002 ', 'GCS-RCT-2026-0002', '']) === blocked,
  'blank and repeated receipt numbers are collapsed',
)
assert(
  invoiceDraftRefusal('paid', ['GCS-RCT-2026-0001', 'GCS-RCT-2026-0002']) ===
    'Delete GCS-RCT-2026-0001, GCS-RCT-2026-0002 first. This invoice is paid by that receipt.',
  'every receipt on a paid invoice is named',
)

console.log('invoice status checks passed')
