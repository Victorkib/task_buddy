import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { canProgressTask } from '@/lib/auth/permissions'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/db/queries'
import { loadTaskAccess } from '@/lib/db/task-access'
import { deliverables } from '@/lib/db/schema'
import { createSignedUpload, isCloudinaryConfigured } from '@/lib/uploads/cloudinary'
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  AVATAR_UPLOAD_MIME_TYPES,
  getUploadLimits,
  resolveUploadMime,
  type UploadKind,
} from '@/lib/uploads/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUploadKind(value: unknown): value is UploadKind {
  return value === 'task_attachment' || value === 'deliverable_evidence' || value === 'user_avatar' || value === 'office_evidence'
}

export async function POST(request: Request) {
  if (!isCloudinaryConfigured()) {
    return NextResponse.json({ error: 'File uploads are not configured yet.' }, { status: 503 })
  }

  const currentUser = await getCurrentUser()
  if (!currentUser) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: {
    kind?: unknown
    entityId?: unknown
    fileName?: unknown
    mimeType?: unknown
    bytes?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 })
  }

  const kind = body.kind
  const entityId = typeof body.entityId === 'string' ? body.entityId : ''
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
  const bytes = typeof body.bytes === 'number' ? body.bytes : Number(body.bytes)

  if (!isUploadKind(kind) || !UUID.test(entityId) || !fileName) {
    return NextResponse.json({ error: 'Choose a valid file and try again.' }, { status: 400 })
  }
  const limits = getUploadLimits(kind)
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return NextResponse.json({ error: 'That file could not be read.' }, { status: 400 })
  }
  if (bytes > limits.maxBytes) {
    return NextResponse.json(
      { error: kind === 'user_avatar' ? 'Photos must be 5 MB or smaller.' : 'Files must be 25 MB or smaller.' },
      { status: 400 },
    )
  }
  const resolvedMime = resolveUploadMime(mimeType, fileName)
  if (!resolvedMime || !limits.mimeTypes.includes(resolvedMime)) {
    return NextResponse.json(
      { error: kind === 'user_avatar' ? 'Use a JPG, PNG, WebP, or GIF photo.' : 'That file type is not allowed.' },
      { status: 400 },
    )
  }

  if (kind === 'user_avatar' || kind === 'office_evidence') {
    if (entityId !== currentUser.id) {
      return NextResponse.json({ error: 'You can only upload files for yourself.' }, { status: 403 })
    }
  } else if (kind === 'task_attachment') {
    const loaded = await loadTaskAccess(entityId)
    if (!loaded || !canProgressTask(currentUser, loaded.access)) {
      return NextResponse.json({ error: 'You are not allowed to attach files to this task.' }, { status: 403 })
    }
  } else {
    const [deliverable] = await getDb().select().from(deliverables).where(eq(deliverables.id, entityId)).limit(1)
    if (!deliverable) {
      return NextResponse.json({ error: 'Deliverable not found.' }, { status: 404 })
    }
    const loaded = await loadTaskAccess(deliverable.taskId)
    if (!loaded || !canProgressTask(currentUser, loaded.access)) {
      return NextResponse.json({ error: 'You are not allowed to attach evidence to this deliverable.' }, { status: 403 })
    }
  }

  const signed = createSignedUpload({
    kind,
    entityId,
    publicId: randomUUID(),
  })

  return NextResponse.json({
    ...signed,
    allowedMimeTypes: kind === 'user_avatar' ? AVATAR_UPLOAD_MIME_TYPES : ALLOWED_UPLOAD_MIME_TYPES,
    maxBytes: limits.maxBytes,
  })
}
