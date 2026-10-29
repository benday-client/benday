import type { PinnedFeedModel } from './types'

export function chooseFeedUri(
  requested: string,
  authenticated: boolean,
  pinned: readonly PinnedFeedModel[],
): string {
  if (!authenticated) return ''
  if (requested.length > 0) return requested
  return pinned[0]?.uri ?? ''
}
