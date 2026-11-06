import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPinnedFeeds, fetchTopComments } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import type { PinnedFeedModel } from '../lib/types'
import { createTestQueryClient } from '../test/queryClient'
import { usePinnedFeeds } from './usePinnedFeeds'
import { useTopComments } from './useTopComments'

vi.mock('../lib/atproto', () => ({
  fetchPinnedFeeds: vi.fn(),
  fetchProfile: vi.fn(),
  fetchThread: vi.fn(),
  fetchTopComments: vi.fn(),
}))

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const PINNED: PinnedFeedModel = {
  uri: 'at://did:plc:test/app.bsky.feed.generator/one',
  name: 'one',
  description: '',
  avatar: null,
  generatorDid: 'did:web:feeds.test',
  acceptsInteractions: false,
}

beforeEach(() => {
  vi.mocked(fetchPinnedFeeds).mockReset()
  vi.mocked(fetchTopComments).mockReset()
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
})

describe('useTopComments', () => {
  it('reports a failure only when there is nothing to show', async () => {
    vi.mocked(fetchTopComments).mockRejectedValue(new Error('comments failed'))
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useTopComments('at://post/1', true), {
      wrapper: wrapper(queryClient),
    })

    // the hooks retry once before reporting, and the default delay is a second
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 4000 })
    expect(result.current.error?.message).toBe('comments failed')
    expect(result.current.comments).toEqual([])
  })

  it('does not report pending for an enabled card without a usable uri', async () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useTopComments('', true), { wrapper: wrapper(queryClient) })

    expect(result.current.isPending).toBe(false)
    expect(result.current.comments).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchTopComments).not.toHaveBeenCalled()
  })

  it('reads nothing while the card is not asking', async () => {
    const queryClient = createTestQueryClient()

    renderHook(() => useTopComments('at://post/1', false), { wrapper: wrapper(queryClient) })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchTopComments).not.toHaveBeenCalled()
  })
})

describe('usePinnedFeeds', () => {
  const DID = 'did:plc:alice'

  function signIn(): void {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: DID, handle: 'alice.test' },
      pending: false,
      error: null,
    })
  }

  it('keeps cached feeds when an explicit refresh fails', async () => {
    signIn()
    const queryClient = createTestQueryClient()
    const key = ['pinned-feeds', DID]
    queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY, retryDelay: 0 })
    // seeded fresh, so only the explicit refresh can fail
    queryClient.setQueryData(key, [PINNED])
    vi.mocked(fetchPinnedFeeds).mockRejectedValue(new Error('pins unavailable'))

    const { result } = renderHook(() => usePinnedFeeds(), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current.feeds).toEqual([PINNED]))

    await act(async () => {
      result.current.reload()
    })
    await waitFor(() => expect(fetchPinnedFeeds).toHaveBeenCalled())

    expect(result.current.feeds).toEqual([PINNED])
    expect(result.current.error).toBeNull()
  })

  it('reports a first-load failure when nothing is cached', async () => {
    signIn()
    const queryClient = createTestQueryClient()
    queryClient.setQueryDefaults(['pinned-feeds', DID], { retryDelay: 0 })
    vi.mocked(fetchPinnedFeeds).mockRejectedValue(new Error('pins unavailable'))

    const { result } = renderHook(() => usePinnedFeeds(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.error?.message).toBe('pins unavailable'))
    expect(result.current.feeds).toEqual([])
  })
})
