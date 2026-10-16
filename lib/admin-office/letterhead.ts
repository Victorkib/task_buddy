/** Public stationery file taken from the Globecon letterhead Word/PDF masters. */
export const LETTERHEAD_FILE = 'globecon-letterhead.jpg'

/** Browser-safe URL for the letterhead. Prefer `embeddedLetterheadSrc` on the server for downloads. */
export function letterheadSrc(assetBase?: string) {
  const base = (assetBase ?? '').replace(/\/$/, '')
  return `${base}/${LETTERHEAD_FILE}`
}
