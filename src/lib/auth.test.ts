import { AtpAgent, type AtpBaseClient, type AtpSessionData } from '@atproto/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import { currentAccountLabelers, setAccountLabelers } from './accountLabelers'
import { fetchActorSearch } from './atproto'
import { AUTH_SIGNED_OUT_KEY, AUTH_STORAGE_KEY, getAuthAgent, useAuthStore } from './auth'
import { applyConfiguredLabelers } from './labelers'
import { boundedFetch } from './requestTimeout'

const oauthControl = vi.hoisted(() => ({
  portalError: 'portal sign in needs a loopback address' as string | null,
  restoreError: null as string | null,
  restoreDid: null as string | null,
  signOutError: null as string | null,
}))

// the portal is external I/O: its failures are steered here, and everything the
// auth store owns (epochs, stored sessions, the agent) stays real
vi.mock('./oauth', () => ({
  canUseOAuth: () => false,
  restoreOAuth: async () => {
    if (oauthControl.restoreError !== null) throw new Error(oauthControl.restoreError)
    if (oauthControl.restoreDid === null) return null
    return {
      agent: { configureLabelers: () => {} },
      did: oauthControl.restoreDid,
      handle: 'portal.test',
    }
  },
  signInOAuth: async () => {
    if (oauthControl.portalError !== null) throw new Error(oauthControl.portalError)
  },
  signOutOAuth: async () => {
    if (oauthControl.signOutError !== null) throw new Error(oauthControl.signOutError)
  },
}))

function deferred<T>() {
  return Promise.withResolvers<T>()
}

const ALICE: AtpSessionData = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

const BOB: AtpSessionData = {
  did: 'did:plc:bob',
  handle: 'bob.test',
  accessJwt: 'bob-access',
  refreshJwt: 'bob-refresh',
  active: true,
}

const LABELER = 'did:plc:bendayvalidlabeler'
const OTHER_LABELER = 'did:plc:bendayotherlabeler'

function customLabelers(header: string | undefined): string[] {
  return (header ?? '').split(', ').filter((entry) => entry !== '' && !entry.endsWith(';redact'))
}

function configureAccountLabelers(session: AtpSessionData, dids: string[] = [LABELER]): void {
  setAccountLabelers(session.did, dids)
  const agent = getAuthAgent()
  if (agent === null) throw new Error('no committed agent')
  applyConfiguredLabelers(agent)
}

async function expectPublicLabelers(dids: string[]): Promise<void> {
  await fetchActorSearch('alice')
  expect(customLabelers(transport.calls.at(-1)?.headers['atproto-accept-labelers'])).toEqual(dids)
}

function sessionFor(identifier: string): AtpSessionData {
  if (identifier.includes('bob')) return BOB
  // a discovered identity must get a session that names it, so these fixtures
  // never depend on a mismatched did being accepted
  return identifier.startsWith('did:') ? { ...ALICE, did: identifier } : ALICE
}

function storedSession(): AtpSessionData | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY)
  if (raw === null) return null
  const parsed = JSON.parse(raw) as { session?: AtpSessionData }
  return parsed.session ?? null
}

// the password session owns token refresh; the portal agent refreshes itself
function passwordSession(agent: AtpBaseClient | null): AtpAgent['sessionManager'] | null {
  return agent !== null && agent instanceof AtpAgent ? agent.sessionManager : null
}

let transport: TestTransport
// the session the last successful refresh returned, so the sdk's follow-up
// getSession echoes it instead of rolling the refreshed handle back
let currentRefresh: AtpSessionData = ALICE

beforeEach(async () => {
  oauthControl.portalError = 'portal sign in needs a loopback address'
  oauthControl.restoreError = null
  oauthControl.restoreDid = null
  oauthControl.signOutError = null
  transport = installTransport()
  for (const host of ['https://api.bsky.app', 'https://pds.test']) {
    transport.route('GET', `${host}/xrpc/app.bsky.actor.searchActors`, () =>
      jsonResponse(200, { actors: [] }),
    )
  }
  transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.deleteSession', () =>
    jsonResponse(200, {}),
  )
  currentRefresh = ALICE
  transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
    jsonResponse(200, currentRefresh),
  )
  // the sdk fills email/didDoc gaps after a refresh with getSession; echoing the
  // session that refresh just produced keeps its handle and tokens
  transport.route('GET', 'https://pds.test/xrpc/com.atproto.server.getSession', (request) =>
    jsonResponse(200, {
      ...currentRefresh,
      accessJwt: (request.headers['authorization'] ?? '').replace(/^Bearer /, ''),
      email: 'alice@test',
      emailConfirmed: true,
      didDoc: {},
    }),
  )
  // signing out revokes whichever pds the previous case signed into
  for (const host of ['https://pds.example.com', 'https://bsky.social']) {
    transport.route('POST', `${host}/xrpc/com.atproto.server.deleteSession`, () =>
      jsonResponse(200, {}),
    )
  }
  // every host answers for the identifier it was sent, so the discovered did
  // and the session it commits always agree
  const createSession = (request: { body: string | null }) => {
    const body = request.body === null ? {} : (JSON.parse(request.body) as { identifier?: string })
    return jsonResponse(200, sessionFor(body.identifier ?? ''))
  }
  for (const host of ['https://pds.test', 'https://pds.example.com', 'https://bsky.social']) {
    transport.route('POST', `${host}/xrpc/com.atproto.server.createSession`, createSession)
  }
  // password sign-in discovers the pds from the account's did document
  for (const did of [ALICE.did, BOB.did]) {
    transport.route('GET', `https://plc.directory/${did}`, () =>
      jsonResponse(200, {
        id: did,
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: 'https://pds.test',
          },
        ],
      }),
    )
  }
  await useAuthStore.getState().signOut()
  // each case starts from a fresh profile, not one that just signed out
  localStorage.removeItem(AUTH_SIGNED_OUT_KEY)
  transport.calls.length = 0
})

function routeRefresh(session: AtpSessionData): void {
  currentRefresh = session
  transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
    jsonResponse(200, session),
  )
}

async function signInAs(session: AtpSessionData): Promise<void> {
  await expect(useAuthStore.getState().signIn(session.did, 'password')).resolves.toBe(true)
}

describe('sign-in transitions', () => {
  it('keeps the committed account and its refresh token while a replacement is pending', async () => {
    await signInAs(ALICE)
    configureAccountLabelers(ALICE)
    const gate = deferred<Response>()
    transport.route(
      'POST',
      'https://pds.test/xrpc/com.atproto.server.createSession',
      () => gate.promise,
    )

    const pending = useAuthStore.getState().signIn('did:plc:bob', 'password')
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      pending: true,
      account: { did: 'did:plc:alice' },
    })
    expect(getAuthAgent()?.did).toBe('did:plc:alice')
    await vi.waitFor(() =>
      expect(
        transport.calls.filter((call) => call.url.endsWith('/com.atproto.server.createSession')),
      ).toHaveLength(2),
    )
    const candidateRequest = transport.calls.findLast((call) =>
      call.url.endsWith('/com.atproto.server.createSession'),
    )
    expect(customLabelers(candidateRequest?.headers['atproto-accept-labelers'])).toEqual([])
    await expectPublicLabelers([LABELER])

    routeRefresh({ ...ALICE, accessJwt: 'alice-access-2', refreshJwt: 'alice-refresh-2' })
    await passwordSession(getAuthAgent())?.refreshSession()
    expect(storedSession()?.refreshJwt).toBe('alice-refresh-2')

    gate.resolve(jsonResponse(500, { error: 'InternalServerError', message: 'pds fell over' }))
    await expect(pending).resolves.toBe(false)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      pending: false,
      account: { did: 'did:plc:alice' },
      error: 'pds fell over',
    })
    expect(getAuthAgent()?.did).toBe('did:plc:alice')
    expect(storedSession()?.refreshJwt).toBe('alice-refresh-2')
    await expectPublicLabelers([LABELER])
  })

  it('revokes a candidate that lost the race and keeps the committed account', async () => {
    await signInAs(BOB)
    configureAccountLabelers(BOB, [OTHER_LABELER])
    transport.calls.length = 0
    const bobGate = deferred<Response>()
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.createSession', (request) => {
      const body: unknown = JSON.parse(request.body ?? '{}')
      const identifier =
        typeof body === 'object' && body !== null && 'identifier' in body
          ? body.identifier
          : undefined
      if (identifier === 'did:plc:bob') return bobGate.promise
      return jsonResponse(200, sessionFor(typeof identifier === 'string' ? identifier : ''))
    })
    const revocations: Array<{ url: string; authorization: string | undefined }> = []
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.deleteSession', (request) => {
      revocations.push({ url: request.url, authorization: request.headers['authorization'] })
      return jsonResponse(200, {})
    })

    const stale = useAuthStore.getState().signIn('did:plc:bob', 'password')
    // discovery runs first, so wait until the candidate's login is in flight
    // before the newer sign-in claims the epoch
    await vi.waitFor(() =>
      expect(
        transport.calls.some((call) => call.url.endsWith('/xrpc/com.atproto.server.createSession')),
      ).toBe(true),
    )
    await signInAs(ALICE)
    expect(currentAccountLabelers()).toEqual([])
    configureAccountLabelers(ALICE)
    bobGate.resolve(jsonResponse(200, BOB))

    await expect(stale).resolves.toBe(false)
    // only the losing candidate is revoked; the committed login stays, which
    // the bearer token proves: it is BOB's refresh token, not ALICE's
    expect(revocations).toHaveLength(1)
    expect(revocations[0]?.authorization).toBe(`Bearer ${BOB.refreshJwt}`)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:alice' },
    })
    expect(getAuthAgent()?.did).toBe('did:plc:alice')
    expect(currentAccountLabelers()).toEqual([LABELER])
    await expectPublicLabelers([LABELER])
  })

  it('rejects a session that names a different account than discovery', async () => {
    await signInAs(ALICE)
    configureAccountLabelers(ALICE)
    const committedRecord = localStorage.getItem(AUTH_STORAGE_KEY)
    const revocations: Array<string | undefined> = []
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.deleteSession', (request) => {
      revocations.push(request.headers['authorization'])
      return jsonResponse(200, {})
    })
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.createSession', () =>
      jsonResponse(200, BOB),
    )

    await expect(useAuthStore.getState().signIn(ALICE.did, 'password')).resolves.toBe(false)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:alice' },
      pending: false,
      error: 'login returned another account',
    })
    expect(getAuthAgent()?.did).toBe('did:plc:alice')
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe(committedRecord)
    // only the candidate session is revoked, never the committed account's
    expect(revocations).toEqual([`Bearer ${BOB.refreshJwt}`])
    expect(currentAccountLabelers()).toEqual([LABELER])
  })

  it('clears an expired committed session without cancelling a newer login', async () => {
    await signInAs(ALICE)
    configureAccountLabelers(ALICE)
    const gate = deferred<Response>()
    transport.route(
      'POST',
      'https://pds.test/xrpc/com.atproto.server.createSession',
      () => gate.promise,
    )

    const pending = useAuthStore.getState().signIn('did:plc:bob', 'password')
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
      jsonResponse(401, { error: 'ExpiredToken', message: 'expired' }),
    )
    await expect(passwordSession(getAuthAgent())?.refreshSession()).rejects.toThrow()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      account: null,
      pending: true,
      error: null,
    })
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(currentAccountLabelers()).toEqual([])
    await expectPublicLabelers([])

    gate.resolve(jsonResponse(200, BOB))
    await expect(pending).resolves.toBe(true)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:bob', handle: 'bob.test' },
      pending: false,
      error: null,
    })
    expect(getAuthAgent()?.did).toBe('did:plc:bob')
    expect(storedSession()?.did).toBe('did:plc:bob')
  })

  it('clears the local session when the pds rejects the credentials', async () => {
    await signInAs(ALICE)
    configureAccountLabelers(ALICE)
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.createSession', () =>
      jsonResponse(401, {
        error: 'AuthenticationRequired',
        message: 'invalid identifier or password',
      }),
    )

    await expect(useAuthStore.getState().signIn('did:plc:bob', 'wrong')).resolves.toBe(false)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      account: null,
      pending: false,
      error: 'invalid identifier or password',
    })
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(getAuthAgent()).toBeNull()
    expect(currentAccountLabelers()).toEqual([])
    await expectPublicLabelers([])
  })

  it.each([ALICE, BOB])(
    'applies only the committed account labelers when replacing with $did',
    async (session) => {
      await signInAs(ALICE)
      configureAccountLabelers(ALICE)
      const previous = getAuthAgent()

      await signInAs(session)

      const expected = session.did === ALICE.did ? [LABELER] : []
      expect(currentAccountLabelers()).toEqual(expected)
      const replacement = getAuthAgent()
      if (replacement === null) throw new Error('no replacement agent')
      expect(replacement).not.toBe(previous)
      await replacement.app.bsky.actor.searchActors({ q: 'alice' })
      expect(customLabelers(transport.calls.at(-1)?.headers['atproto-accept-labelers'])).toEqual(
        expected,
      )
      await expectPublicLabelers(expected)
    },
  )

  it('ignores session events from a replaced agent', async () => {
    await signInAs(ALICE)
    const stale = getAuthAgent()
    await signInAs(BOB)
    const bobOnly = storedSession()

    routeRefresh({ ...ALICE, accessJwt: 'alice-access-2', refreshJwt: 'alice-refresh-2' })
    await passwordSession(stale)?.refreshSession()
    expect(storedSession()).toEqual(bobOnly)

    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
      jsonResponse(401, { error: 'ExpiredToken', message: 'expired' }),
    )
    await expect(passwordSession(stale)?.refreshSession()).rejects.toThrow()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:bob' },
    })
    expect(storedSession()).toEqual(bobOnly)
  })

  it('keeps a stored session from another tab through refresh and expiry', async () => {
    await signInAs(ALICE)
    const otherTab = JSON.stringify({ service: 'https://pds.test', session: BOB })
    localStorage.setItem(AUTH_STORAGE_KEY, otherTab)

    routeRefresh({ ...ALICE, accessJwt: 'alice-access-2', refreshJwt: 'alice-refresh-2' })
    await passwordSession(getAuthAgent())?.refreshSession()
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe(otherTab)

    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
      jsonResponse(401, { error: 'ExpiredToken', message: 'expired' }),
    )
    await expect(passwordSession(getAuthAgent())?.refreshSession()).rejects.toThrow()

    expect(useAuthStore.getState()).toMatchObject({ status: 'anonymous', account: null })
    expect(getAuthAgent()).toBeNull()
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe(otherTab)
  })

  it('adopts a renamed handle from the committed agent refresh without replacing the session', async () => {
    await signInAs(ALICE)
    const agent = getAuthAgent()
    routeRefresh({
      ...ALICE,
      handle: 'alice.renamed',
      accessJwt: 'alice-access-2',
      refreshJwt: 'alice-refresh-2',
    })

    await passwordSession(agent)?.refreshSession()

    expect(storedSession()?.handle).toBe('alice.renamed')
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:alice', handle: 'alice.renamed' },
      pending: false,
    })
    // a rename is not a re-login: the same committed agent keeps refreshing
    expect(getAuthAgent()).toBe(agent)
  })

  it('ignores a renamed handle reported by a replaced agent', async () => {
    await signInAs(ALICE)
    const stale = getAuthAgent()
    await signInAs(BOB)
    const bobOnly = storedSession()

    routeRefresh({
      ...ALICE,
      handle: 'alice.renamed',
      accessJwt: 'alice-access-3',
      refreshJwt: 'alice-refresh-3',
    })
    await passwordSession(stale)?.refreshSession()

    expect(storedSession()).toEqual(bobOnly)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:bob', handle: 'bob.test' },
    })
  })

  it.each(['portal sign in needs a loopback address', null])(
    'leaves the committed account alone after portal startup: %s',
    async (portalError) => {
      await signInAs(ALICE)
      configureAccountLabelers(ALICE)
      oauthControl.portalError = portalError

      await expect(useAuthStore.getState().signInWithPortal('bob.test')).resolves.toBeUndefined()

      const state = useAuthStore.getState()
      expect(state).toMatchObject({
        status: 'authenticated',
        account: { did: 'did:plc:alice' },
        pending: false,
      })
      expect(state.error).toBe(portalError)
      expect(currentAccountLabelers()).toEqual([LABELER])
      await expectPublicLabelers([LABELER])
    },
  )
})

describe('request deadline', () => {
  it('bounds each request and keeps the caller signal composed', async () => {
    const seen: Array<{ input: string; signal: AbortSignal | null | undefined }> = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input: String(input), signal: init?.signal })
      return Promise.resolve(jsonResponse(200, {}))
    })

    await boundedFetch('https://pds.test/xrpc/deadline')
    expect(seen[0]?.input).toBe('https://pds.test/xrpc/deadline')
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(seen[0]?.signal?.aborted).toBe(false)

    const caller = new AbortController()
    await boundedFetch('https://pds.test/xrpc/cancelled', { signal: caller.signal })
    caller.abort()
    // the caller's cancellation still wins over the deadline
    expect(seen[1]?.signal?.aborted).toBe(true)
  })
})

describe('sign-out', () => {
  it('clears local auth before revocation finishes without undoing a newer login', async () => {
    await signInAs(ALICE)
    const revoke = deferred<Response>()
    transport.route(
      'POST',
      'https://pds.test/xrpc/com.atproto.server.deleteSession',
      () => revoke.promise,
    )

    const signingOut = useAuthStore.getState().signOut()
    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      account: null,
      pending: false,
      error: null,
    })
    expect(getAuthAgent()).toBeNull()
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()

    await signInAs(BOB)
    revoke.resolve(jsonResponse(200, {}))
    await signingOut

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:bob' },
      pending: false,
      error: null,
    })
    expect(getAuthAgent()?.did).toBe('did:plc:bob')
  })

  it('keeps a portal session the sdk still holds from restoring after sign-out', async () => {
    await signInAs(ALICE)
    // the sdk's stored session outlives the local sign-out until revocation
    // settles; a reload in that window must still read as signed out
    oauthControl.restoreDid = 'did:plc:portal'

    const signingOut = useAuthStore.getState().signOut()
    // read synchronously: the state, the password record and the portal marker
    // must already agree, without waiting for any revocation
    expect(useAuthStore.getState()).toMatchObject({ status: 'anonymous', account: null })
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(AUTH_SIGNED_OUT_KEY)).not.toBeNull()

    await signingOut
    // a reload starts from a fresh store and asks the portal to restore
    useAuthStore.setState({ status: 'restoring', account: null })
    await useAuthStore.getState().restore()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      account: null,
      pending: false,
    })
    expect(getAuthAgent()).toBeNull()
  })

  it('reports a failed revocation without signing the account back in', async () => {
    await signInAs(ALICE)
    oauthControl.signOutError = 'revoke unavailable'

    await useAuthStore.getState().signOut()

    const state = useAuthStore.getState()
    expect(state).toMatchObject({ status: 'anonymous', account: null })
    expect(state.error).toContain('revocation failed')
    expect(state.error).toContain('revoke unavailable')
    expect(getAuthAgent()).toBeNull()
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })
})

describe('restore', () => {
  const REFRESH = 'https://pds.test/xrpc/com.atproto.server.refreshSession'

  function storeSession(session: AtpSessionData = ALICE): void {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ service: 'https://pds.test', session }))
  }

  it('keeps a session the sdk retained through a transient server failure', async () => {
    storeSession()
    transport.route('POST', REFRESH, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'pds fell over' }),
    )

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:alice', handle: 'alice.test' },
      pending: false,
    })
    expect(getAuthAgent()?.did).toBe('did:plc:alice')
    expect(storedSession()).toEqual(ALICE)
  })

  it('keeps a session when the refresh throws without a response', async () => {
    storeSession()
    transport.route('POST', REFRESH, () => {
      throw new Error('offline')
    })

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(getAuthAgent()?.did).toBe('did:plc:alice')
    expect(storedSession()).toEqual(ALICE)
  })

  it('keeps a session on a non-expiry rejection', async () => {
    storeSession()
    transport.route('POST', REFRESH, () =>
      jsonResponse(400, { error: 'InvalidRequest', message: 'try later' }),
    )

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(storedSession()).toEqual(ALICE)
  })

  it('clears the stored auth the sdk reports as expired', async () => {
    storeSession()
    setAccountLabelers(ALICE.did, [LABELER])
    transport.route('POST', REFRESH, () =>
      jsonResponse(401, { error: 'ExpiredToken', message: 'expired' }),
    )

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState()).toMatchObject({ status: 'anonymous', account: null })
    expect(getAuthAgent()).toBeNull()
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    await expectPublicLabelers([])
  })

  it('reports a portal restore failure without dropping the password session', async () => {
    storeSession()
    oauthControl.restoreError = 'could not reach the portal'
    transport.route('POST', REFRESH, () =>
      jsonResponse(200, { ...ALICE, accessJwt: 'alice-access-2' }),
    )

    await useAuthStore.getState().restore()

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:alice' },
      error: null,
      restoreError: 'could not reach the portal',
    })
  })

  it('clears the portal restore failure when a sign-in starts', async () => {
    oauthControl.restoreError = 'could not reach the portal'
    await useAuthStore.getState().restore()
    expect(useAuthStore.getState().restoreError).toBe('could not reach the portal')

    await signInAs(BOB)

    expect(useAuthStore.getState().restoreError).toBeNull()
  })

  it('clears the portal restore failure on sign-out and on clearError', async () => {
    oauthControl.restoreError = 'could not reach the portal'
    await useAuthStore.getState().restore()
    useAuthStore.getState().clearError()
    expect(useAuthStore.getState().restoreError).toBeNull()

    useAuthStore.setState({ restoreError: 'could not reach the portal' })
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState().restoreError).toBeNull()
  })

  it('does not let a stale restore replace a newer sign-in', async () => {
    storeSession()
    const gate = deferred<Response>()
    transport.route('POST', REFRESH, () => gate.promise)

    const restoring = useAuthStore.getState().restore()
    await signInAs(BOB)
    gate.resolve(jsonResponse(200, { ...ALICE, accessJwt: 'alice-access-2' }))
    await restoring

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:bob' },
    })
    expect(getAuthAgent()?.did).toBe('did:plc:bob')
    expect(storedSession()?.did).toBe('did:plc:bob')
  })
})

describe('did discovery', () => {
  function serveDocument(
    id: string,
    pds: string,
    where = 'https://example.com/.well-known/did.json',
  ): void {
    transport.route('GET', where, () =>
      jsonResponse(200, {
        id,
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }],
      }),
    )
  }

  function createSessionHost(): string | null {
    const call = transport.calls.find((entry) =>
      entry.url.endsWith('/xrpc/com.atproto.server.createSession'),
    )
    return call === undefined ? null : new URL(call.url).origin
  }

  it.each([
    ['did:web:example.com', 'https://example.com/.well-known/did.json'],
    ['did:web:example.com%3A8443', 'https://example.com:8443/.well-known/did.json'],
    ['did:web:example.com:user:alice', 'https://example.com/user/alice/did.json'],
  ])('reads %s from its spec document url', async (did, documentUrl) => {
    serveDocument(did, 'https://pds.example.com', documentUrl)

    await expect(useAuthStore.getState().signIn(did, 'password')).resolves.toBe(true)

    expect(transport.calls.map((call) => call.url)).toContain(documentUrl)
    expect(createSessionHost()).toBe('https://pds.example.com')
  })

  it('rejects a document that speaks for another did', async () => {
    serveDocument('did:web:someone.else', 'https://attacker.test')

    await expect(useAuthStore.getState().signIn('did:web:example.com', 'password')).resolves.toBe(
      true,
    )

    expect(createSessionHost()).toBe('https://bsky.social')
  })

  it('falls back to the entryway when discovery fails', async () => {
    transport.route('GET', 'https://example.com/.well-known/did.json', () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'nope' }),
    )

    await expect(useAuthStore.getState().signIn('did:web:example.com', 'password')).resolves.toBe(
      true,
    )

    expect(createSessionHost()).toBe('https://bsky.social')
  })
})
