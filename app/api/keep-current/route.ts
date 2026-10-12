import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { canManageOrg } from '@/lib/auth/permissions'
import { getCurrentUser } from '@/lib/db/queries'
import { keepCurrentMailUnavailableMessage } from '@/lib/mail/keep-current'
import { sendKeepCurrentBatch } from '@/lib/mail/keep-current-send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readEnv(name: string) {
  const value = process.env[name]
  if (value == null) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function secretMatches(request: Request) {
  const expected = readEnv('KEEP_CURRENT_SECRET') ?? readEnv('CRON_SECRET')
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) return false
  const left = Buffer.from(token)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!secretMatches(request)) {
    const currentUser = await getCurrentUser()
    if (!currentUser || !canManageOrg(currentUser)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
    }
  }

  let resend = false
  try {
    const body = (await request.json()) as { resend?: unknown }
    resend = body?.resend === true
  } catch {
    resend = false
  }

  const result = await sendKeepCurrentBatch({ resend })
  if (result.error === keepCurrentMailUnavailableMessage()) {
    return NextResponse.json(result, { status: 503 })
  }
  if (result.error && result.sent === 0) {
    return NextResponse.json(result, { status: 500 })
  }
  return NextResponse.json(result)
}
