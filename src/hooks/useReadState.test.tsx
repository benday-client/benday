import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPinnedFeeds } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import type { PinnedFeedModel } from '../lib/types'
import { createTestQueryClient } from '../test/queryClient'
import { usePinnedFeeds } from './usePinnedFeeds'

vi.mock('../lib/atproto', () => ({
  fetchPinnedFeeds: vi.fn(),
  fetchProfile: vi.fn(),
  fetchThread: vi.fn(),
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
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
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
