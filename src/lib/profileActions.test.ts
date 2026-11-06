import type { AtpSessionData } from '@atproto/api'
import { AtpAgent } from '@atproto/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestTransport } from '../test/transport'
import { installTransport, jsonResponse } from '../test/transport'
import { getAuthAgent } from './auth'
import { unblock } from './profileActions'
import { isRecord } from './records'

vi.mock('./auth', () => ({
  getAuthAgent: vi.fn(),
}))

const PDS = 'https://pds.test'
const OWN_DID = 'did:plc:me'
const BLOCK = 'app.bsky.graph.block'
const DELETE_RECORD = '/xrpc/com.atproto.repo.deleteRecord'

let transport: TestTransport

function signedInAgent(): AtpAgent {
  const agent = new AtpAgent({ service: PDS })
  const session: AtpSessionData = {
    accessJwt: 'access',
    refreshJwt: 'refresh',
    handle: 'me.bsky.social',
    did: OWN_DID,
    active: true,
  }
  agent.sessionManager.session = session
  return agent
}

function signedIn(): void {
  vi.mocked(getAuthAgent).mockReturnValue(signedInAgent())
}

function parseBody(body: string | null): unknown {
  if (body === null) throw new Error('request carried no body')
  return JSON.parse(body)
}

beforeEach(() => {
  vi.mocked(getAuthAgent).mockReset()
  transport = installTransport()
})

describe('unblock', () => {
  it('deletes a block record from the signed-in repository', async () => {
    transport.route('POST', `${PDS}${DELETE_RECORD}`, () => jsonResponse(200, {}))
    signedIn()

    await unblock(`at://${OWN_DID}/${BLOCK}/abc123`)

    expect(transport.calls).toHaveLength(1)
    const [call] = transport.calls
    expect(call?.method).toBe('POST')
    expect(new URL(call?.url ?? '').pathname).toBe(DELETE_RECORD)
    expect(call?.headers['authorization']).toBe('Bearer access')
    const body = parseBody(call?.body ?? null)
    if (!isRecord(body)) throw new Error('deleteRecord body is not an object')
    expect(body).toEqual({ repo: OWN_DID, collection: BLOCK, rkey: 'abc123' })
  })

  it.each([
    ['another repository', `at://did:plc:other/${BLOCK}/abc123`],
    ['another collection', `at://${OWN_DID}/app.bsky.feed.post/abc123`],
    ['an empty rkey', `at://${OWN_DID}/${BLOCK}/`],
    ['extra segments', `at://${OWN_DID}/${BLOCK}/abc123/extra`],
    ['a non-at scheme', `https://${OWN_DID}/${BLOCK}/abc123`],
  ])('refuses a record from %s without touching the wire', async (_label, uri) => {
    signedIn()

    await expect(unblock(uri)).rejects.toThrow('invalid block record')
    expect(transport.calls).toEqual([])
  })
})
