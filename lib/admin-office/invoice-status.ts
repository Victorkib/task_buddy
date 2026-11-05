/**
 * A paid invoice stays paid while a receipt is still applied.
 * Sent and void invoices may become draft. A paid invoice with no receipt may too.
 */
export function invoiceDraftRefusal(currentStatus: string, receiptNumbers: readonly string[]): string | null {
  if (currentStatus !== 'paid') return null
  const names = [...new Set(receiptNumbers.map((number) => number.trim()).filter(Boolean))]
  if (!names.length) return null
  return `Delete ${names.join(', ')} first. This invoice is paid by that receipt.`
}
