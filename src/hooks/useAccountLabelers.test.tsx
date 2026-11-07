import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { currentAccountLabelers, setAccountLabelers } from '../lib/accountLabelers'
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

function mountHook(queryClient = createTestQueryClient()): () => void {
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

  it('never applies a late answer from the previous account', async () => {
    const first = Promise.withResolvers<Response>()
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () => first.promise)
    await signIn(ALICE.did, ALICE)
    // keep the old query alive after its observer moves on, so the late answer
    // really lands in the cache instead of being dropped with the query
    const queryClient = createTestQueryClient()
    queryClient.setQueryDefaults(['account-labelers'], {
      gcTime: Number.POSITIVE_INFINITY,
    })
    const unmount = mountHook(queryClient)
    try {
      first.resolve(labelerPrefs([LABELER_A]))
      await waitFor(() => expect(currentAccountLabelers()).toEqual([LABELER_A]))

      // a second read for the first account, still in flight across the switch
      let lateCalls = 0
      const late = Promise.withResolvers<Response>()
      transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () => {
        lateCalls += 1
        return late.promise
      })
      const refetch = queryClient.refetchQueries({ queryKey: ['account-labelers', ALICE.did] })
      await waitFor(() => expect(lateCalls).toBe(1))

      let nextCalls = 0
      const releaseNext = Promise.withResolvers<void>()
      transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, async () => {
        nextCalls += 1
        await releaseNext.promise
        return jsonResponse(500, { error: 'InternalServerError', message: 'nope' })
      })
      await signIn(BRAVO.did, BRAVO)

      // the switch empties the list before the new fetch can answer
      await waitFor(() => expect(currentAccountLabelers()).toEqual([]))

      // the first account's answer settles only now and must not land on this one
      late.resolve(labelerPrefs([LABELER_A]))
      await act(async () => {
        await refetch
      })
      // the answer did land in the first account's cache
      expect(queryClient.getQueryData(['account-labelers', ALICE.did])).toEqual([LABELER_A])
      // but the registry the next account's agents read stays empty
      expect(currentAccountLabelers()).toEqual([])

      // the new account's read fails, so the empty list stays applied
      releaseNext.resolve()
      await waitFor(() => expect(nextCalls).toBe(2), { timeout: 4000 })
      expect(currentAccountLabelers()).toEqual([])
    } finally {
      unmount()
    }
  })

  it('clears the list while signed out', async () => {
    setAccountLabelers(ALICE.did, [LABELER_A])
    const unmount = mountHook()
    try {
      await waitFor(() => expect(currentAccountLabelers()).toEqual([]))
    } finally {
      unmount()
    }
  })

  it('clears the registry on sign-out', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
      labelerPrefs([LABELER_A]),
    )
    transport.route('POST', `${PDS}/xrpc/com.atproto.server.deleteSession`, () =>
      jsonResponse(200, {}),
    )
    await signIn(ALICE.did, ALICE)
    const unmount = mountHook()
    try {
      await waitFor(() => expect(currentAccountLabelers()).toEqual([LABELER_A]))

      await useAuthStore.getState().signOut()

      await waitFor(() => expect(currentAccountLabelers()).toEqual([]))
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
