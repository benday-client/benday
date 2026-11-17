// @vitest-environment-options {"url":"http://127.0.0.1:5173/feed"}

import type { BrowserOAuthClient } from '@atproto/oauth-client-browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loopbackClientId, oauthClientId } from './oauth'
import { createOAuthClientMetadata } from './oauthMetadata'

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')

describe('loopbackClientId', () => {
  it('keeps the route on the redirect and no path on the client id', () => {
    const id = loopbackClientId({ hostname: '127.0.0.1', port: '4180', pathname: '/feed' })

    // the authorization server rejects a client id with a path component
    expect(id.slice(0, id.indexOf('?'))).toBe('http://localhost')
    const params = new URL(id).searchParams
    expect(params.get('redirect_uri')).toBe('http://127.0.0.1:4180/feed')
    expect(params.get('scope')).toBe('atproto transition:generic')
  })

  it('rewrites localhost to the loopback address on the redirect', () => {
    const id = loopbackClientId({ hostname: 'localhost', port: '5173', pathname: '/feed' })
    expect(new URL(id).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5173/feed')
  })

  it('builds one client id from every route', () => {
    const onFeed = loopbackClientId({ hostname: '127.0.0.1', port: '4180', pathname: '/feed' })
    const elsewhere = loopbackClientId({
      hostname: '127.0.0.1',
      port: '4180',
      pathname: '/notifications',
    })
    // a route-dependent id would make the pds reject the session's token with
    // "token was not issued to this client" after navigation
    expect(elsewhere).toBe(onFeed)
    expect(new URL(onFeed).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4180/feed')
  })

  it('omits an empty port and keeps the canonical route', () => {
    const id = loopbackClientId({ hostname: '127.0.0.1', port: '', pathname: '/' })
    expect(new URL(id).searchParams.get('redirect_uri')).toBe('http://127.0.0.1/feed')
    expect(id.startsWith('http://localhost?')).toBe(true)
  })
})

describe('hosted portal identity', () => {
  const metadata = createOAuthClientMetadata('https://benday.example/')

  it('keeps the metadata identity across routes with one callback', () => {
    for (const pathname of ['/feed', '/notifications', '/thread']) {
      const location = {
        hostname: 'benday.example',
        port: '',
        pathname,
        origin: metadata.client_uri,
      }
      expect(oauthClientId(location, metadata.client_id)).toBe(metadata.client_id)
    }
    expect(metadata.redirect_uris).toEqual(['https://benday.example/feed'])
    expect(metadata.client_id).toBe('https://benday.example/oauth-client-metadata.json')
  })

  it.each(['http://benday.example', 'https://other.example', 'http://localhost:5173'])(
    'does not use the hosted identity from %s',
    (origin) => {
      const url = new URL(origin)
      expect(
        oauthClientId(
          { hostname: url.hostname, port: url.port, pathname: '/feed', origin },
          metadata.client_id,
        ),
      ).toBeNull()
    },
  )

  it('keeps unconfigured public origins on the password path', () => {
    expect(
      oauthClientId(
        { hostname: 'benday.example', port: '', pathname: '/feed', origin: metadata.client_uri },
        null,
      ),
    ).toBeNull()
  })

  it('keeps loopback login independent of the hosted identity', () => {
    const location = {
      hostname: '127.0.0.1',
      port: '5173',
      pathname: '/notifications',
      origin: 'http://127.0.0.1:5173',
    }
    expect(oauthClientId(location, metadata.client_id)).toBe(loopbackClientId(location))
  })

  it.each([
    'http://benday.example',
    'https://benday.example/subpath',
    'https://benday.example/?query=1',
    'https://benday.example/#fragment',
    'https://user:password@benday.example',
    'https://benday.example:8443',
  ])('rejects an unusable deployment origin %s', (origin) => {
    expect(() => createOAuthClientMetadata(origin)).toThrow()
  })
})

describe('SDK fragment callback initialization', () => {
  const clients: BrowserOAuthClient[] = []
  const channels: { close: () => void }[] = []
  let originalUrl: string
  let originalHistoryState: unknown

  beforeEach(() => {
    originalUrl = location.href
    originalHistoryState = history.state
    sessionStorage.clear()
    vi.resetModules()
    vi.stubGlobal('crypto', webcrypto)

    // Only storage/channel I/O is isolated. The SDK's load, init, fragment
    // parser, callback validation and history cleanup all run unchanged.
    vi.stubGlobal(
      'BroadcastChannel',
      class extends EventTarget {
        readonly name: string
        postMessage = vi.fn()
        close = vi.fn()

        constructor(name: string) {
          super()
          this.name = name
          channels.push(this)
        }
      },
    )
    const database = Object.assign(new EventTarget(), { close: vi.fn() })
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const request: {
          result: typeof database
          onsuccess: (() => void) | null
        } = { result: database, onsuccess: null }
        // A missing state is rejected before any transaction or exchange.
        // Opening/closing succeeds, so no infrastructure error can stand in
        // for the callback validation asserted below.
        queueMicrotask(() => request.onsuccess?.())
        return request
      }),
    })
  })

  afterEach(async () => {
    try {
      for (const client of clients) await client.dispose()
    } finally {
      clients.length = 0
      for (const channel of channels) channel.close()
      channels.length = 0
      history.replaceState(originalHistoryState, '', originalUrl)
      sessionStorage.clear()
      localStorage.clear()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  async function initialize() {
    // These imports exercise the lazy SDK module-loading boundary after globals
    // are installed and give each case fresh Benday/SDK initialization state.
    const sdk = await import('@atproto/oauth-client-browser')
    const load = sdk.BrowserOAuthClient.load.bind(sdk.BrowserOAuthClient)
    vi.spyOn(sdk.BrowserOAuthClient, 'load').mockImplementation(async (options) => {
      const client = await load(options)
      clients.push(client)
      return client
    })
    return { sdk, oauth: await import('./oauth') }
  }

  it('reports a fragment callback error and consumes only the fragment', async () => {
    history.replaceState(null, '', '/feed?view=following#code=unused-test-code&state=')
    const { sdk, oauth } = await initialize()
    const outcome = oauth.restoreOAuth()

    await expect(outcome).rejects.toBeInstanceOf(sdk.OAuthCallbackError)
    expect(location.pathname).toBe('/feed')
    expect(location.search).toBe('?view=following')
    expect(location.hash).toBe('')
  })

  it('does not treat the same code/state in the query as a callback', async () => {
    history.replaceState(null, '', '/feed?code=unused-test-code&state=#keep-this-anchor')
    const { oauth } = await initialize()

    await expect(oauth.restoreOAuth()).resolves.toBeNull()
    expect(location.search).toBe('?code=unused-test-code&state=')
    expect(location.hash).toBe('#keep-this-anchor')
  })
})
