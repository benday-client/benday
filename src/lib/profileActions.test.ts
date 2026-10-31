import { AtpAgent } from '@atproto/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTransport, jsonResponse } from '../test/transport'
import { getAuthAgent } from './auth'
import { showReposts, unblock } from './profileActions'

vi.mock('./auth', () => ({
  getAuthAgent: vi.fn(),
}))

const OWN_DID = 'did:plc:me'
const BLOCK = 'app.bsky.graph.block'

let deleteRecord: ReturnType<typeof vi.fn>

beforeEach(() => {
  deleteRecord = vi.fn(async () => ({}))
  vi.mocked(getAuthAgent).mockReturnValue({
    did: OWN_DID,
    com: { atproto: { repo: { deleteRecord } } },
  } as unknown as AtpAgent)
})

describe('unblock', () => {
  it('deletes a block record from the signed-in repository', async () => {
    await unblock(`at://${OWN_DID}/${BLOCK}/abc123`)

    expect(deleteRecord).toHaveBeenCalledWith({
      repo: OWN_DID,
      collection: BLOCK,
      rkey: 'abc123',
    })
  })

  it.each([
    ['another repository', `at://did:plc:other/${BLOCK}/abc123`],
    ['another collection', `at://${OWN_DID}/app.bsky.feed.post/abc123`],
    ['an empty rkey', `at://${OWN_DID}/${BLOCK}/`],
    ['extra segments', `at://${OWN_DID}/${BLOCK}/abc123/extra`],
    ['a non-at scheme', `https://${OWN_DID}/${BLOCK}/abc123`],
  ])('refuses a record from %s', async (_label, uri) => {
    await expect(unblock(uri)).rejects.toThrow('invalid block record')
    expect(deleteRecord).not.toHaveBeenCalled()
  })
})

describe('showReposts', () => {
  it('keeps a quote-only scope by muting quotes instead of unmuting', async () => {
    const transport = installTransport()
    transport.route('POST', 'https://pds.test/xrpc/app.bsky.graph.muteActor', () =>
      jsonResponse(200, {}),
    )
    vi.mocked(getAuthAgent).mockReturnValue(new AtpAgent({ service: 'https://pds.test' }))

    await showReposts('did:plc:other', true)

    expect(transport.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /xrpc/app.bsky.graph.muteActor',
    ])
    expect(JSON.parse(transport.calls[0]?.body ?? '{}')).toEqual({
      actor: 'did:plc:other',
      onlyQuoteposts: true,
    })
  })

  it('unmutes the actor when no quote scope is hidden', async () => {
    const transport = installTransport()
    transport.route('POST', 'https://pds.test/xrpc/app.bsky.graph.unmuteActor', () =>
      jsonResponse(200, {}),
    )
    vi.mocked(getAuthAgent).mockReturnValue(new AtpAgent({ service: 'https://pds.test' }))

    await showReposts('did:plc:other', false)

    expect(transport.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /xrpc/app.bsky.graph.unmuteActor',
    ])
    expect(JSON.parse(transport.calls[0]?.body ?? '{}')).toEqual({ actor: 'did:plc:other' })
  })
})
