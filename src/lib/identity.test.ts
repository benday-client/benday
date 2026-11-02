import { describe, expect, it } from 'vitest'
import { installTransport, jsonResponse } from '../test/transport'
import { resolveHandleDid } from './identity'

const RESOLVE = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle'

describe('resolveHandleDid', () => {
  it('passes a did through without asking the resolver', async () => {
    const transport = installTransport()

    await expect(resolveHandleDid('did:plc:alice')).resolves.toBe('did:plc:alice')
    await expect(resolveHandleDid('  @did:web:example.com  ')).resolves.toBe('did:web:example.com')
    expect(transport.calls).toEqual([])
  })

  it('trims and strips one leading @ before asking for a handle', async () => {
    const transport = installTransport()
    transport.route('GET', RESOLVE, (request) => {
      expect(new URL(request.url).searchParams.get('handle')).toBe('alice.test')
      return jsonResponse(200, { did: 'did:plc:alice' })
    })

    await expect(resolveHandleDid('  @alice.test ')).resolves.toBe('did:plc:alice')
    expect(transport.calls).toHaveLength(1)
  })

  it('rejects a failed or malformed answer instead of guessing an identity', async () => {
    const transport = installTransport()
    transport.route('GET', RESOLVE, () =>
      jsonResponse(400, { error: 'InvalidRequest', message: 'no such handle' }),
    )
    await expect(resolveHandleDid('nobody.test')).rejects.toThrow('could not resolve that handle')

    transport.route('GET', RESOLVE, () => jsonResponse(200, { did: 7 }))
    await expect(resolveHandleDid('nobody.test')).rejects.toThrow('could not resolve that handle')
  })
})
