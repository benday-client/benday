import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchActorSuggestions, fetchTagSuggestions } from '../lib/atproto'
import { createTestQueryClient } from '../test/queryClient'
import { useActorSuggestions } from './useActorSuggestions'
import { useTagSuggestions } from './useTagSuggestions'

vi.mock('../lib/atproto', () => ({
  fetchActorSuggestions: vi.fn(),
  fetchTagSuggestions: vi.fn(),
}))

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(fetchActorSuggestions).mockResolvedValue([
    { did: 'did:plc:ada', handle: 'ada.test', displayName: 'Ada', avatar: null },
  ])
  vi.mocked(fetchTagSuggestions).mockResolvedValue(['pho'])
})

describe('useActorSuggestions', () => {
  it('never answers a new token with the previous token result', async () => {
    const queryClient = createTestQueryClient()
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useActorSuggestions(query, true),
      { wrapper: wrapper(queryClient), initialProps: { query: 'ada' } },
    )

    expect(result.current.suggestions).toEqual([])
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1))

    // the second token arrives before the debounce settles
    rerender({ query: 'bea' })
    expect(result.current.suggestions).toEqual([])
    expect(result.current.isPending).toBe(true)

    // and it settles onto the next query only after the delay
    await waitFor(() =>
      expect(fetchActorSuggestions).toHaveBeenLastCalledWith(expect.anything(), 'bea'),
    )
  })

  it('exposes nothing while the hook is disabled', async () => {
    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useActorSuggestions('ada', false), {
      wrapper: wrapper(queryClient),
    })

    await waitFor(() => expect(fetchActorSuggestions).not.toHaveBeenCalled())
    expect(result.current.suggestions).toEqual([])
    expect(result.current.isPending).toBe(false)
  })
})

describe('useTagSuggestions', () => {
  it('clears the previous tag list as soon as the query moves', async () => {
    const queryClient = createTestQueryClient()
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useTagSuggestions(query, true),
      { wrapper: wrapper(queryClient), initialProps: { query: 'pho' } },
    )
    await waitFor(() => expect(result.current.tags).toEqual(['pho']))

    rerender({ query: 'banh' })
    expect(result.current.tags).toEqual([])
    expect(result.current.isPending).toBe(true)

    await waitFor(() =>
      expect(fetchTagSuggestions).toHaveBeenLastCalledWith(expect.anything(), 'banh'),
    )
  })
})
