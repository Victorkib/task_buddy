export type MediaKind = 'image' | 'pdf' | 'video' | 'link' | 'file'

export type MediaItem = {
  id: string
  title: string
  url: string
  kind: MediaKind
  mimeType?: string | null
  sourceLabel?: string
  taskTitle?: string
  taskId?: string
}

function extensionOf(url: string, name?: string | null) {
  const fromName = name?.split('.').pop()?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName
  try {
    const path = new URL(url).pathname
    return path.split('.').pop()?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}

export function classifyMedia(input: {
  url: string
  mimeType?: string | null
  label?: string | null
  originalName?: string | null
}): MediaKind {
  const mime = (input.mimeType ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf' || mime.includes('pdf')) return 'pdf'
  if (mime.startsWith('video/')) return 'video'

  const ext = extensionOf(input.url, input.originalName ?? input.label)
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'

  // External https links without a clear document extension open as embeddable links.
  try {
    const host = new URL(input.url).hostname
    const looksLikeFile = Boolean(ext && ext.length <= 5 && !['com', 'org', 'net', 'io', 'html', 'htm', 'php'].includes(ext))
    if (!looksLikeFile && host) return 'link'
  } catch {
    /* ignore */
  }
  return 'file'
}

export function canInlinePreview(kind: MediaKind) {
  return kind === 'image' || kind === 'pdf' || kind === 'link' || kind === 'video'
}
