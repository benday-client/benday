import type { PinnedFeedModel } from './types'

/**
 * A requested feed is honored only when the account pinned it. Anything else
 * resolves to the first pinned feed, and an account with no pins has no feed.
 */
export function chooseFeedUri(requested: string, pinned: readonly PinnedFeedModel[]): string {
  if (requested.length > 0 && pinned.some((item) => item.uri === requested)) return requested
  return pinned[0]?.uri ?? ''
}
