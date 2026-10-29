import { useQuery } from '@tanstack/react-query'
import { fetchPinnedFeeds } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import type { PinnedFeedModel } from '../lib/types'

export interface PinnedFeedsState {
  feeds: PinnedFeedModel[]
  isPending: boolean
}

export function usePinnedFeeds(): PinnedFeedsState {
  const target = useSettings((state) => state.appView)
  const did = useAuthStore((state) => state.account?.did ?? null)

  const query = useQuery({
    queryKey: ['pinned-feeds', target.host, did],
    queryFn: () => fetchPinnedFeeds(target),
    enabled: did !== null,
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    feeds: query.data ?? [],
    isPending: did !== null && query.isPending,
  }
}
