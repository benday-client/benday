import { describe, expect, it } from 'vitest'
import { loopbackClientId, oauthClientId } from './oauth'
import { createOAuthClientMetadata } from './oauthMetadata'

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
