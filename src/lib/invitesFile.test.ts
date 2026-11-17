import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import invites from '../../public/beta/invites.json'
import { betaAccess } from './betaAccess'

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')
const SEEDS = [
  { did: 'did:plc:ym6n47hhl23xcx3hi7qncbh4', handle: 'clarisse.bsky.social' },
  { did: 'did:plc:vozlebyxjnieupdvt6kevsb2', handle: 'lexa.bsky.social' },
]

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shipped invitations', () => {
  it('contains exactly the independently hashed seed DIDs and allows both accounts', async () => {
    const expected: string[] = []
    for (const account of SEEDS) {
      const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(account.did))
      expected.push(
        Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      )
      await expect(betaAccess(invites, account)).resolves.toBe('allowed')
    }
    expect(invites).toEqual({ sha256: expected })
  })

  it('refuses another DID even when it takes an invited account’s handle', async () => {
    const account = { did: 'did:plc:uninvited', handle: SEEDS[0]?.handle }
    await expect(betaAccess(invites, account)).resolves.toBe('refused')
  })
})
