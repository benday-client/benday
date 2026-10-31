import { describe, expect, it } from 'vitest'
import { loopbackClientId } from './oauth'

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
