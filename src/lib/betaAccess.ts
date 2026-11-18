import { isRecord } from './records'

// The beta list ships with the site. It is read once per page load and it is a
// client-side check: it keeps ordinary visitors out and does not stop anyone
// who reads the bundle. Every session is still the visitor's own pds.

export interface BetaInvites {
  sha256: readonly string[]
}

export type BetaAccess = 'allowed' | 'refused' | 'unreadable'

const INVITES_PATH = '/beta/invites.json'

let loaded: Promise<BetaInvites | null> | null = null

/** SHA-256 of the exact UTF-8 DID, shared with the invitation minter. */
export async function inviteDigest(did: string): Promise<string> {
  const bytes = new TextEncoder().encode(did)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Validates an invitation body. Malformed data fails closed to `null`. */
export function parseBetaInvites(body: unknown): BetaInvites | null {
  if (
    !isRecord(body) ||
    !Array.isArray(body['sha256']) ||
    !body['sha256'].every(
      (entry: unknown) => typeof entry === 'string' && /^[0-9a-f]{64}$/.test(entry),
    )
  ) {
    return null
  }
  return { sha256: body['sha256'] }
}

/** Resolves to `null` when the list cannot be read at all, which fails closed. */
export function loadBetaInvites(): Promise<BetaInvites | null> {
  if (loaded === null) {
    // absolute, because a bare path is not a valid Request outside a browser
    const url = new URL(INVITES_PATH, window.location.href)
    loaded = fetch(url, { cache: 'no-store' })
      .then(async (response) => (response.ok ? parseBetaInvites(await response.json()) : null))
      .catch(() => null)
  }
  return loaded
}

export async function betaAccess(
  invites: BetaInvites | null,
  account: { did: string },
): Promise<BetaAccess> {
  if (invites === null) return 'unreadable'
  try {
    return invites.sha256.includes(await inviteDigest(account.did)) ? 'allowed' : 'refused'
  } catch {
    return 'unreadable'
  }
}

/** Test seam: the list is cached for the life of the page, never across loads. */
export function resetBetaInvites(): void {
  loaded = null
}
