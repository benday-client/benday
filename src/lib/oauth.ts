import { Agent } from '@atproto/api'
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser'
import { resolveHandleDid } from './identity'

const HANDLE_RESOLVER = 'https://public.api.bsky.app'
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

export interface LoopbackLocation {
  hostname: string
  port: string
  pathname: string
}

// the client id is baked into every token, so it must not follow the route:
// signing in on /feed and then opening /notifications would present a token
// issued to a different client and the pds answers "token was not issued to
// this client". one canonical callback keeps the id stable across routes.
export const OAUTH_REDIRECT_PATH = '/feed'

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

async function getClient(): Promise<BrowserOAuthClient | null> {
  if (!canUseOAuth()) return null

  if (clientPromise === null) {
    clientPromise = (async () => {
      // The browser OAuth client touches window and BroadcastChannel when its
      // module loads. Keep it lazy so the auth store stays importable in tests.
      const { BrowserOAuthClient } = await import('@atproto/oauth-client-browser')
      const clientId = loopbackClientId(window.location)
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

export async function signInOAuth(identifier: string): Promise<void> {
  const client = await getClient()
  if (client === null) throw new Error('portal sign in needs a loopback address')

  const did = await resolveHandleDid(identifier)

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
