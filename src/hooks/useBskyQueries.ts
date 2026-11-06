import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  fetchActorSearch,
  fetchFeedGenerator,
  fetchFeedPage,
  fetchFeedSearch,
  fetchProfile,
  fetchThread,
} from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { normalizeError } from '../lib/errors'
import type {
  FeedSource,
  PostFeedState,
  PostModel,
  ProfileModel,
  QueryState,
  SearchActorModel,
  SearchFeedModel,
  ThreadModel,
} from '../lib/types'

const STALE_TIME = 45_000
// a thread stays in the cache long enough that reopening a post from a deck
// does not refetch every reply it already resolved
const THREAD_CACHE_TIME = 30 * 60_000
const FEED_STALE_TIME = Number.POSITIVE_INFINITY

interface FeedPage {
  posts: PostModel[]
  cursor: string | null
}

// handles and feed sources are typed loose in the palette; trim once so the
// key, the enabled test and the request all see the same string
function normalizeActor(actor: string): string {
  return actor.trim().replace(/^@/, '')
}

function feedKey(source: FeedSource, viewerDid: string | null): readonly unknown[] {
  switch (source.kind) {
    case 'discover':
      return ['feed', 'discover', viewerDid ?? 'anonymous']
    case 'author':
      return ['feed', 'author', source.actor, viewerDid ?? 'anonymous']
    case 'search':
      return ['feed', 'search', source.query, viewerDid ?? 'anonymous']
    case 'feed':
      return ['feed', 'feed', source.uri, viewerDid ?? 'anonymous']
  }
}

function feedEnabled(source: FeedSource): boolean {
  switch (source.kind) {
    case 'discover':
      return true
    case 'author':
      return source.actor.length > 0
    case 'search':
      return source.query.length > 0
    case 'feed':
      return source.uri.length > 0
  }
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

export function usePostFeed(source: FeedSource, enabled = true): PostFeedState {
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const queryClient = useQueryClient()

  const kind = source.kind
  const rawActor = source.kind === 'author' ? source.actor : ''
  const rawQuery = source.kind === 'search' ? source.query : ''
  const rawUri = source.kind === 'feed' ? source.uri : ''

  const normalized = useMemo<FeedSource>(() => {
    switch (kind) {
      case 'discover':
        return { kind: 'discover' }
      case 'author':
        return { kind: 'author', actor: normalizeActor(rawActor) }
      case 'search':
        return { kind: 'search', query: rawQuery.trim() }
      case 'feed':
        return { kind: 'feed', uri: rawUri.trim() }
    }
  }, [kind, rawActor, rawQuery, rawUri])

  const active = enabled && feedEnabled(normalized)
  const key = useMemo(() => feedKey(normalized, viewerDid), [normalized, viewerDid])

  // dropping the pages and letting the observer ask again reloads exactly one
  // first page; a plain refetch would walk every loaded page
  const refresh = useMemo(
    () => () => {
      void queryClient.resetQueries({ queryKey: key, exact: true })
    },
    [queryClient, key],
  )

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchFeedPage(normalized, viewerDid, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _pages, _lastPageParam, allPageParams) => {
      const next = lastPage.cursor
      if (next === null) return undefined
      return allPageParams.includes(next) ? undefined : next
    },
    enabled: active,
    staleTime: FEED_STALE_TIME,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    data: query.data ? flattenPosts(query.data.pages) : null,
    isPending: active ? query.isPending : false,
    isFetching: query.isFetching,
    // a failed next page keeps its loaded pages; only a failure with nothing
    // to show is a feed-level error
    error: query.data === undefined ? normalizeError(query.error) : null,
    retry: refresh,
    hasMore: active && query.hasNextPage && !query.isFetchNextPageError,
    isLoadingMore: query.isFetchingNextPage,
    loadMoreError: query.isFetchNextPageError,
    loadMore: () => {
      if (!active || !query.hasNextPage) return
      if (query.isFetchingNextPage || query.isFetchNextPageError) return
      void query.fetchNextPage()
    },
    retryLoadMore: () => {
      if (!active || !query.hasNextPage || query.isFetchingNextPage) return
      void query.fetchNextPage()
    },
  }
}

export function useProfile(actor: string): QueryState<ProfileModel> {
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const normalizedActor = normalizeActor(actor)
  const enabled = normalizedActor.length > 0

  const query = useQuery({
    // the viewer belongs to the key so one account's relationship state is
    // never served to another
    queryKey: ['profile', normalizedActor, viewerDid ?? 'anonymous'],
    queryFn: () => fetchProfile(normalizedActor, viewerDid),
    enabled,
    staleTime: STALE_TIME,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    data: query.data ?? null,
    isPending: enabled ? query.isPending : false,
    isFetching: query.isFetching,
    error: query.data === undefined ? normalizeError(query.error) : null,
    retry: () => {
      void query.refetch()
    },
  }
}

export function useActorSearch(query: string, enabled = true): QueryState<SearchActorModel[]> {
  const normalized = query.trim()
  const active = enabled && normalized.length > 0

  const result = useQuery({
    queryKey: ['search-actors', normalized],
    queryFn: () => fetchActorSearch(normalized),
    enabled: active,
    // search lists follow the feed policy: a mode switch reuses what the reader
    // already loaded and only an explicit retry asks the appview again
    staleTime: FEED_STALE_TIME,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    data: result.data ?? null,
    isPending: active ? result.isPending : false,
    isFetching: result.isFetching,
    // a failed rescan keeps the rows already on screen, so its error is
    // reported beside them instead of being hidden until the deck empties
    error: normalizeError(result.error),
    retry: () => {
      void result.refetch()
    },
  }
}

export function useFeedSearch(query: string, enabled = true): QueryState<SearchFeedModel[]> {
  const normalized = query.trim()
  const active = enabled && normalized.length > 0

  const result = useQuery({
    queryKey: ['search-feeds', normalized],
    queryFn: () => fetchFeedSearch(normalized),
    enabled: active,
    staleTime: FEED_STALE_TIME,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    data: result.data ?? null,
    isPending: active ? result.isPending : false,
    isFetching: result.isFetching,
    // same contract as actor search: retained rows plus a reported failure
    error: normalizeError(result.error),
    retry: () => {
      void result.refetch()
    },
  }
}

export interface FeedGeneratorState {
  did: string | null
  acceptsInteractions: boolean | null
}

export function useFeedGenerator(uri: string): FeedGeneratorState {
  const normalized = uri.trim()
  const active = normalized.length > 0

  const result = useQuery({
    // generator metadata is public and changes only when its record does, so a
    // long stale time keeps a deck from asking again on every mount
    queryKey: ['feed-generator', normalized],
    queryFn: () => fetchFeedGenerator(normalized),
    enabled: active,
    staleTime: FEED_STALE_TIME,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    did: result.data?.did ?? null,
    acceptsInteractions: result.data?.acceptsInteractions ?? null,
  }
}

export function useThread(uri: string): QueryState<ThreadModel> {
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const normalizedUri = uri.trim()
  const enabled = normalizedUri.length > 0

  const query = useQuery({
    // the owner belongs to the key so a delayed callback cannot read another
    // account's muted state for this thread
    queryKey: ['thread', viewerDid ?? 'anonymous', normalizedUri],
    queryFn: () => fetchThread(normalizedUri, viewerDid),
    enabled,
    staleTime: STALE_TIME,
    gcTime: THREAD_CACHE_TIME,
    retry: 1,
    // reopening a post reuses the thread the reader already has; an explicit
    // refresh or a reply of the reader's own still refetches it
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    data: query.data ?? null,
    isPending: enabled ? query.isPending : false,
    isFetching: query.isFetching,
    error: query.data === undefined ? normalizeError(query.error) : null,
    retry: () => {
      void query.refetch()
    },
  }
}
