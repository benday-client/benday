import { AtpAgent, type AtpBaseClient, type AtpSessionData } from '@atproto/api'
import { beforeEach, describe, expect, it } from 'vitest'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import { AUTH_STORAGE_KEY, getAuthAgent, useAuthStore } from './auth'

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

function sessionFor(identifier: string): AtpSessionData {
  return identifier.startsWith('bob') ? BOB : ALICE
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

beforeEach(async () => {
  transport = installTransport()
  transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.deleteSession', () =>
    jsonResponse(200, {}),
  )
  transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
    jsonResponse(200, ALICE),
  )
  transport.route('POST', 'https://pds.example.com/xrpc/com.atproto.server.createSession', () =>
    jsonResponse(200, ALICE),
  )
  transport.route('POST', 'https://bsky.social/xrpc/com.atproto.server.createSession', () =>
    jsonResponse(200, ALICE),
  )
  transport.route('POST', 'https://pds.benday.test/xrpc/com.atproto.server.createSession', () =>
    jsonResponse(200, ALICE),
  )
  transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.createSession', (request) => {
    const body = request.body === null ? {} : (JSON.parse(request.body) as { identifier?: string })
    return jsonResponse(200, sessionFor(body.identifier ?? ''))
  })

  await useAuthStore.getState().signOut()
  transport.calls.length = 0
})

async function signInAs(session: AtpSessionData): Promise<void> {
  await expect(
    useAuthStore.getState().signIn(session.handle, 'password', 'https://pds.test'),
  ).resolves.toBe(true)
}

describe('sign-in transitions', () => {
  it('keeps the committed account and its refresh token while a replacement is pending', async () => {
    await signInAs(ALICE)
    const gate = deferred<Response>()
    transport.route(
      'POST',
      'https://pds.test/xrpc/com.atproto.server.createSession',
      () => gate.promise,
    )

    const pending = useAuthStore.getState().signIn('bob.test', 'password', 'https://pds.test')
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      pending: true,
      account: { did: 'did:plc:alice' },
    })
    expect(getAuthAgent()?.did).toBe('did:plc:alice')

    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
      jsonResponse(200, { ...ALICE, accessJwt: 'alice-access-2', refreshJwt: 'alice-refresh-2' }),
    )
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
  })

  it('clears an expired committed session without cancelling a newer login', async () => {
    await signInAs(ALICE)
    const gate = deferred<Response>()
    transport.route(
      'POST',
      'https://pds.test/xrpc/com.atproto.server.createSession',
      () => gate.promise,
    )

    const pending = useAuthStore.getState().signIn('bob.test', 'password', 'https://pds.test')
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
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.createSession', () =>
      jsonResponse(401, {
        error: 'AuthenticationRequired',
        message: 'invalid identifier or password',
      }),
    )

    await expect(
      useAuthStore.getState().signIn('bob.test', 'wrong', 'https://pds.test'),
    ).resolves.toBe(false)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      account: null,
      pending: false,
      error: 'invalid identifier or password',
    })
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(getAuthAgent()).toBeNull()
  })

  it('ignores session events from a replaced agent', async () => {
    await signInAs(ALICE)
    const stale = getAuthAgent()
    await signInAs(BOB)
    const bobOnly = storedSession()

    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
      jsonResponse(200, { ...ALICE, accessJwt: 'alice-access-2', refreshJwt: 'alice-refresh-2' }),
    )
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

  it('adopts a renamed handle from the committed agent refresh without replacing the session', async () => {
    await signInAs(ALICE)
    const agent = getAuthAgent()
    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
      jsonResponse(200, {
        ...ALICE,
        handle: 'alice.renamed',
        accessJwt: 'alice-access-2',
        refreshJwt: 'alice-refresh-2',
      }),
    )

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

    transport.route('POST', 'https://pds.test/xrpc/com.atproto.server.refreshSession', () =>
      jsonResponse(200, {
        ...ALICE,
        handle: 'alice.renamed',
        accessJwt: 'alice-access-3',
        refreshJwt: 'alice-refresh-3',
      }),
    )
    await passwordSession(stale)?.refreshSession()

    expect(storedSession()).toEqual(bobOnly)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:bob', handle: 'bob.test' },
    })
  })

  it('leaves the committed account alone when the portal path fails', async () => {
    await signInAs(ALICE)

    await expect(useAuthStore.getState().signInWithPortal('bob.test')).resolves.toBe(false)

    const state = useAuthStore.getState()
    expect(state).toMatchObject({
      status: 'authenticated',
      account: { did: 'did:plc:alice' },
      pending: false,
    })
    expect(state.error).toContain('loopback')
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
      pending: true,
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

  it('bypasses discovery entirely when a pds is supplied', async () => {
    await expect(
      useAuthStore.getState().signIn('did:plc:alice', 'password', 'https://pds.benday.test'),
    ).resolves.toBe(true)

    expect(transport.calls).toHaveLength(1)
    expect(transport.calls[0]?.url).toBe(
      'https://pds.benday.test/xrpc/com.atproto.server.createSession',
    )
  })
})
