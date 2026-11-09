import { useQuery } from '@tanstack/react-query'
import { fetchPinnedFeeds } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { normalizeError } from '../lib/errors'
import type { PinnedFeedModel } from '../lib/types'

export interface PinnedFeedsState {
  feeds: PinnedFeedModel[]
  isPending: boolean
  isFetching: boolean
  error: Error | null
  reload: () => void
}

export function usePinnedFeeds(): PinnedFeedsState {
  const did = useAuthStore((state) => state.account?.did ?? null)

  const query = useQuery({
    queryKey: ['pinned-feeds', did],
    // the key captures the owner; the fetch refuses to run as another account
    queryFn: () => (did === null ? Promise.resolve<PinnedFeedModel[]>([]) : fetchPinnedFeeds(did)),
    enabled: did !== null,
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    feeds: query.data ?? [],
    isPending: did !== null && query.isPending,
    isFetching: did !== null && query.isFetching,
    error: did === null || query.data !== undefined ? null : normalizeError(query.error),
    reload: () => {
      void query.refetch()
    },
  }
}
