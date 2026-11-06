// WHATWG URL keeps the brackets in `hostname` and normalizes every expanded
// spelling of the IPv6 loopback address to `[::1]`.
const HTTP_LOOPBACK: Record<string, true> = {
  localhost: true,
  '127.0.0.1': true,
  '[::1]': true,
}

export function normalizeAppViewHost(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null
  if (url.protocol === 'http:' && HTTP_LOOPBACK[url.hostname] !== true) return null

  return url.origin
}
