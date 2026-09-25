import { mailProductLabel, PRODUCT_NAME } from '@/lib/branding'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function layout(input: { title: string; preheader: string; bodyHtml: string }) {
  const brand = mailProductLabel()
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#e8eef5;font-family:Segoe UI,Helvetica Neue,Arial,sans-serif;color:#1a2740;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8eef5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #d5dee9;box-shadow:0 8px 28px rgba(15,39,72,.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0f2748 0%,#163a5f 100%);padding:22px 28px;">
              <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3a0;font-weight:700;">${escapeHtml(brand)}</div>
              <div style="margin-top:6px;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-.02em;">${escapeHtml(input.title)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e8eef5;font-size:12px;line-height:1.5;color:#6b7a90;">
              This message was sent by ${escapeHtml(brand)}. If you were not expecting it, you can ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function ctaButton(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:8px;padding:12px 20px;background:#1d6b4f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">${escapeHtml(label)}</a>`
}

export function inviteSetupEmail(input: {
  firstName: string
  inviterName: string
  companyName: string
  roleName: string
  departmentName?: string | null
  setupUrl: string
  expiresInDays: number
}) {
  const brand = mailProductLabel()
  const subject = `You're invited to ${input.companyName} on ${PRODUCT_NAME}`
  const deptLine = input.departmentName ? ` in ${input.departmentName}` : ''
  const text = [
    `Hi ${input.firstName},`,
    '',
    `${input.inviterName} has added you to ${input.companyName} on ${PRODUCT_NAME} as ${input.roleName}${deptLine}.`,
    '',
    `Set up your account here (link expires in ${input.expiresInDays} days):`,
    input.setupUrl,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n')

  const html = layout({
    title: 'You are invited',
    preheader: `${input.inviterName} invited you to ${input.companyName} on ${PRODUCT_NAME}.`,
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(input.firstName)},</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
        <strong>${escapeHtml(input.inviterName)}</strong> has added you to
        <strong>${escapeHtml(input.companyName)}</strong> on ${escapeHtml(PRODUCT_NAME)} as
        <strong>${escapeHtml(input.roleName)}</strong>${input.departmentName ? ` in <strong>${escapeHtml(input.departmentName)}</strong>` : ''}.
      </p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55;">
        Choose a password to activate your account. This link expires in ${input.expiresInDays} days.
      </p>
      ${ctaButton(input.setupUrl, 'Set up your account')}
      <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#6b7a90;word-break:break-all;">
        Or paste this link into your browser:<br />${escapeHtml(input.setupUrl)}
      </p>
    `,
  })

  return { subject, html, text }
}

export function tempPasswordEmail(input: {
  firstName: string
  inviterName: string
  companyName: string
  loginUrl: string
  temporaryPassword: string
}) {
  const subject = `Your temporary ${PRODUCT_NAME} password`
  const text = [
    `Hi ${input.firstName},`,
    '',
    `${input.inviterName} created your ${input.companyName} ${PRODUCT_NAME} account.`,
    '',
    `Sign in at: ${input.loginUrl}`,
    `Temporary password: ${input.temporaryPassword}`,
    '',
    'You will be asked to choose a new password on first sign-in.',
    'Do not share this password. Change it as soon as you can.',
  ].join('\n')

  const html = layout({
    title: 'Your temporary password',
    preheader: `${input.inviterName} created your ${PRODUCT_NAME} account.`,
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(input.firstName)},</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
        <strong>${escapeHtml(input.inviterName)}</strong> created your account on
        <strong>${escapeHtml(input.companyName)}</strong> ${escapeHtml(PRODUCT_NAME)}.
      </p>
      <div style="margin:0 0 18px;padding:14px 16px;border-radius:10px;background:#f3f7fb;border:1px solid #d5dee9;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7a90;">Temporary password</div>
        <div style="margin-top:6px;font-family:Consolas,Monaco,monospace;font-size:18px;font-weight:700;letter-spacing:.04em;color:#0f2748;">${escapeHtml(input.temporaryPassword)}</div>
      </div>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55;">
        Sign in, then choose a new password. You will be required to change this temporary password before using ${escapeHtml(PRODUCT_NAME)}.
      </p>
      ${ctaButton(input.loginUrl, `Sign in to ${PRODUCT_NAME}`)}
    `,
  })

  return { subject, html, text }
}

export function passwordResetEmail(input: {
  firstName: string
  resetUrl: string
  expiresInHours: number
}) {
  const subject = `Reset your ${PRODUCT_NAME} password`
  const text = [
    `Hi ${input.firstName},`,
    '',
    `Reset your ${PRODUCT_NAME} password using this link (expires in ${input.expiresInHours} hours):`,
    input.resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n')

  const html = layout({
    title: 'Reset your password',
    preheader: `Use this link to choose a new ${PRODUCT_NAME} password.`,
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(input.firstName)},</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55;">
        We received a request to reset your ${escapeHtml(PRODUCT_NAME)} password. This link expires in ${input.expiresInHours} hours.
      </p>
      ${ctaButton(input.resetUrl, 'Choose a new password')}
      <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#6b7a90;word-break:break-all;">
        Or paste this link into your browser:<br />${escapeHtml(input.resetUrl)}
      </p>
    `,
  })

  return { subject, html, text }
}

export function taskReportEmail(input: {
  recipientFirstName: string
  authorName: string
  taskTitle: string
  reportTitle: string
  reportBody: string
  taskUrl: string
  companyName: string
}) {
  const subject = `Task report: ${input.reportTitle}`
  const preview = input.reportBody.replace(/\s+/g, ' ').trim().slice(0, 140)
  const text = [
    `Hi ${input.recipientFirstName},`,
    '',
    `${input.authorName} shared a progress report on “${input.taskTitle}” in ${PRODUCT_NAME}.`,
    '',
    input.reportTitle,
    '',
    input.reportBody,
    '',
    `Open the task: ${input.taskUrl}`,
  ].join('\n')

  const bodyHtml = input.reportBody
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(paragraph.trim())}</p>`)
    .join('')

  const html = layout({
    title: input.reportTitle,
    preheader: preview || `${input.authorName} shared a report on ${input.taskTitle}.`,
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(input.recipientFirstName)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
        <strong>${escapeHtml(input.authorName)}</strong> filed a progress report on
        <strong>${escapeHtml(input.taskTitle)}</strong> for ${escapeHtml(input.companyName)}.
      </p>
      <div style="margin:0 0 10px;padding:10px 14px;border-radius:999px;background:#eef6f1;border:1px solid #c5e6d4;display:inline-block;font-size:12px;font-weight:700;color:#1d6b4f;">
        Task · ${escapeHtml(input.taskTitle)}
      </div>
      <div style="margin:14px 0 18px;padding:18px 20px;border-radius:14px;background:linear-gradient(180deg,#f8fbfd 0%,#f3f7fb 100%);border:1px solid #d5dee9;box-shadow:inset 0 1px 0 #ffffff;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7a90;margin-bottom:6px;">${escapeHtml(input.reportTitle)}</div>
        <div style="font-size:13px;color:#6b7a90;margin-bottom:12px;">From ${escapeHtml(input.authorName)} · ${escapeHtml(PRODUCT_NAME)}</div>
        ${bodyHtml}
      </div>
      ${ctaButton(input.taskUrl, `Open task in ${PRODUCT_NAME}`)}
    `,
  })

  return { subject, html, text }
}
