import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import invites from '../../public/beta/invites.json'
import {
  betaAccess,
  inviteDigest,
  loadBetaInvites,
  parseBetaInvites,
  resetBetaInvites,
} from './betaAccess'

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
const DID = 'did:plc:ym6n47hhl23xcx3hi7qncbh4'
// computed here so a change to the shipped list cannot break this test
const LISTED = Array.from(
  new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(DID))),
  (byte) => byte.toString(16).padStart(2, '0'),
).join('')

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
      await expect(inviteDigest(did)).resolves.not.toBe(LISTED)
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

describe('shipped invitations', () => {
  it('reads the one list the app ships', () => {
    expect(parseBetaInvites(invites)).not.toBeNull()
  })
})
