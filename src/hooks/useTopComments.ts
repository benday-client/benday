import { useQuery } from '@tanstack/react-query'
import { fetchTopComments } from '../lib/atproto'
import { useSettings } from '../lib/store'
import type { PostModel } from '../lib/types'

export interface TopCommentsState {
  comments: PostModel[]
  isPending: boolean
}

export function useTopComments(uri: string, enabled: boolean): TopCommentsState {
  const target = useSettings((state) => state.appView)
  const query = useQuery({
    queryKey: ['top-comments', target.host, uri],
    queryFn: () => fetchTopComments(target, uri),
    enabled: enabled && uri.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    comments: query.data ?? [],
    isPending: enabled && query.isPending,
  }
}
