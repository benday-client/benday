import type { AppBskyEmbedRecord, AppBskyFeedPost } from '@atproto/api'
import { AppBskyFeedDefs, RichText } from '@atproto/api'
import { getAuthAgent } from './auth'
import { parseMarkdown } from './markdown'
import type { PostModel } from './types'

export interface ViewerState {
  likeUri: string | null
  repostUri: string | null
}

export interface WriteResult {
  uri: string
  cid: string
}

export type FeedFeedbackEvent = 'more' | 'less'

const VIEWER_BATCH = 25
const APPVIEW_PROXY = {
  serviceType: 'bsky_appview',
  did: 'did:web:api.bsky.app',
} as const

function requireAgent() {
  const agent = getAuthAgent()
  if (agent === null) throw new Error('sign in to write')
  return agent
}

async function preparedText(text: string): Promise<RichText> {
  const parsed = parseMarkdown(text)
  const rich = new RichText({ text: parsed.text })
  if (rich.text.length > 0) await rich.detectFacets(requireAgent())
  rich.facets = [...parsed.facets, ...(rich.facets ?? [])]
  return rich
}

function applyFacets(record: Partial<AppBskyFeedPost.Record>, rich: RichText): void {
  if (rich.facets !== undefined) record.facets = rich.facets
}

export async function likePost(post: Pick<PostModel, 'uri' | 'cid'>): Promise<WriteResult> {
  const result = await requireAgent().like(post.uri, post.cid)
  return { uri: result.uri, cid: result.cid }
}

export async function unlikePost(likeUri: string): Promise<void> {
  await requireAgent().deleteLike(likeUri)
}

export async function repostPost(post: Pick<PostModel, 'uri' | 'cid'>): Promise<WriteResult> {
  const result = await requireAgent().repost(post.uri, post.cid)
  return { uri: result.uri, cid: result.cid }
}

export async function unrepostPost(repostUri: string): Promise<void> {
  await requireAgent().deleteRepost(repostUri)
}

export async function deletePost(uri: string): Promise<void> {
  const agent = requireAgent()
  const accountDid = agent.did
  if (accountDid === undefined) throw new Error('sign in to write')

  const parts = uri.split('/')
  const [scheme, authority, repo, collection, rkey] = parts
  if (
    parts.length !== 5 ||
    scheme !== 'at:' ||
    authority !== '' ||
    collection !== 'app.bsky.feed.post' ||
    repo === undefined ||
    repo !== accountDid ||
    rkey === undefined ||
    rkey.length === 0
  ) {
    throw new Error('invalid post uri')
  }

  await agent.com.atproto.repo.deleteRecord({ repo, collection, rkey })
}

export async function createPost(text: string): Promise<WriteResult> {
  const rich = await preparedText(text)
  const record: Partial<AppBskyFeedPost.Record> = { text: rich.text }
  applyFacets(record, rich)
  return requireAgent().post(record)
}

export async function createReply(text: string, post: PostModel): Promise<WriteResult> {
  const rich = await preparedText(text)
  const parent = { uri: post.uri, cid: post.cid }
  const root = post.replyRoot ?? parent
  const record: Partial<AppBskyFeedPost.Record> = {
    text: rich.text,
    reply: { root, parent },
  }
  applyFacets(record, rich)
  return requireAgent().post(record)
}

export async function createQuote(text: string, post: PostModel): Promise<WriteResult> {
  const rich = await preparedText(text)
  const embed: AppBskyEmbedRecord.Main = {
    $type: 'app.bsky.embed.record',
    record: { uri: post.uri, cid: post.cid },
  }
  const record: Partial<AppBskyFeedPost.Record> = {
    text: rich.text,
    embed,
  }
  applyFacets(record, rich)
  return requireAgent().post(record)
}

export async function sendFeedFeedback(
  feedUri: string,
  post: PostModel,
  event: FeedFeedbackEvent,
): Promise<void> {
  const agent = requireAgent()
  const interaction: AppBskyFeedDefs.Interaction = {
    $type: 'app.bsky.feed.defs#interaction',
    item: post.uri,
    event: event === 'more' ? AppBskyFeedDefs.REQUESTMORE : AppBskyFeedDefs.REQUESTLESS,
  }
  if (post.feedContext !== undefined) interaction.feedContext = post.feedContext
  if (post.reqId !== undefined) interaction.reqId = post.reqId

  await agent.app.bsky.feed.sendInteractions({
    feed: feedUri,
    interactions: [interaction],
  })
}

export async function fetchViewerStates(
  uris: readonly string[],
): Promise<Map<string, ViewerState>> {
  const agent = requireAgent()
  const appView = agent.withProxy(APPVIEW_PROXY.serviceType, APPVIEW_PROXY.did)
  const unique = [...new Set(uris)]
  const states = new Map<string, ViewerState>()

  for (let index = 0; index < unique.length; index += VIEWER_BATCH) {
    const batch = unique.slice(index, index + VIEWER_BATCH)
    const response = await appView.app.bsky.feed.getPosts({ uris: batch })
    for (const post of response.data.posts) {
      states.set(post.uri, {
        likeUri: post.viewer?.like ?? null,
        repostUri: post.viewer?.repost ?? null,
      })
    }
  }

  return states
}
