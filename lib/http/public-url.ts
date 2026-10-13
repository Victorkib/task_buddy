const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

export function isLocalAppUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return LOCAL_HOSTS.has(hostname)
  } catch {
    return false
  }
}

function cleanOrigin(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

/** Host from a browser request. Rejects values that are not a single host[:port]. */
export function originFromForwarded(hostHeader: string | null, protoHeader: string | null) {
  const host = hostHeader?.split(',')[0]?.trim() ?? ''
  if (!host || !/^[\w.:[\]-]+$/.test(host)) return null
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname) return null
  const forwarded = protoHeader?.split(',')[0]?.trim().toLowerCase()
  const scheme = forwarded === 'http' || forwarded === 'https' ? forwarded : LOCAL_HOSTS.has(hostname) ? 'http' : 'https'
  return cleanOrigin(`${scheme}://${host}`)
}

/**
 * Email links should open the site the person is actually using.
 * A configured public URL wins. A localhost configuration falls through to the request.
 */
export function choosePublicAppUrl(input: { requestOrigin: string | null; configured: string | null }) {
  const configured = cleanOrigin(input.configured)
  const requestOrigin = cleanOrigin(input.requestOrigin)
  if (configured && !isLocalAppUrl(configured)) return configured
  if (requestOrigin) return requestOrigin
  return configured ?? 'http://localhost:3000'
}
