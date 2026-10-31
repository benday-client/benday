import { DISCOVER_FEED_URI } from './atproto'
import type { FeedSource, PinnedFeedModel } from './types'

export interface FeedbackTarget {
  feed: string
  generatorDid: string
}

/**
 * Feedback goes to the generator service that served the feed, addressed by its
 * `#bsky_fg` service DID through the reader's pds. A generator that explicitly
 * refuses interactions gets none; an omitted capability stays available because
 * only an explicit false is a refusal. A feed with no generator did has no
 * service to address and stays silent.
 */
export function feedbackTargetFor(
  source: FeedSource,
  pinnedFeeds: readonly PinnedFeedModel[],
  discover: { did: string | null; acceptsInteractions: boolean | null },
): FeedbackTarget | null {
  if (source.kind === 'discover') {
    if (discover.did === null || discover.acceptsInteractions === false) return null
    return { feed: DISCOVER_FEED_URI, generatorDid: discover.did }
  }
  if (source.kind !== 'feed') return null

  const match = pinnedFeeds.find((item) => item.uri === source.uri)
  if (match === undefined || match.generatorDid === null) return null
  if (match.acceptsInteractions === false) return null
  return { feed: match.uri, generatorDid: match.generatorDid }
}
