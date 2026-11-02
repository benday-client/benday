import { useQuery } from '@tanstack/react-query'
import { fetchTopComments } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { normalizeError } from '../lib/errors'
import { useSettings } from '../lib/store'
import type { PostModel } from '../lib/types'

export interface TopCommentsState {
  comments: PostModel[]
  isPending: boolean
  error: Error | null
}

export function useTopComments(uri: string, enabled: boolean): TopCommentsState {
  const target = useSettings((state) => state.appView)
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  // an enabled card without a usable uri has nothing to ask for: it is not
  // pending, sends no request, and exposes no cached row from another key
  const active = enabled && uri.length > 0
  const query = useQuery({
    // the owner belongs to the key so one account's hidden authors never
    // answer another account's card
    queryKey: ['top-comments', target.host, viewerDid ?? 'anonymous', uri],
    queryFn: () => fetchTopComments(target, uri, viewerDid),
    enabled: active,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    comments: active ? (query.data ?? []) : [],
    isPending: active && query.isPending,
    error: active && query.data === undefined ? normalizeError(query.error) : null,
  }
}
