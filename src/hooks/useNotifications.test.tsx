import type { AppBskyNotificationListNotifications, AtpSessionData } from '@atproto/api'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../lib/auth'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import { useNotifications } from './useNotifications'

const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'
const POST = 'at://did:plc:me/app.bsky.feed.post/mine'
const PDS = 'https://pds.a.test'

const NEWEST = '2026-10-30T12:00:00.000Z'
const OLDER = '2026-10-29T12:00:00.000Z'

const ALICE: AtpSessionData = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

function wireNotification(overrides: Record<string, unknown> = {}) {
  return {
    uri: 'at://did:plc:actor/app.bsky.feed.post/1',
    cid: CID,
    author: { did: 'did:plc:actor', handle: 'actor.test' },
    reason: 'like',
    record: {
      $type: 'app.bsky.feed.like',
      subject: { uri: POST, cid: CID },
      createdAt: OLDER,
    },
    isRead: false,
    indexedAt: OLDER,
    ...overrides,
  } as AppBskyNotificationListNotifications.Notification
}

function hiddenNotification(indexedAt: string) {
  return wireNotification({
    author: { did: 'did:plc:muted', handle: 'muted.test', viewer: { muted: true } },
    indexedAt,
  })
}

function visibleNotification(indexedAt: string) {
  return wireNotification({
    uri: 'at://did:plc:ok/app.bsky.feed.post/3',
    author: { did: 'did:plc:ok', handle: 'ok.test' },
    indexedAt,
  })
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

let transport: TestTransport

beforeEach(async () => {
  transport = installTransport()
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, ALICE),
  )
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.deleteSession`, () =>
    jsonResponse(200, {}),
  )
  // subject hydration is best effort and these cases never read the preview
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getPosts`, () =>
    jsonResponse(200, { posts: [] }),
  )
  await useAuthStore.getState().signOut()
  transport.calls.length = 0
})

async function signIn(): Promise<void> {
  await expect(useAuthStore.getState().signIn(ALICE.handle, 'password', PDS)).resolves.toBe(true)
}

function seenBodies(): unknown[] {
  return transport.calls
    .filter((call) => call.url.includes('app.bsky.notification.updateSeen'))
    .map((call) => JSON.parse(call.body ?? '{}'))
}

describe('useNotifications', () => {
  it('renders only visible rows but advances the cursor to the hidden newest one', async () => {
    await signIn()
    transport.route('GET', `${PDS}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: [hiddenNotification(NEWEST), visibleNotification(OLDER)],
      }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.notification.updateSeen`, () =>
      jsonResponse(200, {}),
    )
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useNotifications(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    expect(result.current.notifications[0]?.indexedAt).toBe(OLDER)

    await waitFor(() => expect(seenBodies()).toEqual([{ seenAt: NEWEST }]))
  })

  it('still advances the cursor when every wire row is hidden', async () => {
    await signIn()
    transport.route('GET', `${PDS}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, { notifications: [hiddenNotification(NEWEST)] }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.notification.updateSeen`, () =>
      jsonResponse(200, {}),
    )
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useNotifications(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.notifications).toEqual([])
    await waitFor(() => expect(seenBodies()).toEqual([{ seenAt: NEWEST }]))
  })

  it('sends no seen request for a genuinely empty wire page', async () => {
    await signIn()
    transport.route('GET', `${PDS}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, { notifications: [] }),
    )
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useNotifications(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    // one macrotask is enough for a wrongly-sent seen request to be recorded
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 0)
    await promise
    expect(seenBodies()).toEqual([])
  })

  it('keeps the list and the server read snapshot when the seen update fails', async () => {
    await signIn()
    transport.route('GET', `${PDS}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, { notifications: [visibleNotification(OLDER)] }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.notification.updateSeen`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'nope' }),
    )
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useNotifications(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    await waitFor(() => expect(seenBodies()).toEqual([{ seenAt: OLDER }]))

    // the failed write must not mutate or hide the row
    expect(result.current.notifications[0]?.isRead).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.notifications[0]?.indexedAt).toBe(OLDER)
  })
})
