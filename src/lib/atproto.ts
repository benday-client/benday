import { AppBskyActorDefs, AppBskyFeedDefs, AppBskyLabelerDefs, AtpAgent } from '@atproto/api'
import { DEFAULT_APPVIEW, toAppViewTarget } from './appviews'
import { getAuthAgent, requireViewerAgent } from './auth'
import { applyConfiguredLabelers } from './labelers'
import {
  flattenThread,
  hidesAuthor,
  mapAuthor,
  mapFeedViewPost,
  mapPostView,
  mapProfile,
  mapProfileViewer,
  postAuthorDids,
  pruneHiddenPost,
  replyContextFromPost,
  threadAuthorDids,
} from './model'
import type {
  AppViewTarget,
  FeedSource,
  PinnedFeedModel,
  PostModel,
  ProfileModel,
  SearchActorModel,
  SearchFeedModel,
  ThreadModel,
} from './types'

export const DISCOVER_FEED_URI =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'

const PAGE_LIMIT = 30

// generator metadata is public, but it is read from the canonical appview so a
// custom host never learns which feed the reader is asking about
const PUBLIC_APPVIEW: AppViewTarget = toAppViewTarget(DEFAULT_APPVIEW)

interface CursorParam {
  cursor?: string
}

/** a muted or blocked author, or a repost by one, does not enter the deck */
function visibleFeedView(view: AppBskyFeedDefs.FeedViewPost): boolean {
  if (hidesAuthor(mapAuthor(view.post.author))) return false
  if (view.reason !== undefined && AppBskyFeedDefs.isReasonRepost(view.reason)) {
    return !hidesAuthor(mapAuthor(view.reason.by))
  }
  return true
}

function cursorParam(cursor: string | undefined): CursorParam {
  return cursor === undefined || cursor.length === 0 ? {} : { cursor }
}

function normalizeCursor(cursor: string | undefined): string | null {
  return cursor === undefined || cursor.length === 0 ? null : cursor
}

export function createAgent(target: AppViewTarget): AtpAgent {
  const agent = new AtpAgent({ service: target.host })
  applyConfiguredLabelers(agent)
  return agent
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
      for (const view of response.data.posts) {
        const parent = mapPostView(view)
        if (hidesAuthor(parent.author)) continue
        parents.set(view.uri, parent)
      }
    } catch {
      // one failed batch keeps the contexts the other batches already resolved
    }
  }

  return posts.map((post) => {
    const parentUri = post.replyParent?.uri
    const parent = parentUri === undefined ? undefined : parents.get(parentUri)
    if (parent === undefined) return post
    return { ...post, replyContext: replyContextFromPost(parent) }
  })
}

/**
 * Search, thread and comment responses are read through a sessionless agent, so
 * their author views carry no viewer state. Ask the account's canonical appview
 * which of those authors it hides instead. A failed batch is best effort.
 */
async function hiddenAuthorDids(
  viewerDid: string | null,
  dids: readonly string[],
): Promise<Set<string>> {
  const hidden = new Set<string>()
  if (viewerDid === null) return hidden

  const reader = requireViewerAgent(viewerDid).withProxy('bsky_appview', 'did:web:api.bsky.app')
  const unique = [...new Set(dids)]

  for (let index = 0; index < unique.length; index += 25) {
    try {
      const response = await reader.app.bsky.actor.getProfiles({
        actors: unique.slice(index, index + 25),
      })
      for (const profile of response.data.profiles) {
        const view = profile.viewer
        if (
          view?.muted === true ||
          view?.mutedByList != null ||
          view?.blocking != null ||
          view?.blockingByList != null ||
          view?.blockedBy === true
        ) {
          hidden.add(profile.did)
        }
      }
    } catch {
      // a batch the appview cannot answer keeps its posts visible
    }
  }

  return hidden
}

async function dropHiddenAuthors(
  viewerDid: string | null,
  posts: readonly PostModel[],
): Promise<PostModel[]> {
  if (viewerDid === null || posts.length === 0) return [...posts]
  const dids: string[] = []
  for (const post of posts) dids.push(...postAuthorDids(post))
  const hidden = await hiddenAuthorDids(viewerDid, dids)
  if (hidden.size === 0) return [...posts]

  const kept: PostModel[] = []
  for (const post of posts) {
    // a repost by a hidden account is not re-exposed as an original post
    if (hidden.has(post.author.did)) continue
    if (post.reason?.type === 'repost' && hidden.has(post.reason.by.did)) continue
    kept.push(pruneHiddenPost(post, hidden))
  }
  return kept
}

export async function fetchFeedPage(
  target: AppViewTarget,
  source: FeedSource,
  viewerDid: string | null,
  cursor?: string,
  limit = PAGE_LIMIT,
): Promise<{ posts: PostModel[]; cursor: string | null }> {
  switch (source.kind) {
    case 'discover': {
      // a signed-in viewer uses its own agent so JWT-gated feeds can answer;
      // a null owner is public-only and never borrows the current account
      const reader = viewerDid === null ? createAgent(target) : requireViewerAgent(viewerDid)
      const response = await reader.app.bsky.feed.getFeed({
        feed: DISCOVER_FEED_URI,
        limit,
        ...cursorParam(cursor),
      })
      return {
        posts: await dropHiddenAuthors(
          viewerDid,
          response.data.feed.filter(visibleFeedView).map(mapFeedViewPost),
        ),
        cursor: normalizeCursor(response.data.cursor),
      }
    }

    case 'author': {
      const agent = createAgent(target)
      const response = await agent.app.bsky.feed.getAuthorFeed({
        actor: source.actor.replace(/^@/, ''),
        limit,
        filter: 'posts_with_replies',
        ...cursorParam(cursor),
      })
      return {
        posts: await dropHiddenAuthors(
          viewerDid,
          response.data.feed.filter(visibleFeedView).map(mapFeedViewPost),
        ),
        cursor: normalizeCursor(response.data.cursor),
      }
    }

    case 'feed': {
      const reader = viewerDid === null ? createAgent(target) : requireViewerAgent(viewerDid)
      const response = await reader.app.bsky.feed.getFeed({
        feed: source.uri,
        limit,
        ...cursorParam(cursor),
      })
      return {
        posts: await dropHiddenAuthors(
          viewerDid,
          response.data.feed.filter(visibleFeedView).map(mapFeedViewPost),
        ),
        cursor: normalizeCursor(response.data.cursor),
      }
    }

    case 'search': {
      const agent = createAgent(target)
      const response = await agent.app.bsky.feed.searchPosts({
        q: source.query,
        limit,
        sort: 'latest',
        ...cursorParam(cursor),
      })
      return {
        posts: await dropHiddenAuthors(
          viewerDid,
          await attachReplyContexts(
            agent,
            response.data.posts.map(mapPostView).filter((post) => !hidesAuthor(post.author)),
          ),
        ),
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

export async function fetchActorSearch(
  target: AppViewTarget,
  query: string,
  limit = 25,
): Promise<SearchActorModel[]> {
  const agent = createAgent(target)
  const response = await agent.app.bsky.actor.searchActors({ q: query, limit })
  return response.data.actors.map((actor) => ({
    did: actor.did,
    handle: actor.handle,
    displayName: actor.displayName ?? '',
    avatar: actor.avatar ?? null,
    description: actor.description ?? '',
  }))
}

export async function fetchFeedSearch(
  target: AppViewTarget,
  query: string,
): Promise<SearchFeedModel[]> {
  const agent = createAgent(target)
  // the unspecced endpoint is the only public feed-generator search in the SDK;
  // its `query` parameter filters by text, so it is a real search, not a guess
  const response = await agent.app.bsky.unspecced.getPopularFeedGenerators({ query, limit: 25 })
  return response.data.feeds.map((feed) => ({
    uri: feed.uri,
    displayName: feed.displayName,
    creatorHandle: feed.creator.handle,
    description: feed.description ?? '',
    likeCount: feed.likeCount ?? 0,
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

export async function fetchLabelerPrefs(): Promise<string[]> {
  const agent = getAuthAgent()
  if (agent === null) return []
  const prefs = await agent.clone().app.bsky.actor.getPreferences()
  const dids: string[] = []
  for (const pref of prefs.data.preferences) {
    if (AppBskyActorDefs.isLabelersPref(pref)) {
      for (const labeler of pref.labelers) dids.push(labeler.did)
    }
  }
  return [...new Set(dids)]
}

export interface LabelerSummary {
  did: string
  handle: string
  displayName: string
  description: string
  avatar: string | null
  labelCount: number
}

export async function fetchLabelerSummaries(
  target: AppViewTarget,
  dids: readonly string[],
): Promise<LabelerSummary[]> {
  if (dids.length === 0) return []
  const agent = createAgent(target)
  const response = await agent.app.bsky.labeler.getServices({ dids: [...dids], detailed: true })
  const summaries: LabelerSummary[] = []

  for (const view of response.data.views) {
    if (!AppBskyLabelerDefs.isLabelerViewDetailed(view)) continue
    summaries.push({
      did: view.creator.did,
      handle: view.creator.handle,
      displayName:
        view.creator.displayName !== undefined && view.creator.displayName.length > 0
          ? view.creator.displayName
          : view.creator.handle,
      description: view.creator.description ?? '',
      avatar: view.creator.avatar ?? null,
      labelCount: view.policies.labelValues.length,
    })
  }

  return summaries
}

export async function fetchPinnedFeeds(viewerDid: string): Promise<PinnedFeedModel[]> {
  const agent = requireViewerAgent(viewerDid)

  const prefs = await agent.clone().app.bsky.actor.getPreferences()
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
      generatorDid: generator?.did ?? null,
      // the lexicon field is optional: absent metadata is "not stated", so it
      // must stay unknown rather than turn into a refusal; only an explicit
      // false disables feedback for the pinned feed
      acceptsInteractions: generator?.acceptsInteractions ?? null,
    }
  })
}

export interface FeedGeneratorInfo {
  did: string | null
  acceptsInteractions: boolean | null
}

/**
 * The generator view names the service that serves the feed and whether it
 * accepts feedback. A feed without a view has no target, so the failure is
 * reported as absent metadata rather than thrown.
 */
export async function fetchFeedGenerator(uri: string): Promise<FeedGeneratorInfo> {
  if (uri.length === 0) return { did: null, acceptsInteractions: null }
  const agent = createAgent(PUBLIC_APPVIEW)
  try {
    const response = await agent.app.bsky.feed.getFeedGenerator({ feed: uri })
    const view = response.data.view
    return {
      did: view.did.length === 0 ? null : view.did,
      acceptsInteractions: view.acceptsInteractions ?? null,
    }
  } catch {
    return { did: null, acceptsInteractions: null }
  }
}

export async function fetchProfile(
  target: AppViewTarget,
  actor: string,
  viewerDid: string | null,
): Promise<ProfileModel> {
  const normalized = actor.replace(/^@/, '')
  const reader = createAgent(target)

  // a null owner is public-only: the appview's own viewer field is anonymous
  if (viewerDid === null) {
    const response = await reader.app.bsky.actor.getProfile({ actor: normalized })
    return mapProfile(response.data)
  }

  // bind the private read to the key's owner before either request starts
  const viewer = requireViewerAgent(viewerDid)
  const privateReader = viewer.withProxy('bsky_appview', 'did:web:api.bsky.app')
  const [publicResponse, privateResponse] = await Promise.all([
    reader.app.bsky.actor.getProfile({ actor: normalized }),
    privateReader.app.bsky.actor.getProfile({ actor: normalized }),
  ])

  if (publicResponse.data.did !== privateResponse.data.did) {
    throw new Error('profile identity did not match')
  }

  return {
    ...mapProfile(publicResponse.data),
    viewer: mapProfileViewer(privateResponse.data.viewer ?? null),
  }
}

export async function fetchThread(
  target: AppViewTarget,
  uri: string,
  viewerDid: string | null,
): Promise<ThreadModel> {
  const agent = createAgent(target)
  const response = await agent.app.bsky.feed.getPostThread({ uri, depth: 3, parentHeight: 6 })
  if (!AppBskyFeedDefs.isThreadViewPost(response.data.thread)) {
    throw new Error('thread unavailable')
  }
  const raw = response.data.thread
  // resolve canonical moderation for the whole raw tree before flattening so
  // hidden ancestors, replies and quote authors never enter the model
  const hidden = await hiddenAuthorDids(viewerDid, threadAuthorDids(raw))
  return flattenThread(raw, hidden)
}

export async function fetchTopComments(
  target: AppViewTarget,
  uri: string,
  viewerDid: string | null,
): Promise<PostModel[]> {
  const agent = createAgent(target)
  const response = await agent.getPostThread({ uri, depth: 1, parentHeight: 0 })
  const thread = response.data.thread
  if (!AppBskyFeedDefs.isThreadViewPost(thread)) return []

  const replies = thread.replies ?? []
  const posts = replies
    .filter(AppBskyFeedDefs.isThreadViewPost)
    .map((reply) => mapPostView(reply.post))
    .filter((post) => !hidesAuthor(post.author))

  return (await dropHiddenAuthors(viewerDid, posts))
    .sort((left, right) => right.likeCount - left.likeCount)
    .slice(0, 3)
}
