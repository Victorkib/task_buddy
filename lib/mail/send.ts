import { mailProductLabel } from '@/lib/branding'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { getAppUrl } from '@/lib/env'

function readEnv(name: string) {
  const value = process.env[name]
  if (value == null) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function getGmailUser() {
  return readEnv('GMAIL_USER')
}

export function getGmailAppPassword() {
  return readEnv('GMAIL_APP_PASSWORD')?.replace(/\s+/g, '')
}

export function getMailFromName() {
  return readEnv('GMAIL_FROM_NAME') ?? mailProductLabel()
}

export function isMailConfigured() {
  return Boolean(getGmailUser() && getGmailAppPassword())
}

export function getPublicAppUrl() {
  return (getAppUrl() ?? 'http://localhost:3000').replace(/\/$/, '')
}

export function getMailFromAddress() {
  const user = getGmailUser()
  if (!user) throw new Error('GMAIL_USER is not set.')
  const name = getMailFromName()
  return `"${name.replace(/"/g, '')}" <${user}>`
}

let transporter: Transporter | null = null

function getTransporter() {
  const user = getGmailUser()
  const pass = getGmailAppPassword()
  if (!user || !pass) {
    throw new Error('Gmail is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.')
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
  }
  return transporter
}

export async function sendMail(input: {
  to: string
  subject: string
  html: string
  text: string
}) {
  if (!isMailConfigured()) {
    throw new Error('Email delivery is not configured on this workspace yet.')
  }
  const info = await getTransporter().sendMail({
    from: getMailFromAddress(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  })
  return info
}
