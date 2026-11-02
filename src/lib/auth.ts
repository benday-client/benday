import type { Agent, AtpSessionData, AtpSessionEvent } from '@atproto/api'
import { AtpAgent } from '@atproto/api'
import { create } from 'zustand'
import { normalizeAppViewHost } from './appviews'
import { errorInfo } from './errors'
import { applyConfiguredLabelers } from './labelers'
import { restoreOAuth, signInOAuth, signOutOAuth } from './oauth'
import { isRecord } from './records'

export const AUTH_STORAGE_KEY = 'benday:session'

const RESOLVE_HANDLE_URL = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle'
const FALLBACK_PDS = 'https://bsky.social'
const REQUEST_TIMEOUT = 8000

export interface AuthAccount {
  did: string
  handle: string
}

interface StoredAuth {
  service: string
  session: AtpSessionData
}

interface AuthState {
  status: 'restoring' | 'anonymous' | 'authenticated'
  account: AuthAccount | null
  pending: boolean
  error: string | null
  restore: () => Promise<void>
  signIn: (identifier: string, password: string, pds?: string) => Promise<boolean>
  signInWithPortal: (identifier: string) => Promise<boolean>
  signOut: () => Promise<void>
  clearError: () => void
}

let activeAgent: AtpAgent | Agent | null = null
let restorePromise: Promise<void> | null = null
// Monotonic counter bumped by every action that changes who is signed in. An
// action captures it before awaiting and refuses to commit if it moved, so a
// slow restore can never overwrite a fresh sign-in and a stale agent can never
// resurrect a session that was signed out.
let authEpoch = 0
// The epoch of the auth operation currently in flight, if any. A committed
// agent that expires while a newer operation is pending must clear its own
// local session without advancing the epoch that operation owns.
let pendingAuthEpoch: number | null = null

function isSessionData(value: unknown): value is AtpSessionData {
  if (!isRecord(value)) return false
  return (
    typeof value['accessJwt'] === 'string' &&
    typeof value['refreshJwt'] === 'string' &&
    typeof value['handle'] === 'string' &&
    typeof value['did'] === 'string' &&
    value['did'].startsWith('did:') &&
    typeof value['active'] === 'boolean'
  )
}

function isStoredAuth(value: unknown): value is StoredAuth {
  if (!isRecord(value)) return false
  const service = value['service']
  return (
    typeof service === 'string' &&
    normalizeAppViewHost(service) === service &&
    isSessionData(value['session'])
  )
}

function readStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isStoredAuth(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStoredAuth(service: string, session: AtpSessionData): void {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ service, session }))
  } catch {
    // a full or unavailable storage should not break a live session
  }
}

function clearStoredAuth(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // ignore storage failures
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
  if (!response.ok) throw new Error(`request failed (${response.status})`)
  return response.json()
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

// did:web resolution per the method spec: the host component may carry an
// encoded port, and a bare host reads /.well-known/did.json while a
// colon-delimited path reads the document from that path.
function didWebDocumentUrl(did: string): string | null {
  const methodSpecific = did.slice('did:web:'.length)
  const [hostPart, ...pathParts] = methodSpecific.split(':')
  if (hostPart === undefined || hostPart.length === 0) return null

  const host = decodeSegment(hostPart)
  if (host === null || host.length === 0) return null

  const path: string[] = []
  for (const part of pathParts) {
    const decoded = decodeSegment(part)
    if (decoded === null || decoded.length === 0) return null
    path.push(decoded)
  }

  const base = `https://${host}`
  return path.length > 0 ? `${base}/${path.join('/')}/did.json` : `${base}/.well-known/did.json`
}

async function resolvePds(identifier: string): Promise<{ did: string; service: string }> {
  const cleaned = identifier.trim().replace(/^@/, '')
  let did: string | null = cleaned.startsWith('did:') ? cleaned : null

  if (did === null) {
    const body = await fetchJson(`${RESOLVE_HANDLE_URL}?handle=${encodeURIComponent(cleaned)}`)
    if (!isRecord(body)) throw new Error('could not resolve that handle')
    const resolvedDid = body['did']
    if (typeof resolvedDid !== 'string' || !resolvedDid.startsWith('did:')) {
      throw new Error('could not resolve that handle')
    }
    did = resolvedDid
  }

  let service = FALLBACK_PDS
  const docUrl = did.startsWith('did:plc:')
    ? `https://plc.directory/${did}`
    : did.startsWith('did:web:')
      ? didWebDocumentUrl(did)
      : null

  if (docUrl !== null) {
    try {
      const document = await fetchJson(docUrl)
      if (isRecord(document)) {
        // a document served for a different did cannot speak for this one
        const services = document['id'] === did ? document['service'] : null
        if (Array.isArray(services)) {
          for (const entry of services) {
            if (!isRecord(entry)) continue
            if (entry['type'] !== 'AtprotoPersonalDataServer') continue
            const endpoint = entry['serviceEndpoint']
            if (typeof endpoint !== 'string') continue
            const normalized = normalizeAppViewHost(endpoint)
            if (normalized === null) continue
            service = normalized
            break
          }
        }
      }
    } catch {
      // fall back to the entryway; a supplied pds bypasses this path entirely
    }
  }

  return { did, service }
}

function makeAgent(service: string): AtpAgent {
  // the generation this agent was created in, kept as ownership metadata; the
  // live-session test below is the agent identity itself so a retained agent
  // keeps refreshing after a newer operation starts
  const createdEpoch = authEpoch
  const agent = new AtpAgent({
    service,
    persistSession: (event: AtpSessionEvent, session: AtpSessionData | undefined) => {
      // Only the committed agent owns the stored session. A pending candidate
      // cannot persist before it is committed, and a superseded agent can
      // neither persist over the current account nor expire it.
      if (activeAgent !== agent) return

      if (event === 'create' || event === 'update') {
        if (session === undefined) return
        writeStoredAuth(service, session)
        // A token refresh can carry a handle rename. The stored session now
        // has the new handle, so the live account must adopt it too; same did
        // and same agent, so neither the epoch nor interaction state moves.
        const { account } = useAuthStore.getState()
        if (account !== null && account.did === session.did && account.handle !== session.handle) {
          useAuthStore.setState({ account: { did: account.did, handle: session.handle } })
        }
        return
      }

      if (event === 'expired') {
        clearStoredAuth()
        activeAgent = null

        // A newer auth operation owns the epoch while it is pending. Clearing
        // its pending flag here would cancel a login that may still succeed.
        if (pendingAuthEpoch !== null) {
          useAuthStore.setState({ status: 'anonymous', account: null })
          return
        }

        authEpoch = Math.max(authEpoch, createdEpoch) + 1
        useAuthStore.setState({ status: 'anonymous', account: null, pending: false })
      }
    },
  })
  applyConfiguredLabelers(agent)
  return agent
}

export function getAuthAgent(): AtpAgent | Agent | null {
  return activeAgent
}

/**
 * Account-scoped reads must run as the account their query key names. A query
 * callback that fires after a switch gets this error instead of borrowing
 * whoever happens to be signed in now.
 */
export function requireViewerAgent(viewerDid: string): AtpAgent | Agent {
  const agent = activeAgent
  if (agent === null || agent.did !== viewerDid) {
    throw new Error('account changed before the request could be sent')
  }
  return agent
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'anonymous',
  account: null,
  pending: false,
  error: null,

  clearError: () => set({ error: null }),

  restore: async () => {
    if (activeAgent !== null) return
    if (restorePromise !== null) {
      await restorePromise
      return
    }

    authEpoch += 1
    const epoch = authEpoch

    restorePromise = (async () => {
      set({ status: 'restoring', error: null })

      try {
        const oauth = await restoreOAuth()
        if (epoch !== authEpoch) return
        if (oauth !== null) {
          applyConfiguredLabelers(oauth.agent)
          activeAgent = oauth.agent
          clearStoredAuth()
          set({
            status: 'authenticated',
            account: { did: oauth.did, handle: oauth.handle ?? oauth.did },
            pending: false,
            error: null,
          })
          return
        }
      } catch {
        // portal sessions are optional; password sessions remain the fallback
        if (epoch !== authEpoch) return
      }

      const stored = readStoredAuth()
      if (epoch !== authEpoch) return
      if (stored === null) {
        set({ status: 'anonymous', account: null })
        return
      }

      const candidate = makeAgent(stored.service)
      try {
        await candidate.resumeSession(stored.session)
      } catch {
        // The sdk decides validity, not this caller: a transient, network or
        // non-expiry server failure leaves its session in place, and only a
        // rejected refresh token clears it. A 400 is not proof of expiry.
      }
      if (epoch !== authEpoch) return

      // A retained session is still a usable session: commit the same agent so
      // a later refresh can succeed instead of turning the account anonymous.
      const session = candidate.session
      if (session === undefined) {
        clearStoredAuth()
        activeAgent = null
        set({ status: 'anonymous', account: null, pending: false, error: null })
        return
      }

      activeAgent = candidate
      writeStoredAuth(stored.service, session)
      set({
        status: 'authenticated',
        account: { did: session.did, handle: session.handle },
        pending: false,
        error: null,
      })
    })()

    try {
      await restorePromise
    } finally {
      restorePromise = null
    }
  },

  signIn: async (identifier, password, pds) => {
    const cleaned = identifier.trim().replace(/^@/, '')
    if (cleaned.length === 0 || password.length === 0) {
      set({ error: 'handle and app password are required', pending: false })
      return false
    }

    authEpoch += 1
    const epoch = authEpoch
    pendingAuthEpoch = epoch
    // The committed account and its agent stay paired until a replacement is
    // actually committed, so a failed switch leaves the current session alone.
    set({ pending: true, error: null })

    const release = () => {
      if (pendingAuthEpoch === epoch) pendingAuthEpoch = null
    }

    try {
      let service: string
      if (pds !== undefined && pds.trim().length > 0) {
        const normalized = normalizeAppViewHost(pds)
        if (normalized === null) throw new Error('the pds must be an https origin')
        service = normalized
      } else {
        service = (await resolvePds(cleaned)).service
      }
      if (epoch !== authEpoch) return false

      const candidate = makeAgent(service)
      await candidate.login({ identifier: cleaned, password })
      if (epoch !== authEpoch) return false
      const session = candidate.session
      if (session === undefined) throw new Error('login did not return a session')

      // A password sign-in owns the account now: drop any portal session so a
      // later restore cannot quietly switch back to the previous account.
      await signOutOAuth()
      if (epoch !== authEpoch) return false

      release()
      activeAgent = candidate
      writeStoredAuth(service, session)
      set({
        status: 'authenticated',
        account: { did: session.did, handle: session.handle },
        pending: false,
        error: null,
      })
      return true
    } catch (error) {
      if (epoch !== authEpoch) return false
      const info = errorInfo(error)
      release()
      // A rejected credential discards the stored refresh token too so an old
      // account cannot be restored on the next load. Every other failure
      // leaves the committed pair untouched.
      if (info.status === 400 || info.status === 401) {
        clearStoredAuth()
        activeAgent = null
        set({
          status: 'anonymous',
          account: null,
          pending: false,
          error: info.detail,
        })
        return false
      }
      set({ pending: false, error: info.detail })
      return false
    }
  },

  signInWithPortal: async (identifier) => {
    const cleaned = identifier.trim().replace(/^@/, '')
    if (cleaned.length === 0) {
      set({ error: 'a handle or did is required', pending: false })
      return false
    }

    authEpoch += 1
    const epoch = authEpoch
    pendingAuthEpoch = epoch
    // the redirect may still land; until it does the committed pair is intact
    set({ pending: true, error: null })

    const release = () => {
      if (pendingAuthEpoch === epoch) pendingAuthEpoch = null
    }

    try {
      await signInOAuth(cleaned)
      if (epoch !== authEpoch) return false
      release()
      set({ pending: false })
      return false
    } catch (error) {
      if (epoch !== authEpoch) return false
      release()
      set({ pending: false, error: errorInfo(error).detail })
      return false
    }
  },

  signOut: async () => {
    authEpoch += 1
    const epoch = authEpoch
    pendingAuthEpoch = null
    const current = activeAgent

    // Local auth ends before the network does: a failed revocation must never
    // leave the account looking signed in.
    activeAgent = null
    clearStoredAuth()
    set({ status: 'anonymous', account: null, pending: true, error: null })

    // Revoke both mechanisms when present, not only whichever one is active.
    try {
      await signOutOAuth()
    } catch {
      // the local auth state is cleared even if revocation fails
    }

    if (current instanceof AtpAgent) {
      try {
        await current.logout()
      } catch {
        // clearing the local session is the source of truth
      }
    }

    if (epoch !== authEpoch) return
    set({ pending: false, error: null })
  },
}))
