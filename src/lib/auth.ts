import type { Agent, AtpSessionData, AtpSessionEvent } from '@atproto/api'
import { AtpAgent } from '@atproto/api'
import { create } from 'zustand'
import { normalizeAppViewHost } from './appviews'
import { errorInfo } from './errors'
import { applyConfiguredLabelers } from './labelers'
import { restoreOAuth, signInOAuth, signOutOAuth } from './oauth'

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

function isSessionData(value: unknown): value is AtpSessionData {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record['accessJwt'] === 'string' &&
    typeof record['refreshJwt'] === 'string' &&
    typeof record['handle'] === 'string' &&
    typeof record['did'] === 'string' &&
    record['did'].startsWith('did:') &&
    typeof record['active'] === 'boolean'
  )
}

function isStoredAuth(value: unknown): value is StoredAuth {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const service = record['service']
  return (
    typeof service === 'string' &&
    normalizeAppViewHost(service) === service &&
    isSessionData(record['session'])
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

async function resolvePds(identifier: string): Promise<{ did: string; service: string }> {
  const cleaned = identifier.trim().replace(/^@/, '')
  let did: string | null = cleaned.startsWith('did:') ? cleaned : null

  if (did === null) {
    const body = await fetchJson(`${RESOLVE_HANDLE_URL}?handle=${encodeURIComponent(cleaned)}`)
    if (typeof body !== 'object' || body === null) {
      throw new Error('could not resolve that handle')
    }
    const resolvedDid = (body as Record<string, unknown>)['did']
    if (typeof resolvedDid !== 'string' || !resolvedDid.startsWith('did:')) {
      throw new Error('could not resolve that handle')
    }
    did = resolvedDid
  }

  let service = FALLBACK_PDS
  const didWebHost = did.startsWith('did:web:')
    ? did.slice('did:web:'.length).replaceAll(':', '/')
    : null
  const docUrl = did.startsWith('did:plc:')
    ? `https://plc.directory/${did}`
    : didWebHost !== null
      ? `https://${didWebHost}/.well-known/did.json`
      : null

  if (docUrl !== null) {
    try {
      const document = await fetchJson(docUrl)
      if (typeof document === 'object' && document !== null) {
        const services = (document as Record<string, unknown>)['service']
        if (Array.isArray(services)) {
          for (const entry of services) {
            if (typeof entry !== 'object' || entry === null) continue
            const serviceEntry = entry as Record<string, unknown>
            if (serviceEntry['type'] !== 'AtprotoPersonalDataServer') continue
            const endpoint = serviceEntry['serviceEndpoint']
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
  const createdEpoch = authEpoch
  const agent = new AtpAgent({
    service,
    persistSession: (event: AtpSessionEvent, session: AtpSessionData | undefined) => {
      // A session event from an agent that a newer auth action superseded must
      // not write storage or collapse the current account.
      if (authEpoch !== createdEpoch) return

      if (event === 'create' || event === 'update') {
        if (session !== undefined) writeStoredAuth(service, session)
        return
      }

      if (event === 'expired') {
        authEpoch += 1
        clearStoredAuth()
        activeAgent = null
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
        if (epoch !== authEpoch) return
        const session = candidate.session
        activeAgent = candidate
        if (session !== undefined) writeStoredAuth(stored.service, session)
        set({
          status: 'authenticated',
          account: session ? { did: session.did, handle: session.handle } : null,
          pending: false,
          error: null,
        })
      } catch (error) {
        if (epoch !== authEpoch) return
        const info = errorInfo(error)
        if (info.status === 400 || info.status === 401) clearStoredAuth()
        activeAgent = null
        set({ status: 'anonymous', account: null, pending: false, error: null })
      }
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
    set({ pending: true, error: null, status: 'anonymous', account: null })

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
      // A rejected explicit sign-in discards the stored refresh token too so an
      // old account cannot be restored on the next load.
      clearStoredAuth()
      activeAgent = null
      set({
        status: 'anonymous',
        account: null,
        pending: false,
        error: errorInfo(error).detail,
      })
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
    set({ pending: true, error: null, status: 'anonymous', account: null })

    try {
      await signInOAuth(cleaned)
      if (epoch !== authEpoch) return false
      set({ pending: false })
      return false
    } catch (error) {
      if (epoch !== authEpoch) return false
      set({
        status: 'anonymous',
        account: null,
        pending: false,
        error: errorInfo(error).detail,
      })
      return false
    }
  },

  signOut: async () => {
    authEpoch += 1
    const epoch = authEpoch
    set({ pending: true })
    const current = activeAgent
    activeAgent = null
    clearStoredAuth()

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
    set({ status: 'anonymous', account: null, pending: false, error: null })
  },
}))
