import { Agent } from '@atproto/api'
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser'
import { resolveHandleDid } from './identity'
import { OAUTH_REDIRECT_PATH, OAUTH_SCOPE } from './oauthMetadata'
import { boundedFetch } from './requestTimeout'

const HANDLE_RESOLVER = 'https://public.api.bsky.app'

export interface OAuthAccount {
  agent: Agent
  did: string
  handle: string | null
}

// A restored session keeps its client's storage alive until sign-out. Redirect
// attempts own separate, short-lived clients: the SDK cannot reopen a database
// connection after a native close/versionchange event.
let session: { value: OAuthSession; client: BrowserOAuthClient } | null = null
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
  return typeof window !== 'undefined' && oauthClientId(window.location) !== null
}

export function oauthClientId(
  location: LoopbackLocation & { origin: string },
  hostedClientId: string | null = import.meta.env.BENDAY_OAUTH_CLIENT_ID ?? null,
): string | null {
  if (isLoopbackHost(location.hostname)) return loopbackClientId(location)
  return hostedClientId !== null && new URL(hostedClientId).origin === location.origin
    ? hostedClientId
    : null
}

export interface LoopbackLocation {
  hostname: string
  port: string
  pathname: string
}

/**
 * A loopback client id must carry no path: `http://localhost/feed?...` is
 * rejected with "Value must not contain a path component". benday serves every
 * route from the origin, so the client id drops the path and the redirect uses
 * the one canonical route.
 */
export function loopbackClientId(location: LoopbackLocation): string {
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname
  const port = location.port.length > 0 ? `:${location.port}` : ''
  const redirectUri = `http://${host}${port}${OAUTH_REDIRECT_PATH}`
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPE)}`
}

async function createClient(): Promise<BrowserOAuthClient | null> {
  const clientId = typeof window === 'undefined' ? null : oauthClientId(window.location)
  if (clientId === null) return null

  // The browser OAuth client touches window and BroadcastChannel when its
  // module loads. Keep it lazy so the auth store stays importable in tests.
  const { BrowserOAuthClient } = await import('@atproto/oauth-client-browser')
  return BrowserOAuthClient.load({
    clientId,
    handleResolver: HANDLE_RESOLVER,
    fetch: boundedFetch,
  })
}

async function restore(): Promise<OAuthAccount | null> {
  const epoch = oauthEpoch
  const client = await createClient()
  if (client === null) return null

  let retained = false
  try {
    const result = await client.init()
    if (result === undefined) return null
    if (epoch !== oauthEpoch) {
      // A sign-out or a newer sign-in happened while init was resolving.
      await result.session.signOut().catch(() => null)
      return null
    }

    const agent = new Agent(result.session)
    const profile = await agent.getProfile({ actor: result.session.sub }).catch(() => null)
    if (epoch !== oauthEpoch) {
      await result.session.signOut().catch(() => null)
      return null
    }

    session = { value: result.session, client }
    retained = true
    return {
      agent,
      did: result.session.sub,
      handle: profile?.data.handle ?? null,
    }
  } finally {
    if (!retained) await client.dispose()
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

export async function signInOAuth(identifier: string): Promise<void> {
  const client = await createClient()
  if (client === null) throw new Error('portal sign in is not configured for this origin')

  try {
    const did = await resolveHandleDid(identifier)

    // A pending restore must not answer for the account being requested.
    // The committed session keeps its own client until it is signed out: a
    // failed account switch must not close the current agent's storage.
    oauthEpoch += 1
    if (session === null) initPromise = null

    await client.signIn(did)
  } finally {
    // Disposing closes connections/listeners, not persisted callback state.
    await client.dispose()
  }
}

export async function signOutOAuth(): Promise<void> {
  oauthEpoch += 1
  const current = session
  session = null
  initPromise = Promise.resolve(null)

  // The SDK deletes its stored session in a finally block after the revocation
  // settles, so the local auth is gone either way. The revocation error is
  // handed back to the caller instead of being swallowed: the reader is signed
  // out locally, and a failed revoke must still be visible.
  if (current !== null) {
    try {
      await current.value.signOut()
    } finally {
      await current.client.dispose()
    }
  }
}
