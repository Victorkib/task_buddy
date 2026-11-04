export function downloadBytes(filename: string, bytes: Uint8Array, type: string) {
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before the address is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadHtml(filename: string, html: string) {
  downloadBytes(filename, new TextEncoder().encode(html), 'text/html')
}

export function printHtml(html: string) {
  const win = window.open('', '_blank')
  if (!win) return false
  writeAndPrint(win, html)
  return true
}

/**
 * Opens the print window during the click itself, so pop-up blockers allow it,
 * and the invoice is written in once it has loaded.
 */
export function openPrintWindow(kind: 'invoice' | 'receipt' = 'invoice') {
  const label = kind === 'receipt' ? 'receipt' : 'invoice'
  const win = window.open('', '_blank')
  if (win) {
    win.document.write(`<!doctype html><title>Preparing ${label}…</title><p style="font:14px system-ui;padding:24px">Preparing the ${label}…</p>`)
  }
  return win
}

export function writeAndPrint(win: Window, html: string) {
  const printable = html.includes('<base ') ? html : html.replace('<head>', `<head><base href="${window.location.origin}/">`)
  win.document.open()
  win.document.write(printable)
  win.document.close()
  win.focus()
  win.print()
}

export function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}
