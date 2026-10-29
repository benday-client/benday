import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFeedPage } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { postFixture } from '../test/fixtures'
import { usePostFeed } from './useBskyQueries'

vi.mock('../lib/atproto', () => ({
  fetchFeedPage: vi.fn(async () => ({ posts: [postFixture()], cursor: null })),
  fetchProfile: vi.fn(),
  fetchThread: vi.fn(),
}))

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('usePostFeed', () => {
  beforeEach(() => {
    vi.mocked(fetchFeedPage).mockClear()
    useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  })

  it('does not refetch cached pages until refresh is requested', async () => {
    const queryClient = new QueryClient()
    const first = renderHook(() => usePostFeed({ kind: 'discover' }), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(first.result.current.data).toHaveLength(1))
    expect(fetchFeedPage).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = renderHook(() => usePostFeed({ kind: 'discover' }), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(second.result.current.data).toHaveLength(1))
    expect(fetchFeedPage).toHaveBeenCalledTimes(1)

    act(() => {
      second.result.current.retry()
    })
    await waitFor(() => expect(fetchFeedPage).toHaveBeenCalledTimes(2))
  })
})
