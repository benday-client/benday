import { describe, expect, it } from 'vitest'
import { normalizeAppViewHost } from './appviews'

describe('normalizeAppViewHost', () => {
  it('accepts bare hosts and normalizes them to https origins', () => {
    expect(normalizeAppViewHost('api.example.com')).toBe('https://api.example.com')
    expect(normalizeAppViewHost('https://api.example.com/')).toBe('https://api.example.com')
    expect(normalizeAppViewHost('  HTTPS://API.EXAMPLE.COM  ')).toBe('https://api.example.com')
  })

  it('allows http only on loopback', () => {
    expect(normalizeAppViewHost('http://localhost:2583')).toBe('http://localhost:2583')
    expect(normalizeAppViewHost('http://127.0.0.1:2584/')).toBe('http://127.0.0.1:2584')
    expect(normalizeAppViewHost('http://api.example.com')).toBeNull()
  })

  it('allows http on the ipv6 loopback and only there', () => {
    expect(normalizeAppViewHost('http://[::1]:2583')).toBe('http://[::1]:2583')
    // every expanded spelling normalizes to the same bracketed loopback host
    expect(normalizeAppViewHost('http://[0:0:0:0:0:0:0:1]:2583')).toBe('http://[::1]:2583')
    expect(normalizeAppViewHost('http://[::2]:2583')).toBeNull()
    expect(normalizeAppViewHost('http://0.0.0.0:2583')).toBeNull()
    expect(normalizeAppViewHost('http://[2001:db8::1]:2583')).toBeNull()
    expect(normalizeAppViewHost('https://[::1]:2583')).toBe('https://[::1]:2583')
  })

  it('rejects unsafe or ambiguous urls', () => {
    expect(normalizeAppViewHost('')).toBeNull()
    expect(normalizeAppViewHost('ftp://api.example.com')).toBeNull()
    expect(normalizeAppViewHost('https://user:pass@api.example.com')).toBeNull()
    expect(normalizeAppViewHost('https://api.example.com/some/path')).toBeNull()
    expect(normalizeAppViewHost('https://api.example.com?x=1')).toBeNull()
    expect(normalizeAppViewHost('https://api.example.com#frag')).toBeNull()
    expect(normalizeAppViewHost('not a host')).toBeNull()
  })
})
