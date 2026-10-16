import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LETTERHEAD_FILE } from '@/lib/admin-office/letterhead'

let cachedDataUri: string | null = null

/** Embeds the letterhead so downloads, email attachments, and print windows keep branding offline. Server-only. */
export function embeddedLetterheadSrc() {
  if (cachedDataUri) return cachedDataUri
  const absolute = join(process.cwd(), 'public', LETTERHEAD_FILE)
  const bytes = readFileSync(absolute)
  cachedDataUri = `data:image/jpeg;base64,${bytes.toString('base64')}`
  return cachedDataUri
}
