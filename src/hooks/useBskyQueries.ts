import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { fetchFeedPage, fetchProfile, fetchThread } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import type {
  AppViewTarget,
  FeedSource,
  PostFeedState,
  PostModel,
  ProfileModel,
  QueryState,
  ThreadModel,
} from '../lib/types'

const STALE_TIME = 45_000

interface FeedPage {
  posts: PostModel[]
  cursor: string | null
}

function feedKey(
  target: AppViewTarget,
  source: FeedSource,
  viewerDid: string | null,
): readonly unknown[] {
  switch (source.kind) {
    case 'discover':
      return ['feed', target.host, 'discover', viewerDid ?? 'anonymous']
    case 'author':
      return ['feed', target.host, 'author', source.actor]
    case 'search':
      return ['feed', target.host, 'search', source.query]
    case 'feed':
      return ['feed', target.host, 'feed', source.uri]
  }
}

function feedEnabled(source: FeedSource): boolean {
  switch (source.kind) {
    case 'discover':
      return true
    case 'author':
      return source.actor.replace(/^@/, '').trim().length > 0
    case 'search':
      return source.query.trim().length > 0
    case 'feed':
      return source.uri.trim().length > 0
  }
}

function normalizeError(error: unknown): Error | null {
  if (error === null || error === undefined) return null
  return error instanceof Error ? error : new Error(String(error))
}

function flattenPosts(pages: FeedPage[]): PostModel[] {
  const seen = new Set<string>()
  const posts: PostModel[] = []
  for (const page of pages) {
    for (const post of page.posts) {
      if (seen.has(post.uri)) continue
      seen.add(post.uri)
      posts.push(post)
    }
  }
  return posts
}

export function usePostFeed(source: FeedSource): PostFeedState {
  const target = useSettings((state) => state.appView)
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const enabled = feedEnabled(source)

  const query = useInfiniteQuery({
    queryKey: feedKey(target, source, viewerDid),
    queryFn: ({ pageParam }) => fetchFeedPage(target, source, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    enabled,
    staleTime: STALE_TIME,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    data: query.data ? flattenPosts(query.data.pages) : null,
    isPending: enabled ? query.isPending : false,
    isFetching: query.isFetching,
    error: normalizeError(query.error),
    retry: () => {
      void query.refetch()
    },
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (!query.hasNextPage || query.isFetchingNextPage) return
      void query.fetchNextPage()
    },
  }
}

export function useProfile(actor: string): QueryState<ProfileModel> {
  const target = useSettings((state) => state.appView)
  const normalizedActor = actor.replace(/^@/, '').trim()
  const enabled = normalizedActor.length > 0

  const query = useQuery({
    queryKey: ['profile', target.host, normalizedActor],
    queryFn: () => fetchProfile(target, normalizedActor),
    enabled,
    staleTime: STALE_TIME,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    data: query.data ?? null,
    isPending: enabled ? query.isPending : false,
    isFetching: query.isFetching,
    error: normalizeError(query.error),
    retry: () => {
      void query.refetch()
    },
  }
}

export function useThread(uri: string): QueryState<ThreadModel> {
  const target = useSettings((state) => state.appView)
  const normalizedUri = uri.trim()
  const enabled = normalizedUri.length > 0

  const query = useQuery({
    queryKey: ['thread', target.host, normalizedUri],
    queryFn: () => fetchThread(target, normalizedUri),
    enabled,
    staleTime: STALE_TIME,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    data: query.data ?? null,
    isPending: enabled ? query.isPending : false,
    isFetching: query.isFetching,
    error: normalizeError(query.error),
    retry: () => {
      void query.refetch()
    },
  }
}
