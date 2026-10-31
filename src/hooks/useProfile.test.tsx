import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProfile } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { profileFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { useProfile } from './useBskyQueries'

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

function profileWithFollowing(uri: string | null) {
  return profileFixture({
    viewer: {
      following: uri,
      followedBy: null,
      muted: false,
      mutedOnlyReposts: false,
      mutedOnlyQuoteposts: false,
      blocking: null,
      blockedBy: false,
      activitySubscription: null,
    },
  })
}

beforeEach(() => {
  vi.mocked(fetchProfile).mockReset()
  useAuthStore.setState({
    status: 'authenticated',
    account: { did: 'did:plc:alice', handle: 'alice.test' },
    pending: false,
    error: null,
  })
})

describe('useProfile', () => {
  it('never serves one account viewer state to the next', async () => {
    const queryClient = createTestQueryClient()
    const host = useSettings.getState().appView.host
    // keep both account-keyed entries alive so the test can compare them
    queryClient.setQueryDefaults(['profile', host, 'target.test', 'did:plc:alice'], {
      gcTime: Number.POSITIVE_INFINITY,
    })
    queryClient.setQueryDefaults(['profile', host, 'target.test', 'did:plc:bravo'], {
      gcTime: Number.POSITIVE_INFINITY,
    })
    vi.mocked(fetchProfile).mockResolvedValue(profileWithFollowing('at://follow/alice'))

    const { result, rerender } = renderHook(() => useProfile('@target.test'), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(result.current.data?.viewer.following).toBe('at://follow/alice')

    const gate = Promise.withResolvers<ReturnType<typeof profileWithFollowing>>()
    vi.mocked(fetchProfile).mockReturnValueOnce(gate.promise)
    await act(async () => {
      useAuthStore.setState({
        account: { did: 'did:plc:bravo', handle: 'bravo.test' },
      })
    })
    rerender()

    expect(vi.mocked(fetchProfile).mock.calls.at(-1)?.[2]).toBe('did:plc:bravo')
    expect(result.current.data).toBeNull()

    await act(async () => {
      gate.resolve(profileWithFollowing(null))
    })

    expect(
      queryClient.getQueryData(['profile', host, 'target.test', 'did:plc:alice']),
    ).toMatchObject({
      viewer: { following: 'at://follow/alice' },
    })
    expect(
      queryClient.getQueryData(['profile', host, 'target.test', 'did:plc:bravo']),
    ).toBeDefined()
  })

  it('reads the anonymous key when nobody is signed in', async () => {
    const queryClient = createTestQueryClient()
    vi.mocked(fetchProfile).mockResolvedValue(profileFixture())

    await act(async () => {
      useAuthStore.setState({ status: 'anonymous', account: null })
    })

    const { result } = renderHook(() => useProfile('target.test'), {
      wrapper: wrapper(queryClient),
    })
    await waitFor(() => expect(result.current.data).not.toBeNull())

    expect(vi.mocked(fetchProfile).mock.calls.at(-1)?.[2]).toBeNull()
  })

  it('keeps the last good profile when a background refetch fails', async () => {
    const queryClient = createTestQueryClient()
    const host = useSettings.getState().appView.host
    const key = ['profile', host, 'target.test', 'did:plc:alice']
    queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY, retryDelay: 0 })
    queryClient.setQueryData(key, profileWithFollowing('at://follow/alice'), {
      updatedAt: Date.now() - 60_000,
    })
    vi.mocked(fetchProfile).mockRejectedValue(new Error('profile unavailable'))

    const { result } = renderHook(() => useProfile('@target.test'), {
      wrapper: wrapper(queryClient),
    })

    // the stale entry refreshes on mount; the failure stays in the background
    await waitFor(() => expect(fetchProfile).toHaveBeenCalled())
    await waitFor(() => expect(result.current.isFetching).toBe(false))

    expect(result.current.data?.viewer.following).toBe('at://follow/alice')
    expect(result.current.error).toBeNull()
  })

  it('reports a first-load failure when nothing is cached', async () => {
    const queryClient = createTestQueryClient()
    const host = useSettings.getState().appView.host
    queryClient.setQueryDefaults(['profile', host, 'target.test', 'did:plc:alice'], {
      retryDelay: 0,
    })
    vi.mocked(fetchProfile).mockRejectedValue(new Error('profile unavailable'))

    const { result } = renderHook(() => useProfile('@target.test'), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(result.current.error?.message).toBe('profile unavailable'))
    expect(result.current.data).toBeNull()
  })
})
