import { useQuery } from '@tanstack/react-query'
import { fetchFeedPage } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { normalizeError } from '../lib/errors'
import { useSettings } from '../lib/store'
import type { FeedSource, PostModel } from '../lib/types'

const PREVIEW_LIMIT = 3
const STALE_TIME = 45_000

export interface FeedPreviewState {
  posts: PostModel[]
  isPending: boolean
  error: Error | null
}

export function useFeedPreview(source: FeedSource | null, enabled: boolean): FeedPreviewState {
  const target = useSettings((state) => state.appView)
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const active = enabled && source !== null

  const query = useQuery({
    queryKey: ['feed-preview', target.host, source, viewerDid],
    queryFn: () => {
      if (source === null) throw new Error('no feed preview source')
      return fetchFeedPage(target, source, viewerDid, undefined, PREVIEW_LIMIT)
    },
    enabled: active,
    staleTime: STALE_TIME,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    posts: query.data?.posts.slice(0, PREVIEW_LIMIT) ?? [],
    isPending: active && query.isPending,
    // cached posts stay visible; only an empty failure is an error surface
    error: query.data === undefined ? normalizeError(query.error) : null,
  }
}
