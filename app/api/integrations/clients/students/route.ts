import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { ingestStudentsRegistration, parseStudentsIngestPayload } from '@/lib/clients/ingest'
import { getCompany } from '@/lib/db/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readEnv(name: string) {
  const value = process.env[name]
  if (value == null) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function secretMatches(request: Request) {
  const expected = readEnv('CLIENTS_INGEST_SECRET')
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
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
  }

  const company = await getCompany()
  if (!company) {
    return NextResponse.json({ error: 'Workspace is not set up yet.' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  // Allow a single registration object or { registrations: [...] } batch.
  const items: unknown[] = Array.isArray((body as { registrations?: unknown })?.registrations)
    ? ((body as { registrations: unknown[] }).registrations)
    : [body]

  if (items.length === 0) {
    return NextResponse.json({ error: 'No registrations provided.' }, { status: 400 })
  }
  if (items.length > 25) {
    return NextResponse.json({ error: 'At most 25 registrations per request.' }, { status: 400 })
  }

  const results: Array<Record<string, unknown>> = []
  for (const item of items) {
    const parsed = parseStudentsIngestPayload(item)
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error, failedAt: item }, { status: 400 })
    }
    try {
      const result = await ingestStudentsRegistration(company.id, parsed.payload)
      results.push(result)
    } catch (error) {
      console.error('Students ingest failed', error)
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Ingest failed.',
          partial: results,
        },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({
    ok: true,
    count: results.length,
    results,
  })
}

export async function GET() {
  return NextResponse.json({
    service: 'clients-students-ingest',
    auth: 'Authorization: Bearer <CLIENTS_INGEST_SECRET>',
    method: 'POST',
    upsert: 'Re-posting the same externalId updates existing student/guardian records.',
  })
}
