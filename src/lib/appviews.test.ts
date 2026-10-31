import { describe, expect, it } from 'vitest'
import {
  APPVIEW_PRESETS,
  appViewHostname,
  capabilitiesFor,
  DEFAULT_APPVIEW,
  isAppViewTarget,
  makeCustomAppView,
  normalizeAppViewHost,
  sameAppView,
  toAppViewTarget,
} from './appviews'
import type { AppViewPreset, AppViewTarget } from './types'

function requireTarget(target: AppViewTarget | null): AppViewTarget {
  if (target === null) throw new Error('expected an appview target')
  return target
}

function requirePreset(id: string): AppViewPreset {
  const preset = APPVIEW_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error(`missing appview preset: ${id}`)
  return preset
}

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

describe('appview targets', () => {
  it('exposes the three known appviews', () => {
    expect(APPVIEW_PRESETS.map((preset) => preset.id)).toEqual(['canonical', 'public', 'blacksky'])
    expect(DEFAULT_APPVIEW.host).toBe('https://api.bsky.app')
  })

  it('builds a custom target with a stable id', () => {
    const target = requireTarget(makeCustomAppView('api.example.com'))
    expect(target.id).toBe('custom:https://api.example.com')
    expect(target.label).toBe('api.example.com')
    expect(target.kind).toBe('custom')
    expect(appViewHostname(target)).toBe('api.example.com')
  })

  it('returns null for an invalid custom host', () => {
    expect(makeCustomAppView('https://api.example.com/path')).toBeNull()
  })

  it('knows the capabilities of presets and is optimistic about customs', () => {
    expect(capabilitiesFor(requirePreset('canonical'))).toEqual({ search: true, feeds: true })
    expect(capabilitiesFor(requirePreset('public'))).toEqual({ search: false, feeds: true })
    expect(capabilitiesFor(requirePreset('blacksky'))).toEqual({ search: false, feeds: true })

    const custom = requireTarget(makeCustomAppView('api.example.com'))
    expect(capabilitiesFor(custom)).toEqual({ search: true, feeds: true })
  })

  it('compares targets by host and strips capabilities from presets', () => {
    const target = toAppViewTarget(DEFAULT_APPVIEW)
    expect('capabilities' in target).toBe(false)
    expect(sameAppView(target, requireTarget(makeCustomAppView('api.bsky.app')))).toBe(true)
  })
})

describe('isAppViewTarget', () => {
  const valid = {
    id: 'custom:https://api.example.com',
    label: 'api.example.com',
    host: 'https://api.example.com',
    kind: 'custom',
    note: 'custom appview',
  }

  it('accepts a normalized target', () => {
    expect(isAppViewTarget(valid)).toBe(true)
  })

  it('rejects malformed or unnormalized targets', () => {
    expect(isAppViewTarget(null)).toBe(false)
    expect(isAppViewTarget('public')).toBe(false)
    expect(isAppViewTarget({ ...valid, host: 'api.example.com/' })).toBe(false)
    expect(isAppViewTarget({ ...valid, kind: 'bogus' })).toBe(false)
    expect(isAppViewTarget({ ...valid, label: '' })).toBe(false)
    expect(isAppViewTarget({ ...valid, id: 4 })).toBe(false)
  })
})
