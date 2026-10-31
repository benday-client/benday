import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFeedPage } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import type { FeedSource, PostModel } from '../lib/types'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { usePostFeed } from './useBskyQueries'

vi.mock('../lib/atproto', () => ({
  fetchFeedPage: vi.fn(),
  fetchProfile: vi.fn(),
  fetchThread: vi.fn(),
}))

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function post(name: string): PostModel {
  return postFixture({ uri: `at://did:plc:test/app.bsky.feed.post/${name}`, text: name })
}

function page(names: string[], cursor: string | null) {
  return { posts: names.map(post), cursor }
}

const SEARCH: FeedSource = { kind: 'search', query: 'cats' }

const ALICE_DID = 'did:plc:alice'
const BRAVO_DID = 'did:plc:bravo'

function signedInAs(did: string): void {
  useAuthStore.setState({
    status: 'authenticated',
    account: { did, handle: `${did}.test` },
    pending: false,
    error: null,
  })
}

function anonymous(): void {
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
}

beforeEach(() => {
  vi.mocked(fetchFeedPage).mockReset()
  anonymous()
})

describe('usePostFeed', () => {
  it('reloads exactly one first page on refresh and leaves other keys alone', async () => {
    const queryClient = createTestQueryClient()
    const otherKey = ['feed', 'other.test', 'discover', 'anonymous']
    queryClient.setQueryDefaults(otherKey, { gcTime: Number.POSITIVE_INFINITY })
    queryClient.setQueryData(otherKey, { pages: [page(['other'], null)], pageParams: [undefined] })

    vi.mocked(fetchFeedPage)
      .mockResolvedValueOnce(page(['one'], 'c1'))
      .mockResolvedValueOnce(page(['two'], null))
      .mockResolvedValueOnce(page(['fresh'], null))

    const { result } = renderHook(() => usePostFeed(SEARCH), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current.data).toHaveLength(1))

    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(fetchFeedPage).toHaveBeenCalledTimes(2)

    await act(async () => {
      result.current.retry()
    })
    await waitFor(() => expect(fetchFeedPage).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(result.current.data?.map((entry) => entry.text)).toEqual(['fresh']))

    expect(queryClient.getQueryData(otherKey)).toBeDefined()
    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false)
  })

  it('does not refetch on remount, reconnect, focus or a labeler change', async () => {
    const queryClient = createTestQueryClient()
    vi.mocked(fetchFeedPage).mockResolvedValue(page(['one'], null))

    const first = renderHook(() => usePostFeed(SEARCH), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(first.result.current.data).toHaveLength(1))
    first.unmount()

    const second = renderHook(() => usePostFeed(SEARCH), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(second.result.current.data).toHaveLength(1))

    act(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('visibilitychange'))
      useSettings.setState({ labelers: ['did:plc:labeler'] })
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })

    expect(fetchFeedPage).toHaveBeenCalledTimes(1)
  })

  it('dedupes repeated posts and stops paging on a repeated cursor', async () => {
    const queryClient = createTestQueryClient()
    vi.mocked(fetchFeedPage)
      .mockResolvedValueOnce(page(['a', 'b'], 'c1'))
      .mockResolvedValueOnce(page(['b', 'c'], 'c1'))

    const { result } = renderHook(() => usePostFeed(SEARCH), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current.data).toHaveLength(2))

    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.data).toHaveLength(3))

    expect(result.current.data?.map((entry) => entry.text)).toEqual(['a', 'b', 'c'])
    expect(result.current.hasMore).toBe(false)

    await act(async () => {
      result.current.loadMore()
    })
    expect(fetchFeedPage).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed next page separate from a first-page failure', async () => {
    const queryClient = createTestQueryClient()
    vi.mocked(fetchFeedPage)
      .mockResolvedValueOnce(page(['one'], 'c1'))
      .mockRejectedValueOnce(new Error('next page failed'))
      .mockResolvedValueOnce(page(['two'], null))

    const { result } = renderHook(() => usePostFeed(SEARCH), { wrapper: wrapper(queryClient) })
    await waitFor(() => expect(result.current.data).toHaveLength(1))

    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.loadMoreError).toBe(true))
    expect(result.current.error).toBeNull()
    expect(result.current.data).toHaveLength(1)

    await act(async () => {
      result.current.retryLoadMore()
    })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(result.current.loadMoreError).toBe(false)
  })

  it('sends no request for an empty normalized source', async () => {
    const queryClient = createTestQueryClient()
    const author = renderHook(() => usePostFeed({ kind: 'author', actor: '   ' }), {
      wrapper: wrapper(queryClient),
    })
    const search = renderHook(() => usePostFeed({ kind: 'search', query: '  ' }), {
      wrapper: wrapper(queryClient),
    })
    const feed = renderHook(() => usePostFeed({ kind: 'feed', uri: ' ' }), {
      wrapper: wrapper(queryClient),
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(fetchFeedPage).not.toHaveBeenCalled()
    expect(author.result.current.isPending).toBe(false)
    expect(search.result.current.isPending).toBe(false)
    expect(feed.result.current.isPending).toBe(false)
  })

  it('reuses the cached key for a new source object with the same primitives', async () => {
    const queryClient = createTestQueryClient()
    vi.mocked(fetchFeedPage).mockResolvedValue(page(['one'], null))

    const { result, rerender } = renderHook(
      ({ source }: { source: FeedSource }) => usePostFeed(source),
      {
        wrapper: wrapper(queryClient),
        initialProps: { source: { kind: 'search', query: 'cats' } as FeedSource },
      },
    )
    await waitFor(() => expect(result.current.data).toHaveLength(1))

    rerender({ source: { kind: 'search', query: ' cats ' } as FeedSource })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(fetchFeedPage).toHaveBeenCalledTimes(1)
    expect(result.current.data).toHaveLength(1)
  })

  it.each<[string, FeedSource]>([
    ['author', { kind: 'author', actor: 'candidate.test' }],
    ['search', { kind: 'search', query: 'cats' }],
  ])('keeps %s pages attached to their viewer', async (_kind, source) => {
    if (source.kind !== 'author' && source.kind !== 'search') throw new Error('unexpected source')
    const queryClient = createTestQueryClient()
    const host = useSettings.getState().appView.host
    const keyFor = (owner: string): readonly unknown[] =>
      source.kind === 'author'
        ? ['feed', host, 'author', source.actor, owner]
        : ['feed', host, 'search', source.query, owner]
    for (const owner of [ALICE_DID, BRAVO_DID, 'anonymous']) {
      queryClient.setQueryDefaults(keyFor(owner), { gcTime: Number.POSITIVE_INFINITY })
    }

    vi.mocked(fetchFeedPage).mockImplementation(async (_target, _source, viewerDid, cursor) => {
      const owner = viewerDid ?? 'anonymous'
      if (cursor === undefined) return page([`${owner} first`], 'more')
      if (cursor === 'more') return page([`${owner} second`], null)
      return page([], null)
    })

    signedInAs(ALICE_DID)
    const { result } = renderHook(() => usePostFeed(source), { wrapper: wrapper(queryClient) })

    const texts = (): string[] | undefined => result.current.data?.map((entry) => entry.text)

    await waitFor(() => expect(texts()).toEqual([`${ALICE_DID} first`]))
    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(texts()).toEqual([`${ALICE_DID} first`, `${ALICE_DID} second`]))

    // anonymous never inherits A's loaded first page
    anonymous()
    await waitFor(() => expect(texts()).toEqual(['anonymous first']))
    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(texts()).toEqual(['anonymous first', 'anonymous second']))

    signedInAs(BRAVO_DID)
    await waitFor(() => expect(texts()).toEqual([`${BRAVO_DID} first`]))
    await act(async () => {
      result.current.loadMore()
    })
    await waitFor(() => expect(texts()).toEqual([`${BRAVO_DID} first`, `${BRAVO_DID} second`]))

    // returning to A resolves A's own chain; nothing was refetched or mixed
    signedInAs(ALICE_DID)
    await waitFor(() => expect(texts()).toEqual([`${ALICE_DID} first`, `${ALICE_DID} second`]))

    const firstPages = vi
      .mocked(fetchFeedPage)
      .mock.calls.filter(([, , , cursor]) => cursor === undefined)
      .map(([, , viewerDid]) => viewerDid ?? 'anonymous')
    expect(firstPages).toEqual([ALICE_DID, 'anonymous', BRAVO_DID])
  })
})
