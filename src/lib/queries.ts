import type { QueryClient } from '@tanstack/react-query'

// keys this helper deliberately leaves alone. a feed deck only changes on an
// explicit refresh; pinned-feed settings and the account labeler read are keyed
// by their own inputs, so a write elsewhere never makes them stale.
const STABLE_ROOTS: Readonly<Record<string, true>> = {
  feed: true,
  'pinned-feeds': true,
  'account-labelers': true,
}

/** Invalidates every read a write can change, without touching stable roots. */
export function invalidateNonFeedQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0]
      return typeof root !== 'string' || STABLE_ROOTS[root] !== true
    },
  })
}
