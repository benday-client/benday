import type { QueryClient } from '@tanstack/react-query'

// keys this helper deliberately leaves alone. a feed deck only changes on an
// explicit refresh; pinned-feed settings, generator capability metadata and
// labeler detail are keyed by their own inputs, so a write elsewhere never
// makes them stale.
const STABLE_ROOTS: ReadonlySet<string> = new Set([
  'feed',
  'pinned-feeds',
  'feed-generator',
  'labeler-details',
])

/** Invalidates every read a write can change, without touching stable roots. */
export function invalidateNonFeedQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0]
      return typeof root !== 'string' || !STABLE_ROOTS.has(root)
    },
  })
}
