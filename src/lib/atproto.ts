import { AppBskyActorDefs, AppBskyFeedDefs, AtpAgent } from '@atproto/api'
import { getAuthAgent } from './auth'
import {
  flattenThread,
  mapFeedViewPost,
  mapPostView,
  mapProfile,
  replyContextFromPost,
} from './model'
import type {
  AppViewTarget,
  FeedSource,
  PinnedFeedModel,
  PostModel,
  ProfileModel,
  ThreadModel,
} from './types'

export const DISCOVER_FEED_URI =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'

const PAGE_LIMIT = 30

interface CursorParam {
  cursor?: string
}

function cursorParam(cursor: string | undefined): CursorParam {
  return cursor === undefined || cursor.length === 0 ? {} : { cursor }
}

function normalizeCursor(cursor: string | undefined): string | null {
  return cursor === undefined || cursor.length === 0 ? null : cursor
}

export function createAgent(target: AppViewTarget): AtpAgent {
  return new AtpAgent({ service: target.host })
}

async function attachReplyContexts(agent: AtpAgent, posts: PostModel[]): Promise<PostModel[]> {
  const missing = posts.filter(
    (post) => post.isReply && post.replyContext === null && post.replyParent !== null,
  )
  if (missing.length === 0) return posts

  const parentUris = [...new Set(missing.flatMap((post) => post.replyParent?.uri ?? []))]
  const parents = new Map<string, PostModel>()

  for (let index = 0; index < parentUris.length; index += 25) {
    try {
      const response = await agent.app.bsky.feed.getPosts({
        uris: parentUris.slice(index, index + 25),
      })
      for (const view of response.data.posts) parents.set(view.uri, mapPostView(view))
    } catch {
      return posts
    }
  }

  return posts.map((post) => {
    const parentUri = post.replyParent?.uri
    const parent = parentUri === undefined ? undefined : parents.get(parentUri)
    if (parent === undefined) return post
    return { ...post, replyContext: replyContextFromPost(parent) }
  })
}

export async function fetchFeedPage(
  target: AppViewTarget,
  source: FeedSource,
  cursor?: string,
  limit = PAGE_LIMIT,
): Promise<{ posts: PostModel[]; cursor: string | null }> {
  const agent = createAgent(target)

  switch (source.kind) {
    case 'discover': {
      const reader = getAuthAgent() ?? agent
      const response = await reader.app.bsky.feed.getFeed({
        feed: DISCOVER_FEED_URI,
        limit,
        ...cursorParam(cursor),
      })
      return {
        posts: response.data.feed.map(mapFeedViewPost),
        cursor: normalizeCursor(response.data.cursor),
      }
    }

    case 'author': {
      const response = await agent.app.bsky.feed.getAuthorFeed({
        actor: source.actor.replace(/^@/, ''),
        limit,
        filter: 'posts_with_replies',
        ...cursorParam(cursor),
      })
      return {
        posts: response.data.feed.map(mapFeedViewPost),
        cursor: normalizeCursor(response.data.cursor),
      }
    }

    case 'feed': {
      const reader = getAuthAgent() ?? agent
      const response = await reader.app.bsky.feed.getFeed({
        feed: source.uri,
        limit,
        ...cursorParam(cursor),
      })
      return {
        posts: response.data.feed.map(mapFeedViewPost),
        cursor: normalizeCursor(response.data.cursor),
      }
    }

    case 'search': {
      const response = await agent.app.bsky.feed.searchPosts({
        q: source.query,
        limit,
        sort: 'latest',
        ...cursorParam(cursor),
      })
      return {
        posts: await attachReplyContexts(agent, response.data.posts.map(mapPostView)),
        cursor: normalizeCursor(response.data.cursor),
      }
    }
  }
}

export interface ActorSuggestion {
  did: string
  handle: string
  displayName: string
  avatar: string | null
}

export async function fetchActorSuggestions(
  target: AppViewTarget,
  query: string,
): Promise<ActorSuggestion[]> {
  const agent = createAgent(target)
  const response = await agent.app.bsky.actor.searchActorsTypeahead({
    q: query,
    limit: 6,
  })
  return response.data.actors.map((actor) => ({
    did: actor.did,
    handle: actor.handle,
    displayName: actor.displayName ?? '',
    avatar: actor.avatar ?? null,
  }))
}

export function pinnedFeedUris(preferences: AppBskyActorDefs.Preferences): string[] {
  const uris: string[] = []
  for (const pref of preferences) {
    if (AppBskyActorDefs.isSavedFeedsPrefV2(pref)) {
      for (const item of pref.items) {
        if (item.type === 'feed' && item.pinned) uris.push(item.value)
      }
    } else if (AppBskyActorDefs.isSavedFeedsPref(pref)) {
      uris.push(...pref.pinned)
    }
  }
  return [...new Set(uris)]
}

export async function fetchTagSuggestions(target: AppViewTarget, query: string): Promise<string[]> {
  const agent = createAgent(target)

  try {
    const response = await agent.app.bsky.feed.searchPosts({
      q: `#${query}`,
      limit: 30,
      sort: 'latest',
    })

    const counts = new Map<string, number>()
    for (const post of response.data.posts.map(mapPostView)) {
      for (const facet of post.facets) {
        if (facet.feature.kind !== 'tag') continue
        const tag = facet.feature.tag
        if (!tag.toLowerCase().startsWith(query.toLowerCase())) continue
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }

    const tags = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([tag]) => tag)
      .slice(0, 6)
    return tags.length > 0 ? tags : [query]
  } catch {
    return query.length > 0 ? [query] : []
  }
}

export async function fetchPinnedFeeds(_target: AppViewTarget): Promise<PinnedFeedModel[]> {
  const agent = getAuthAgent()
  if (agent === null) return []

  const prefs = await agent.app.bsky.actor.getPreferences()
  const unique = pinnedFeedUris(prefs.data.preferences)
  if (unique.length === 0) return []

  const generators = new Map<string, AppBskyFeedDefs.GeneratorView>()
  try {
    // Keep the private pinned-feed URI list away from a user-selected custom
    // appview. The canonical appview already serves public generator metadata.
    const reader = agent.withProxy('bsky_appview', 'did:web:api.bsky.app')
    const response = await reader.app.bsky.feed.getFeedGenerators({
      feeds: unique,
    })
    for (const feed of response.data.feeds) generators.set(feed.uri, feed)
  } catch {
    // pinned uris still work when the appview cannot label them
  }

  return unique.map((uri) => {
    const generator = generators.get(uri)
    const fallbackName = uri.split('/').at(-1) ?? uri
    return {
      uri,
      name: generator?.displayName ?? fallbackName,
      description: generator?.description ?? '',
      avatar: generator?.avatar ?? null,
    }
  })
}

export async function fetchProfile(target: AppViewTarget, actor: string): Promise<ProfileModel> {
  const agent = createAgent(target)
  const response = await agent.app.bsky.actor.getProfile({ actor: actor.replace(/^@/, '') })
  return mapProfile(response.data)
}

export async function fetchThread(target: AppViewTarget, uri: string): Promise<ThreadModel> {
  const agent = createAgent(target)
  const response = await agent.app.bsky.feed.getPostThread({ uri, depth: 3, parentHeight: 6 })
  if (!AppBskyFeedDefs.isThreadViewPost(response.data.thread)) {
    throw new Error('thread unavailable')
  }
  return flattenThread(response.data.thread)
}

export async function fetchTopComments(target: AppViewTarget, uri: string): Promise<PostModel[]> {
  const agent = createAgent(target)
  const response = await agent.getPostThread({ uri, depth: 1, parentHeight: 0 })
  const thread = response.data.thread
  if (!AppBskyFeedDefs.isThreadViewPost(thread)) return []

  const replies = thread.replies ?? []
  return replies
    .filter(AppBskyFeedDefs.isThreadViewPost)
    .map((reply) => mapPostView(reply.post))
    .sort((left, right) => right.likeCount - left.likeCount)
    .slice(0, 3)
}
