import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { betaAccess } from '../lib/betaAccess'
import { installTransport, jsonResponse } from '../test/transport'
import AdminView from './AdminView'

const RESOLVE = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle'
const DID = 'did:plc:ym6n47hhl23xcx3hi7qncbh4'
const DIGEST = 'd804bbafd805d3011c0c0365f423940442d1dcd527287cabc7b9a154e88454c8'

beforeEach(() => {
  localStorage.clear()
})

function submit(identifier: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'handle or DID' }), {
    target: { value: identifier },
  })
  fireEvent.click(screen.getByRole('button', { name: 'mint an invite' }))
}

describe('admin invites', () => {
  it('resolves a handle into a DID invitation accepted by the membership consumer', async () => {
    const transport = installTransport()
    transport.route('GET', RESOLVE, (request) => {
      expect(new URL(request.url).searchParams.get('handle')).toBe('clarisse.test')
      return jsonResponse(200, { did: DID })
    })
    render(<AdminView />)

    submit(' @clarisse.test ')

    const digest = (await screen.findByLabelText('invitation digest')).textContent ?? ''
    const entry = screen.getByLabelText('invitation JSON entry').textContent ?? ''
    const parsed: unknown = JSON.parse(entry)
    expect(digest).toBe(DIGEST)
    expect(parsed).toBe(digest)
    if (typeof parsed !== 'string') throw new Error('expected a JSON string entry')
    const invitedAccount = { did: DID, handle: 'moved.test' }
    const otherAccount = { did: 'did:plc:someoneelse', handle: 'clarisse.test' }
    await expect(betaAccess({ sha256: [parsed] }, invitedAccount)).resolves.toBe('allowed')
    await expect(betaAccess({ sha256: [digest] }, otherAccount)).resolves.toBe('refused')
    expect(transport.calls).toHaveLength(1)
    expect(localStorage.length).toBe(0)
  })

  it('accepts a direct DID without a resolver request', async () => {
    const transport = installTransport()
    render(<AdminView />)

    submit(DID)

    expect(await screen.findByLabelText('invitation digest')).toHaveTextContent(DIGEST)
    expect(transport.calls).toEqual([])
  })

  it('clears the previous draft before a failed resolution instead of publishing it again', async () => {
    const transport = installTransport()
    transport.route('GET', RESOLVE, () => jsonResponse(400, { error: 'InvalidRequest' }))
    render(<AdminView />)
    submit(DID)
    await screen.findByLabelText('invitation digest')

    submit('missing.test')

    expect(screen.queryByLabelText('invitation digest')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByLabelText('invitation JSON entry')).not.toBeInTheDocument()
    expect(transport.calls).toHaveLength(1)
  })
})
