import type { FeedSource, PinnedFeedModel } from './types'

export interface FeedbackTarget {
  feed: string
  generatorDid: string
}

/**
 * Feedback goes to the generator service that served a pinned feed, addressed
 * by its `#bsky_fg` service DID through the reader's pds. A generator that
 * explicitly refuses interactions gets none; an omitted capability stays
 * available because only an explicit false is a refusal. A source that is not
 * a pinned feed, or has no generator did, has no service to address.
 */
export function feedbackTargetFor(
  source: FeedSource | null,
  pinnedFeeds: readonly PinnedFeedModel[],
): FeedbackTarget | null {
  if (source === null || source.kind !== 'feed') return null

  const match = pinnedFeeds.find((item) => item.uri === source.uri)
  if (match === undefined || match.generatorDid === null) return null
  if (match.acceptsInteractions === false) return null
  return { feed: match.uri, generatorDid: match.generatorDid }
}
