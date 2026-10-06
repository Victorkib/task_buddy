export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
] as const

export const AVATAR_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export type UploadKind = 'task_attachment' | 'deliverable_evidence' | 'user_avatar' | 'office_evidence'

const MIME_BY_EXTENSION: Record<string, (typeof ALLOWED_UPLOAD_MIME_TYPES)[number]> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
}

export function isAllowedUploadMime(mimeType: string) {
  return (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType)
}

export function resolveUploadMime(mimeType: string, fileName: string) {
  if (isAllowedUploadMime(mimeType)) return mimeType
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (!extension) return null
  return MIME_BY_EXTENSION[extension] ?? null
}

export function getUploadRootFolder() {
  const folder = process.env.CLOUDINARY_ROOT_FOLDER?.trim()
  return folder && folder.length > 0 ? folder.replace(/^\/+|\/+$/g, '') : 'gcs-workhub'
}

export function getUploadFolder(kind: UploadKind, entityId: string) {
  const root = getUploadRootFolder()
  if (kind === 'deliverable_evidence') return `${root}/deliverables/${entityId}`
  if (kind === 'user_avatar') return `${root}/avatars/${entityId}`
  if (kind === 'office_evidence') return `${root}/office/${entityId}`
  return `${root}/tasks/${entityId}`
}

export function getUploadLimits(kind: UploadKind) {
  if (kind === 'user_avatar') {
    return {
      maxBytes: MAX_AVATAR_BYTES,
      mimeTypes: AVATAR_UPLOAD_MIME_TYPES as readonly string[],
      accept: 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif',
      hint: 'JPG, PNG, WebP, or GIF · up to 5 MB',
    }
  }
  return {
    maxBytes: MAX_UPLOAD_BYTES,
    mimeTypes: ALLOWED_UPLOAD_MIME_TYPES as readonly string[],
    accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv',
    hint: 'PDF, Office, images, CSV, or text · up to 25 MB',
  }
}
