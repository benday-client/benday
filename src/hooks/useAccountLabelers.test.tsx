import { QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { currentAccountLabelers } from '../lib/accountLabelers'
import { useAuthStore } from '../lib/auth'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import { useAccountLabelers } from './useAccountLabelers'

const PDS = 'https://pds.test'
const ALICE = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}
const BRAVO = {
  did: 'did:plc:bravo',
  handle: 'bravo.test',
  accessJwt: 'bravo-access',
  refreshJwt: 'bravo-refresh',
  active: true,
}
const LABELER_A = 'did:plc:labelera'
const LABELER_B = 'did:plc:labelerb'

let transport: TestTransport

function routeSession(): void {
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, (request) => {
    const identifier =
      request.body === null ? '' : (JSON.parse(request.body) as { identifier?: string }).identifier
    return jsonResponse(200, identifier?.includes('bravo') === true ? BRAVO : ALICE)
  })
}

function routeDiscovery(session: typeof ALICE): void {
  transport.route('GET', `https://plc.directory/${session.did}`, () =>
    jsonResponse(200, {
      id: session.did,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    }),
  )
}

function labelerPrefs(dids: string[]) {
  return jsonResponse(200, {
    preferences: [
      {
        $type: 'app.bsky.actor.defs#labelersPref',
        labelers: dids.map((did) => ({ did })),
      },
    ],
  })
}

function HookHost() {
  useAccountLabelers()
  return null
}

function mountHook(): () => void {
  const queryClient = createTestQueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <HookHost />
    </QueryClientProvider>,
  )
  return view.unmount
}

async function signIn(identifier: string, session: typeof ALICE): Promise<void> {
  routeDiscovery(session)
  const ok = await useAuthStore.getState().signIn(identifier, 'app-pass')
  expect(ok).toBe(true)
}

beforeEach(() => {
  transport = installTransport()
  routeSession()
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
})

describe('useAccountLabelers', () => {
  it('reads the signed-in account labelers and applies them', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
      labelerPrefs([LABELER_A, LABELER_B]),
    )
    await signIn(ALICE.did, ALICE)
    const unmount = mountHook()
    try {
      await waitFor(() => expect(currentAccountLabelers()).toEqual([LABELER_A, LABELER_B]))
    } finally {
      unmount()
    }
  })

  it('clears the previous account list before the next preferences answer', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
      labelerPrefs([LABELER_A]),
    )
    await signIn(ALICE.did, ALICE)
    const unmount = mountHook()
    try {
      await waitFor(() => expect(currentAccountLabelers()).toEqual([LABELER_A]))

      const gate = Promise.withResolvers<Response>()
      transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () => gate.promise)
      await signIn(BRAVO.did, BRAVO)

      // the switch empties the registry before the new fetch settles
      await waitFor(() => expect(currentAccountLabelers()).toEqual([]))

      gate.resolve(labelerPrefs([LABELER_B]))
      await waitFor(() => expect(currentAccountLabelers()).toEqual([LABELER_B]))
    } finally {
      unmount()
    }
  })

  it('leaves the empty list applied when the preference read fails', async () => {
    let calls = 0
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () => {
      calls += 1
      return jsonResponse(500, { error: 'InternalServerError', message: 'nope' })
    })
    await signIn(ALICE.did, ALICE)
    const unmount = mountHook()
    try {
      // the hook retries once, then reports nothing; an empty list is applied
      await waitFor(() => expect(calls).toBe(2), { timeout: 4000 })
      expect(currentAccountLabelers()).toEqual([])
    } finally {
      unmount()
    }
  })
})
