import { isRecord } from './records'

const RESOLVE_HANDLE_URL = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle'
const RESOLVE_TIMEOUT_MS = 8000

/**
 * Turns a handle (or did) into a did through the public resolver. Both sign-in
 * paths need exactly this step: the password path uses it to discover a PDS and
 * the portal path uses it as the OAuth login hint. A did passes straight
 * through, and a failed or malformed answer is an error rather than an
 * unresolved identity.
 */
export async function resolveHandleDid(identifier: string): Promise<string> {
  const cleaned = identifier.trim().replace(/^@/, '')
  if (cleaned.startsWith('did:')) return cleaned

  const response = await fetch(`${RESOLVE_HANDLE_URL}?handle=${encodeURIComponent(cleaned)}`, {
    signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('could not resolve that handle')

  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error('could not resolve that handle')

  const did = body['did']
  if (typeof did !== 'string' || !did.startsWith('did:')) {
    throw new Error('could not resolve that handle')
  }
  return did
}
