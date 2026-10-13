import ExcelJS from 'exceljs'
import { readExpenseWorkbook, writeExpenseWorkbook } from './expense-workbook'
import { formatExpenseKes } from './expenses'

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

async function main() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Petty Cash')
  sheet.getCell('B2').value = 'Date'
  sheet.getCell('C2').value = 'Voucher No.'
  sheet.getCell('D2').value = 'Description / Particulars'
  sheet.getCell('E2').value = 'Paid To'
  sheet.getCell('F2').value = 'Category'
  sheet.getCell('G2').value = 'Amount (KES)'
  sheet.getCell('H2').value = 'Payment Method'
  sheet.getCell('I2').value = 'Receipt No.'
  sheet.getCell('J2').value = 'Approved By'
  sheet.getCell('K2').value = 'Remarks'
  sheet.getCell('B3').value = new Date(2026, 8, 18)
  sheet.getCell('D3').value = 'Refreshments'
  sheet.getCell('E3').value = 'The Daily cafe & bistro - Sarit center'
  sheet.getCell('F3').value = 'Refreshments'
  sheet.getCell('G3').value = { formula: '200+3890', result: 4090 }
  sheet.getCell('H3').value = 'Card'
  sheet.getCell('I3').value = '5623 & 5688'
  sheet.getCell('K3').value = 'PIN of Company included'
  sheet.getCell('B4').value = new Date(2026, 1, 8)
  sheet.getCell('D4').value = 'Vinsoc C30 shng'
  sheet.getCell('E4').value = 'Apollo sky trading'

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const parsed = await readExpenseWorkbook(buffer)
  if ('error' in parsed) throw new Error(parsed.error)
  assert(parsed.rows.length === 2, 'both rows are kept, including the one without an amount')
  assert(parsed.rows[0]?.amountCents === 409_000, 'the addition formula uses its result')
  assert(parsed.rows[0]?.spentOn === '2026-09-18', 'the date stays on the local calendar day')
  assert(parsed.rows[1]?.amountCents == null, 'a blank amount stays blank for later')

  const exported = await writeExpenseWorkbook(parsed.rows)
  const again = await readExpenseWorkbook(exported)
  if ('error' in again) throw new Error(again.error)
  assert(again.rows[0]?.receiptNo === '5623 & 5688', 'a receipt number survives a download')
  assert(formatExpenseKes(again.rows[0]?.amountCents ?? null) === 'KES 4,090', 'the exported amount reads back')
  console.log('expense workbook tests passed')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'workbook test failed')
  process.exit(1)
})
