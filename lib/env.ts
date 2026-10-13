import { mailProductLabel } from '@/lib/branding'
import { isLocalAppUrl } from '@/lib/http/public-url'

function readEnv(name: string) {
  const value = process.env[name]
  if (value == null) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function requireEnv(name: string) {
  const value = readEnv(name)
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env.local and to the host environment.`)
  }
  return value
}

export function getAuthSecret() {
  const secret = readEnv('BETTER_AUTH_SECRET') ?? readEnv('AUTH_SECRET')
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET or AUTH_SECRET is required in production.')
  }
  return 'dev-only-auth-secret-change-me'
}

export function getAppUrl() {
  const values = [
    readEnv('BETTER_AUTH_URL'),
    readEnv('AUTH_URL'),
    readEnv('NEXT_PUBLIC_APP_URL'),
    readEnv('URL'),
    readEnv('DEPLOY_PRIME_URL'),
    readEnv('DEPLOY_URL'),
  ].filter((value): value is string => Boolean(value))
  return values.find((value) => !isLocalAppUrl(value)) ?? values[0]
}

export function getMetadataBase() {
  const raw = getAppUrl()
  if (!raw) return undefined
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

export function getInviteStarterPassword() {
  const password = readEnv('INVITE_STARTER_PASSWORD') ?? readEnv('SEED_STAFF_PASSWORD')
  if (password) return password
  if (process.env.NODE_ENV === 'production') {
    throw new Error('INVITE_STARTER_PASSWORD is required in production.')
  }
  return 'Workhub123!'
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
