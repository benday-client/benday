import type { BrowserOAuthClient } from '@atproto/oauth-client-browser'
import { afterEach, expect, it, vi } from 'vitest'
import { installTransport, jsonResponse } from '../test/transport'
import { loopbackClientId, restoreOAuth, signInOAuth, signOutOAuth } from './oauth'

const DATABASE_NAME = '@atproto-oauth-client'
const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const PDS = 'https://pds.test'
const ISSUER = 'https://issuer.test'
const channels: BroadcastChannel[] = []
const originalUrl = location.href
const originalHistoryState: unknown = history.state

function openDatabase(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>()
  const request = indexedDB.open(DATABASE_NAME)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
  return promise
}

function deleteDatabase(): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const request = indexedDB.deleteDatabase(DATABASE_NAME)
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
  request.onblocked = () => reject(new Error('OAuth database connection was not released'))
  return promise
}

async function storedKeys(store: string): Promise<IDBValidKey[]> {
  const database = await openDatabase()
  try {
    const { promise, resolve, reject } = Promise.withResolvers<IDBValidKey[]>()
    const transaction = database.transaction(store, 'readonly')
    const request = transaction.objectStore(store).getAllKeys()
    transaction.oncomplete = () => resolve(request.result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    return await promise
  } finally {
    database.close()
  }
}

afterEach(async () => {
  try {
    await signOutOAuth()
  } finally {
    for (const channel of channels) channel.close()
    channels.length = 0
    try {
      await deleteDatabase()
    } finally {
      history.replaceState(originalHistoryState, '', originalUrl)
    }
  }
})

it('authorizes after native database invalidation and retains callbacks and the committed session', async () => {
  const transport = installTransport()
  const NativeBroadcastChannel = globalThis.BroadcastChannel
  vi.stubGlobal(
    'BroadcastChannel',
    class extends NativeBroadcastChannel {
      constructor(name: string) {
        super(name)
        channels.push(this)
      }
    },
  )
  // Observe real channel ownership before exercising the lazy SDK import;
  // client.dispose removes listeners, but the SDK also owns a module channel.
  const { BrowserOAuthClient, OAuthCallbackError } = await import('@atproto/oauth-client-browser')
  transport.route('GET', `https://plc.directory/${encodeURIComponent(DID)}`, () =>
    jsonResponse(200, {
      id: DID,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    }),
  )
  transport.route('GET', `${PDS}/.well-known/oauth-protected-resource`, () =>
    jsonResponse(200, { resource: PDS, authorization_servers: [ISSUER] }),
  )
  transport.route('GET', `${ISSUER}/.well-known/oauth-authorization-server`, () =>
    jsonResponse(200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      revocation_endpoint: `${ISSUER}/revoke`,
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      dpop_signing_alg_values_supported: ['ES256'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    }),
  )
  transport.route('POST', `${ISSUER}/token`, () =>
    jsonResponse(200, {
      sub: DID,
      token_type: 'DPoP',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      scope: 'atproto transition:generic',
      expires_in: 3600,
    }),
  )
  transport.route('POST', `${ISSUER}/revoke`, () => jsonResponse(200, {}))
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getProfile`, () =>
    jsonResponse(200, { did: DID, handle: 'reader.test' }),
  )

  const redirects: URL[] = []
  const navigationError = new Error('navigation stopped at the browser boundary')
  // Only the final document navigation is replaced. Discovery, native IDB,
  // key generation, authorization state, callbacks and sessions use the SDK.
  vi.spyOn(BrowserOAuthClient.prototype, 'signInRedirect').mockImplementation(async function (
    this: BrowserOAuthClient,
    input,
    options,
  ) {
    redirects.push(await this.authorize(input, options))
    throw navigationError
  })

  await expect(restoreOAuth()).resolves.toBeNull()
  // In the old implementation the anonymous restore permanently retained an
  // SDK connection. A real delete sends versionchange, closing that connection;
  // the next authorization then writes through its permanently cached dead DB.
  const observer = await openDatabase()
  let versionChanged = false
  observer.onversionchange = () => {
    versionChanged = true
    observer.close()
  }
  await deleteDatabase()
  expect(versionChanged).toBe(true)

  await expect(signInOAuth(DID)).rejects.toBe(navigationError)
  const rejectedState = redirects[0]?.searchParams.get('state')
  expect(rejectedState).toBeTruthy()
  expect(await storedKeys('state')).toContain(rejectedState)
  history.replaceState(null, '', `/feed?view=following#error=access_denied&state=${rejectedState}`)
  await expect(restoreOAuth()).rejects.toBeInstanceOf(OAuthCallbackError)
  expect(location.search).toBe('?view=following')
  expect(location.hash).toBe('')
  expect(await storedKeys('state')).not.toContain(rejectedState)

  // A later attempt must also get usable storage, and disposing its client
  // must leave the persisted state available to the callback's new client.
  await expect(signInOAuth(DID)).rejects.toBe(navigationError)
  const acceptedState = redirects[1]?.searchParams.get('state')
  expect(acceptedState).toBeTruthy()
  history.replaceState(
    null,
    '',
    `/feed?view=following#code=accepted-code&state=${acceptedState}&iss=${ISSUER}`,
  )
  const account = await restoreOAuth()
  expect(account?.did).toBe(DID)
  expect(account?.handle).toBe('reader.test')
  expect(location.search).toBe('?view=following')
  expect(location.hash).toBe('')
  expect(await storedKeys('state')).not.toContain(acceptedState)
  expect(await storedKeys('session')).toContain(DID)

  // A new client can restore the same durable session without a token refresh.
  const restoredClient = await BrowserOAuthClient.load({
    clientId: loopbackClientId(location),
    handleResolver: 'https://public.api.bsky.app',
  })
  try {
    expect((await restoredClient.initRestore())?.session.sub).toBe(DID)
  } finally {
    await restoredClient.dispose()
  }

  // A failed redirect must not detach the committed session from sign-out or
  // dispose the storage used by its agent. Only the redirect client is ended.
  await expect(signInOAuth(DID)).rejects.toBe(navigationError)
  expect((await account?.agent.getProfile({ actor: DID }))?.data.did).toBe(DID)
  await signOutOAuth()
  expect(await storedKeys('session')).not.toContain(DID)
  expect(transport.calls.some((call) => call.url === `${ISSUER}/revoke`)).toBe(true)
})
