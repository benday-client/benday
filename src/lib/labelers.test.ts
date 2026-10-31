import { AtpAgent } from '@atproto/api'
import { beforeEach, describe, expect, it } from 'vitest'
import { installTransport, jsonResponse } from '../test/transport'
import { applyConfiguredLabelers } from './labelers'
import { useSettings } from './store'

const SERVICE = 'https://pds.test'
const VALID = 'did:plc:bendayvalidlabeler'

describe('applyConfiguredLabelers', () => {
  beforeEach(() => {
    useSettings.setState({ labelers: [] })
  })

  it('sends only the valid stored labelers in the outbound request header', async () => {
    const transport = installTransport()
    transport.route('GET', `${SERVICE}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, {
        did: 'did:plc:someone',
        handle: 'someone.test',
      }),
    )

    // live or persisted settings are untrusted: bad dids that the SDK would
    // reject must never reach the agent, which validates every entry
    useSettings.setState({
      labelers: [VALID, 'did:plc', 'did:plcabc', 'did:plc:', ' not-a-did '],
    })

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

  it('configures an agent with no labelers when every stored did is invalid', async () => {
    const transport = installTransport()
    transport.route('GET', `${SERVICE}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, { did: 'did:plc:someone', handle: 'someone.test' }),
    )

    useSettings.setState({ labelers: ['did:plc', 'did:plc:'] })

    const agent = new AtpAgent({ service: SERVICE })
    applyConfiguredLabelers(agent)
    await agent.app.bsky.actor.getProfile({ actor: 'someone.test' })

    const request = transport.calls.find((call) => call.url.includes('getProfile'))
    if (request === undefined) throw new Error('the profile request never left the agent')
    const header = request.headers['atproto-accept-labelers'] ?? ''
    expect(header.split(', ').filter((entry) => !entry.endsWith(';redact'))).toEqual([])
  })
})
