import { LETTER_TYPE_LABELS } from '@/lib/admin-office/policy'
import type { OfficeLetterType } from '@/lib/admin-office/types'

/** Stationery block taken from Globecon proposal letters. */
export const GLOBECON_STATIONERY = {
  name: 'Globecon Convergence Solutions Limited',
  box: 'P.o Box 1092 – 00618, Nairobi',
  office: 'Juja Professional Centre, Juja',
  email: 'md@globeconcs.com',
  phone: '+254 725 275 610',
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function globeconDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const day = Number(match[3])
  const month = MONTHS[Number(match[2]) - 1] ?? ''
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  return `${day}${suffix} ${month} ${match[1]}`
}

function letterheadSrc(assetBase?: string) {
  const base = (assetBase ?? '').replace(/\/$/, '')
  return `${base}/globecon-letterhead.png`
}

function letterShell(title: string, inner: string, assetBase?: string) {
  const src = letterheadSrc(assetBase)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #e8eef6; }
    .sheet {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      box-sizing: border-box;
      padding: 38mm 18mm 32mm;
      background: #fff url('${src}') no-repeat top center;
      background-size: 210mm 297mm;
      color: #1c2430;
      font-family: Calibri, "Segoe UI", Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.45;
    }
    .who { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
    .who strong { display: block; font-size: 13pt; color: #1a2f6b; }
    .who p { margin: 2px 0; font-size: 11pt; color: #243044; }
    .date { text-align: right; white-space: nowrap; font-size: 11pt; }
    .rule { height: 2px; margin: 14px 0 18px; background: linear-gradient(90deg, #2a3f9f 0%, #7a3e9a 100%); }
    h1 { margin: 8px 0 14px; font-size: 16pt; line-height: 1.25; color: #172033; }
    .to { margin: 0 0 8px; }
    p { margin: 0 0 12px; }
    h2 { margin: 16px 0 8px; font-size: 13pt; font-weight: 700; color: #1a2f6b; }
    h2 span { color: #7a3e9a; }
    ul { margin: 0 0 12px; padding-left: 18px; }
    li { margin: 0 0 4px; }
    .sign { margin-top: 28px; }
    @media print {
      html, body { background: #fff; }
      .sheet { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <article class="sheet">
    ${inner}
  </article>
</body>
</html>`
}

function legalName(companyName: string) {
  const trimmed = companyName.trim()
  if (!trimmed || /globecon/i.test(trimmed)) return GLOBECON_STATIONERY.name
  return trimmed
}

function addressBlock(dateLabel: string, companyName = GLOBECON_STATIONERY.name) {
  const s = GLOBECON_STATIONERY
  return `<div class="who">
    <div>
      <strong>${escapeHtml(legalName(companyName))}</strong>
      <p>${escapeHtml(s.box)}</p>
      <p>${escapeHtml(s.office)}</p>
      <p>Email: ${escapeHtml(s.email)}</p>
      <p>Phone: ${escapeHtml(s.phone)}</p>
    </div>
    <div class="date">Date: ${escapeHtml(dateLabel)}</div>
  </div>
  <div class="rule"></div>`
}

function section(index: number, title: string, body: string) {
  return `<h2><span>${String(index).padStart(2, '0')}</span> | ${escapeHtml(title)}</h2>${body}`
}

export function buildStaffLetter(input: {
  companyName: string
  letterType: OfficeLetterType
  documentNumber: string | null
  employeeName: string
  jobTitle: string
  departmentName: string | null
  startDate: string | null
  purpose: string | null
  today: string
  assetBase?: string
}) {
  const kind = LETTER_TYPE_LABELS[input.letterType]
  const number = input.documentNumber ?? 'To be assigned on approval'
  const dated = globeconDate(input.today)
  const since = input.startDate ? ` since ${globeconDate(input.startDate)}` : ''
  const department = input.departmentName ? escapeHtml(input.departmentName) : 'their department'
  const name = escapeHtml(input.employeeName)
  const role = escapeHtml(input.jobTitle)
  const company = escapeHtml(legalName(input.companyName))
  const opening =
    input.letterType === 'internship'
      ? `We are pleased to confirm that <strong>${name}</strong> is engaged by ${company} as ${role}${since}.`
      : `We are pleased to confirm that <strong>${name}</strong> is employed by ${company} as ${role}${since}.`
  const purpose = input.purpose?.trim()
    ? `<p>${escapeHtml(input.purpose.trim())}</p>`
    : `<p>This letter is issued at the employee’s request and may be presented to the party named above.</p>`
  const bank =
    input.letterType === 'bank'
      ? `<p>Kindly accept this letter for the employee’s banking arrangements.</p>`
      : ''
  const inner = `${addressBlock(dated, input.companyName)}
    <p class="to">To,<br />Whom it may concern,</p>
    <h1>${escapeHtml(kind)}</h1>
    <p>${opening}</p>
    ${section(1, 'Purpose', `<p>Reference ${escapeHtml(number)}.</p>${purpose}${bank}`)}
    ${section(
      2,
      'Particulars',
      `<ul>
        <li>Name: ${name}</li>
        <li>Role: ${role}</li>
        <li>Department: ${department}</li>
        ${input.startDate ? `<li>Start date: ${escapeHtml(globeconDate(input.startDate))}</li>` : ''}
      </ul>`,
    )}
    <p class="sign">Yours faithfully,</p>
    <p><strong>Admin Office</strong><br />${escapeHtml(legalName(input.companyName))}</p>`
  return letterShell(`${kind} — ${input.employeeName}`, inner, input.assetBase)
}

export function buildOfferLetter(input: {
  companyName: string
  documentNumber: string | null
  candidateName: string
  jobTitle: string
  departmentName: string | null
  salaryText: string | null
  startDate: string | null
  probationMonths: number
  notes: string | null
  today: string
  assetBase?: string
}) {
  const number = input.documentNumber ?? 'Draft'
  const dated = globeconDate(input.today)
  const name = escapeHtml(input.candidateName)
  const role = escapeHtml(input.jobTitle)
  const department = input.departmentName ? ` in ${escapeHtml(input.departmentName)}` : ''
  const inner = `${addressBlock(dated, input.companyName)}
    <p class="to">To,<br />${name},</p>
    <h1>Offer of employment — ${role}</h1>
    <p>We are pleased to offer you the position of <strong>${role}</strong>${department} at ${escapeHtml(legalName(input.companyName))}.</p>
    ${section(1, 'The role', `<p>You will join as ${role}${department}. Reference ${escapeHtml(number)}.</p>`)}
    ${section(
      2,
      'Start and probation',
      `<p>${input.startDate ? `The proposed start date is <strong>${escapeHtml(globeconDate(input.startDate))}</strong>. ` : ''}The appointment includes a probation period of ${input.probationMonths} month${input.probationMonths === 1 ? '' : 's'}, and is subject to company policy.</p>`,
    )}
    ${section(
      3,
      'Compensation',
      input.salaryText?.trim()
        ? `<p>${escapeHtml(input.salaryText.trim())}.</p>`
        : `<p>Compensation will be confirmed in writing before you start.</p>`,
    )}
    ${input.notes?.trim() ? section(4, 'Further terms', `<p>${escapeHtml(input.notes.trim())}</p>`) : ''}
    <p>Please confirm in writing if you accept this offer.</p>
    <p class="sign">Yours faithfully,</p>
    <p><strong>Admin Office</strong><br />${escapeHtml(legalName(input.companyName))}</p>`
  return letterShell(`Offer — ${input.candidateName}`, inner, input.assetBase)
}

export const DOCUMENT_STARTERS: Array<{ id: string; title: string; category: string; body: string }> = [
  {
    id: 'conduct',
    title: 'Code of conduct',
    category: 'policy',
    body: 'People at Globecon treat clients, colleagues, and visitors with respect. Company information stays inside the company unless the managing director has agreed it can be shared. Conflicts of interest are declared to the admin office before a decision is made.',
  },
  {
    id: 'it',
    title: 'IT and account use',
    category: 'policy',
    body: 'WorkHub accounts are personal. Passwords are not shared. Equipment issued by the company is returned on the last day. Lost devices are reported to the admin office the same day.',
  },
  {
    id: 'data',
    title: 'Data protection',
    category: 'policy',
    body: 'Client and staff records are used only for Globecon work. Personal data is not copied onto private drives. A request to see or correct personal data goes to the admin office.',
  },
]
