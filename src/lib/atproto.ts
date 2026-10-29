import { AppBskyFeedDefs, AtpAgent } from '@atproto/api'
import { flattenThread, mapFeedViewPost, mapPostView, mapProfile } from './model'
import type { AppViewTarget, FeedSource, PostModel, ProfileModel, ThreadModel } from './types'

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

export async function fetchFeedPage(
  target: AppViewTarget,
  source: FeedSource,
  cursor?: string,
): Promise<{ posts: PostModel[]; cursor: string | null }> {
  const agent = createAgent(target)

  switch (source.kind) {
    case 'discover': {
      const response = await agent.app.bsky.feed.getFeed({
        feed: DISCOVER_FEED_URI,
        limit: PAGE_LIMIT,
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
        limit: PAGE_LIMIT,
        filter: 'posts_with_replies',
        ...cursorParam(cursor),
      })
      return {
        posts: response.data.feed.map(mapFeedViewPost),
        cursor: normalizeCursor(response.data.cursor),
      }
    }

    case 'feed': {
      const response = await agent.app.bsky.feed.getFeed({
        feed: source.uri,
        limit: PAGE_LIMIT,
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
        limit: PAGE_LIMIT,
        sort: 'latest',
        ...cursorParam(cursor),
      })
      return {
        posts: response.data.posts.map(mapPostView),
        cursor: normalizeCursor(response.data.cursor),
      }
    }
  }
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
