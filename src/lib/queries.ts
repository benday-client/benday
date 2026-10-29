import type { QueryClient } from '@tanstack/react-query'

// feed decks only change on an explicit refresh
export function invalidateNonFeedQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== 'feed',
  })
}
