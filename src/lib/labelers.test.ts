import { AtpAgent } from '@atproto/api'
import { beforeEach, describe, expect, it } from 'vitest'
import { installTransport, jsonResponse } from '../test/transport'
import { clearAccountLabelers, currentAccountLabelers, setAccountLabelers } from './accountLabelers'
import { applyConfiguredLabelers } from './labelers'

const SERVICE = 'https://pds.test'
const VALID = 'did:plc:bendayvalidlabeler'
const OTHER = 'did:plc:bendayotherlabeler'

describe('account labeler registry', () => {
  beforeEach(() => {
    clearAccountLabelers()
  })

  it('keeps valid unique dids in order', () => {
    setAccountLabelers('did:plc:alice', [VALID, 'did:plc', VALID, OTHER, 'not-a-did'])
    expect(currentAccountLabelers()).toEqual([VALID, OTHER])
  })

  it('clears when the owner changes before a new list arrives', () => {
    setAccountLabelers('did:plc:alice', [VALID])
    setAccountLabelers('did:plc:bravo', [])
    expect(currentAccountLabelers()).toEqual([])
  })

  it('clears on demand', () => {
    setAccountLabelers('did:plc:alice', [VALID])
    clearAccountLabelers()
    expect(currentAccountLabelers()).toEqual([])
  })
})

describe('applyConfiguredLabelers', () => {
  beforeEach(() => {
    clearAccountLabelers()
  })

  it('sends only the valid account labelers in the outbound request header', async () => {
    const transport = installTransport()
    transport.route('GET', `${SERVICE}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, {
        did: 'did:plc:someone',
        handle: 'someone.test',
      }),
    )

    // the registry sanitizes at its boundary; the wire predicate still guards
    // the header, which the SDK validates for every entry
    setAccountLabelers('did:plc:alice', [VALID, 'did:plc', 'did:plcabc', 'did:plc:'])

    const agent = new AtpAgent({ service: SERVICE })
    expect(() => applyConfiguredLabelers(agent)).not.toThrow()

    await agent.app.bsky.actor.getProfile({ actor: 'someone.test' })

    const request = transport.calls.find((call) => call.url.includes('getProfile'))
    if (request === undefined) throw new Error('the profile request never left the agent')
    const header = request.headers['atproto-accept-labelers']
    if (header === undefined) throw new Error('no labelers header was sent')

    // the app's own redacting labelers stay, ours is appended, and nothing the
    // sdk would reject is serialized onto the wire
    const configured = header.split(', ').filter((entry) => !entry.endsWith(';redact'))
    expect(configured).toEqual([VALID])
  })

  it('configures an agent with no labelers when the registry is empty', async () => {
    const transport = installTransport()
    transport.route('GET', `${SERVICE}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, { did: 'did:plc:someone', handle: 'someone.test' }),
    )

    const agent = new AtpAgent({ service: SERVICE })
    applyConfiguredLabelers(agent)
    await agent.app.bsky.actor.getProfile({ actor: 'someone.test' })

    const request = transport.calls.find((call) => call.url.includes('getProfile'))
    if (request === undefined) throw new Error('the profile request never left the agent')
    const header = request.headers['atproto-accept-labelers'] ?? ''
    expect(header.split(', ').filter((entry) => !entry.endsWith(';redact'))).toEqual([])
  })
})
