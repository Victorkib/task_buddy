import ExcelJS from 'exceljs'
import { emptyExpense, parseAmountText, type ExpenseDraft } from '@/lib/admin-office/expenses'

const HEADERS = [
  'Date',
  'Voucher No.',
  'Description / Particulars',
  'Paid To',
  'Category',
  'Amount (KES)',
  'Payment Method',
  'Receipt No.',
  'Approved By',
  'Remarks',
] as const

type Field = keyof ExpenseDraft

const HEADER_FIELDS: Array<{ field: Field; test: (header: string) => boolean }> = [
  { field: 'spentOn', test: (header) => header === 'date' },
  { field: 'voucherNo', test: (header) => header.includes('voucher') },
  { field: 'description', test: (header) => header.includes('description') || header.includes('particular') },
  { field: 'paidTo', test: (header) => header.includes('paid to') || header === 'payee' },
  { field: 'category', test: (header) => header === 'category' },
  { field: 'amountCents', test: (header) => header.includes('amount') },
  { field: 'paymentMethod', test: (header) => header.includes('payment') || header === 'method' },
  { field: 'receiptNo', test: (header) => header.includes('receipt') },
  { field: 'approvedBy', test: (header) => header.includes('approved') },
  { field: 'remarks', test: (header) => header.includes('remark') || header === 'notes' },
]

function headerText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim()
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value && value.result != null && typeof value.result !== 'object') return String(value.result).trim()
    if ('formula' in value && typeof value.formula === 'string') return `=${value.formula}`
  }
  return ''
}

function cellAmount(value: ExcelJS.CellValue) {
  if (typeof value === 'number' && Number.isFinite(value)) return parseAmountText(String(value))
  if (value && typeof value === 'object' && 'result' in value && typeof value.result === 'number') {
    return parseAmountText(String(value.result))
  }
  return parseAmountText(cellText(value))
}

function cellDate(value: ExcelJS.CellValue) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  if (typeof value === 'number' && value > 20_000 && value < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  const text = cellText(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text)
  if (slash) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`
  return null
}

function findHeader(sheet: ExcelJS.Worksheet) {
  const limit = Math.min(sheet.rowCount, 20)
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const columns = new Map<Field, number>()
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const header = headerText(cellText(cell.value))
      if (!header) return
      for (const candidate of HEADER_FIELDS) {
        if (!columns.has(candidate.field) && candidate.test(header)) columns.set(candidate.field, column)
      }
    })
    if (columns.has('spentOn') && columns.has('amountCents')) return { rowNumber, columns }
  }
  return null
}

function draftFromRow(row: ExcelJS.Row, columns: Map<Field, number>): ExpenseDraft {
  const draft = emptyExpense()
  for (const [field, column] of columns) {
    const value = row.getCell(column).value
    if (field === 'spentOn') draft.spentOn = cellDate(value)
    else if (field === 'amountCents') draft.amountCents = cellAmount(value)
    else draft[field] = cellText(value).slice(0, 500)
  }
  return draft
}

function rowHasContent(row: ExpenseDraft) {
  return Boolean(
    row.spentOn ||
      row.voucherNo ||
      row.description ||
      row.paidTo ||
      row.category ||
      row.amountCents != null ||
      row.paymentMethod ||
      row.receiptNo ||
      row.approvedBy ||
      row.remarks,
  )
}

export async function readExpenseWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets.find((entry) => entry.rowCount > 1) ?? workbook.worksheets[0]
  if (!sheet) return { error: 'The workbook has no sheets.' as const }
  const header = findHeader(sheet)
  if (!header) {
    return {
      error: 'The sheet needs a header row with Date and Amount (KES), like the petty cash book.' as const,
    }
  }
  const rows: ExpenseDraft[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= header.rowNumber) return
    const draft = draftFromRow(row, header.columns)
    if (rowHasContent(draft)) rows.push(draft)
  })
  if (rows.length === 0) return { error: 'No expense rows were found under the header.' as const }
  return { ok: true as const, rows, sheetName: sheet.name }
}

export async function writeExpenseWorkbook(rows: ExpenseDraft[]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Petty Cash')
  sheet.addRow([...HEADERS])
  sheet.getRow(1).font = { name: 'Arial', bold: true }
  for (const row of rows) {
    const amount = row.amountCents == null ? null : row.amountCents / 100
    sheet.addRow([
      row.spentOn ? new Date(`${row.spentOn}T00:00:00`) : null,
      row.voucherNo || null,
      row.description || null,
      row.paidTo || null,
      row.category || null,
      amount,
      row.paymentMethod || null,
      row.receiptNo || null,
      row.approvedBy || null,
      row.remarks || null,
    ])
  }
  sheet.getColumn(1).numFmt = 'dd mmm yyyy'
  sheet.getColumn(6).numFmt = '#,##0.00'
  sheet.columns.forEach((column) => {
    column.width = 22
  })
  sheet.getColumn(3).width = 48
  const file = await workbook.xlsx.writeBuffer()
  return Buffer.from(file)
}
