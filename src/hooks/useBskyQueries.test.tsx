import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchActorSearch, fetchFeedSearch, fetchThread } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import type { SearchActorModel, SearchFeedModel, ThreadModel } from '../lib/types'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { useActorSearch, useFeedSearch, useThread } from './useBskyQueries'

vi.mock('../lib/atproto', () => ({
  fetchActorSearch: vi.fn(),
  fetchFeedGenerator: vi.fn(),
  fetchFeedPage: vi.fn(),
  fetchFeedSearch: vi.fn(),
  fetchProfile: vi.fn(),
  fetchThread: vi.fn(),
}))

const THREAD_URI = 'at://did:plc:test/app.bsky.feed.post/1'

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

// lets any mount-time refetch reach the mocked transport before we assert
async function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 20)
  await promise
}

function threadFixture(): ThreadModel {
  return {
    focusUri: THREAD_URI,
    entries: [
      { post: postFixture({ uri: THREAD_URI, text: 'thread root' }), depth: 0, role: 'focus' },
    ],
  }
}

beforeEach(() => {
  vi.mocked(fetchThread).mockReset()
  vi.mocked(fetchActorSearch).mockReset()
  vi.mocked(fetchFeedSearch).mockReset()
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
})

describe('useThread', () => {
  it('reuses a cached thread until retried and keys it by owner', async () => {
    const queryClient = createTestQueryClient()
    vi.mocked(fetchThread).mockResolvedValue(threadFixture())

    const first = renderHook(() => useThread(THREAD_URI), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(first.result.current.data?.focusUri).toBe(THREAD_URI))
    expect(fetchThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchThread).mock.calls[0]).toEqual([THREAD_URI, null])

    first.unmount()

    const second = renderHook(() => useThread(THREAD_URI), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(second.result.current.data?.focusUri).toBe(THREAD_URI))
    // give any mount-time refetch a chance to fire before asserting it did not
    await act(settle)
    expect(fetchThread).toHaveBeenCalledTimes(1)

    await act(async () => {
      second.result.current.retry()
    })
    await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(2))

    // a different owner is a different key, so it resolves on its own
    await act(async () => {
      useAuthStore.setState({
        status: 'authenticated',
        account: { did: 'did:plc:alice', handle: 'alice.test' },
      })
    })
    await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(3))
    expect(vi.mocked(fetchThread).mock.calls[2]).toEqual([THREAD_URI, 'did:plc:alice'])
  })

  it('keeps the cached thread when a background refetch fails', async () => {
    const queryClient = createTestQueryClient()
    const key = ['thread', 'anonymous', THREAD_URI]
    queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY, retryDelay: 0 })
    queryClient.setQueryData(key, threadFixture(), { updatedAt: Date.now() - 60_000 })
    vi.mocked(fetchThread).mockRejectedValue(new Error('thread unavailable'))

    const { result } = renderHook(() => useThread(THREAD_URI), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(result.current.data?.focusUri).toBe(THREAD_URI))

    await act(async () => {
      result.current.retry()
    })
    await waitFor(() => expect(result.current.isFetching).toBe(false))

    expect(result.current.data?.focusUri).toBe(THREAD_URI)
    expect(result.current.error).toBeNull()
  })

  it('reports a first-load thread failure when nothing is cached', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryDefaults(['thread', 'anonymous', THREAD_URI], { retryDelay: 0 })
    vi.mocked(fetchThread).mockRejectedValue(new Error('thread unavailable'))

    const { result } = renderHook(() => useThread(THREAD_URI), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current.error?.message).toBe('thread unavailable'))
    expect(result.current.data).toBeNull()
  })
})

describe('search result hooks', () => {
  it('reports a failed rescan while keeping the actor rows', async () => {
    const queryClient = createTestQueryClient()
    const rows: SearchActorModel[] = [
      {
        did: 'did:plc:rocket',
        handle: 'rocket.test',
        displayName: 'rocketeer',
        avatar: null,
        description: '',
      },
    ]
    const key = ['search-actors', 'cats']
    queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY, retryDelay: 0 })
    queryClient.setQueryData(key, rows, { updatedAt: Date.now() - 60_000 })
    vi.mocked(fetchActorSearch).mockRejectedValue(new Error('rescan failed'))

    const { result } = renderHook(() => useActorSearch('cats'), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.error).toBeNull()

    await act(async () => {
      result.current.retry()
    })

    await waitFor(() => expect(result.current.error?.message).toBe('rescan failed'))
    expect(result.current.data).toEqual(rows)
    expect(result.current.isFetching).toBe(false)
    expect(vi.mocked(fetchActorSearch).mock.calls).toEqual([['cats']])
  })

  it('reports a failed rescan while keeping the feed rows', async () => {
    const queryClient = createTestQueryClient()
    const rows: SearchFeedModel[] = [
      {
        uri: 'at://did:plc:rocket/app.bsky.feed.generator/cats',
        displayName: 'all cats',
        creatorHandle: 'rocket.test',
        description: 'a feed of cats',
        likeCount: 3,
      },
    ]
    const key = ['search-feeds', 'cats']
    queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY, retryDelay: 0 })
    queryClient.setQueryData(key, rows, { updatedAt: Date.now() - 60_000 })
    vi.mocked(fetchFeedSearch).mockRejectedValue(new Error('rescan failed'))

    const { result } = renderHook(() => useFeedSearch('cats'), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.error).toBeNull()

    await act(async () => {
      result.current.retry()
    })

    await waitFor(() => expect(result.current.error?.message).toBe('rescan failed'))
    expect(result.current.data).toEqual(rows)
    expect(result.current.isFetching).toBe(false)
    expect(vi.mocked(fetchFeedSearch).mock.calls).toEqual([['cats']])
  })
})
