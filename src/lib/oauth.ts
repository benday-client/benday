import { Agent } from '@atproto/api'
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser'

const HANDLE_RESOLVER = 'https://public.api.bsky.app'
const RESOLVE_HANDLE_URL = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle'
const OAUTH_SCOPE = 'atproto transition:generic'

export interface OAuthAccount {
  agent: Agent
  did: string
  handle: string | null
}

let clientPromise: Promise<BrowserOAuthClient | null> | null = null
let session: OAuthSession | null = null
let initPromise: Promise<OAuthAccount | null> | null = null
// Bumped whenever the portal session is cleared or replaced. An in-flight
// restore that started under an older epoch must not repopulate `session`.
let oauthEpoch = 0

function isLoopbackHost(host: string): boolean {
  // The oauth library rewrites localhost to 127.0.0.1. Do not start that
  // redirect implicitly: it would orphan password sessions and settings stored
  // under the localhost origin. localhost keeps the password path instead.
  return host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

export function canUseOAuth(): boolean {
  return typeof window !== 'undefined' && isLoopbackHost(window.location.hostname)
}

async function getClient(): Promise<BrowserOAuthClient | null> {
  if (!canUseOAuth()) return null

  if (clientPromise === null) {
    clientPromise = (async () => {
      // The browser OAuth client touches window and BroadcastChannel when its
      // module loads. Keep it lazy so the auth store stays importable in tests.
      const { BrowserOAuthClient, buildLoopbackClientId } = await import(
        '@atproto/oauth-client-browser'
      )
      const base = buildLoopbackClientId(window.location)
      const separator = base.includes('?') ? '&' : '?'
      const clientId = `${base}${separator}scope=${encodeURIComponent(OAUTH_SCOPE)}`
      return BrowserOAuthClient.load({
        clientId,
        handleResolver: HANDLE_RESOLVER,
      })
    })().catch((error: unknown) => {
      clientPromise = null
      throw error
    })
  }

  return clientPromise
}

async function restore(): Promise<OAuthAccount | null> {
  const epoch = oauthEpoch
  const client = await getClient()
  if (client === null) return null

  const result = await client.init()
  if (result === undefined) return null
  if (epoch !== oauthEpoch) {
    // A sign-out or a newer sign-in happened while init was resolving.
    await result.session.signOut().catch(() => null)
    return null
  }

  session = result.session
  const agent = new Agent(result.session)
  const profile = await agent.getProfile({ actor: result.session.sub }).catch(() => null)
  if (epoch !== oauthEpoch) {
    session = null
    await result.session.signOut().catch(() => null)
    return null
  }

  return {
    agent,
    did: result.session.sub,
    handle: profile?.data.handle ?? null,
  }
}

export function restoreOAuth(): Promise<OAuthAccount | null> {
  if (!canUseOAuth()) return Promise.resolve(null)

  if (initPromise === null) {
    const attempt: Promise<OAuthAccount | null> = restore().catch((error: unknown) => {
      if (initPromise === attempt) initPromise = null
      throw error
    })
    initPromise = attempt
  }

  return initPromise
}

async function resolveOAuthIdentifier(identifier: string): Promise<string> {
  const cleaned = identifier.trim().replace(/^@/, '')
  if (cleaned.startsWith('did:')) return cleaned

  const response = await fetch(`${RESOLVE_HANDLE_URL}?handle=${encodeURIComponent(cleaned)}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('could not resolve that handle for the portal')

  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) {
    throw new Error('could not resolve that handle for the portal')
  }
  const did = (body as Record<string, unknown>)['did']
  if (typeof did !== 'string' || !did.startsWith('did:')) {
    throw new Error('could not resolve that handle for the portal')
  }
  return did
}

export async function signInOAuth(identifier: string): Promise<void> {
  const client = await getClient()
  if (client === null) throw new Error('portal sign in needs a loopback address')

  const did = await resolveOAuthIdentifier(identifier)

  // A pending restore or a previous session must not answer for the account
  // the user is signing into now; re-init once the redirect lands.
  oauthEpoch += 1
  session = null
  initPromise = null

  await client.signIn(did)
}

export async function signOutOAuth(): Promise<void> {
  oauthEpoch += 1
  const current = session
  session = null
  initPromise = Promise.resolve(null)

  if (current !== null) {
    try {
      await current.signOut()
    } catch {
      // the local auth state is cleared even if revocation fails
    }
  }
}
