import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { betaAccess, inviteDigest, loadBetaInvites, resetBetaInvites } from './betaAccess'

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
const LISTED = 'd804bbafd805d3011c0c0365f423940442d1dcd527287cabc7b9a154e88454c8'
const DID = 'did:plc:ym6n47hhl23xcx3hi7qncbh4'

beforeEach(() => {
  resetBetaInvites()
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('betaAccess', () => {
  it('hashes the exact DID without normalization or a prefix', async () => {
    await expect(inviteDigest(DID)).resolves.toBe(LISTED)
    for (const did of [DID.toUpperCase(), ` ${DID}`, `${DID} `]) {
      const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(did))
      const expected = Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      await expect(inviteDigest(did)).resolves.toBe(expected)
      await expect(betaAccess({ sha256: [LISTED] }, { did })).resolves.toBe('refused')
    }
  })

  it('refuses everyone when the valid list is empty', async () => {
    await expect(betaAccess({ sha256: [] }, { did: DID })).resolves.toBe('refused')
  })

  it('fails closed when the list could not be read', async () => {
    await expect(betaAccess(null, { did: DID })).resolves.toBe('unreadable')
  })

  it('fails closed when hashing fails', async () => {
    vi.spyOn(webcrypto.subtle, 'digest').mockRejectedValueOnce(new Error('crypto unavailable'))
    await expect(betaAccess({ sha256: [LISTED] }, { did: DID })).resolves.toBe('unreadable')
  })
})

describe('loadBetaInvites', () => {
  it('loads a valid empty list only once per page', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"sha256":[]}'))
    vi.stubGlobal('fetch', fetch)
    const first = loadBetaInvites()
    expect(loadBetaInvites()).toBe(first)
    await expect(first).resolves.toEqual({ sha256: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    null,
    {},
    { dids: [LISTED], handles: [] },
    { sha256: 'not an array' },
    { sha256: [LISTED, 12] },
    { sha256: [LISTED, ''] },
    { sha256: [LISTED.toUpperCase()] },
    { sha256: ['a'.repeat(63)] },
    { sha256: ['g'.repeat(64)] },
  ])('rejects malformed invitation data: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    await expect(loadBetaInvites()).resolves.toBeNull()
  })

  it.each([
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve(new Response('unavailable', { status: 503 })),
    () => Promise.resolve(new Response('{')),
  ])('fails closed on an unreadable response', async (fetch) => {
    vi.stubGlobal('fetch', fetch)
    await expect(loadBetaInvites()).resolves.toBeNull()
  })
})
