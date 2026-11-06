import type { AppBskyFeedPost, AppBskyRichtextFacet, AtpBaseClient } from '@atproto/api'
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

type WireFacet = AppBskyRichtextFacet.Main
type NavigationFeature =
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string }

interface ResolvedFeature {
  start: number
  end: number
  feature: NavigationFeature
}

function asNavigation(feature: WireFacet['features'][number]): NavigationFeature | null {
  if ('uri' in feature) return { $type: 'app.bsky.richtext.facet#link', uri: feature.uri }
  if ('did' in feature) return { $type: 'app.bsky.richtext.facet#mention', did: feature.did }
  if ('tag' in feature) return { $type: 'app.bsky.richtext.facet#tag', tag: feature.tag }
  return null
}

function featureKey(feature: NavigationFeature): string {
  if ('did' in feature) return `mention:${feature.did}`
  if ('uri' in feature) return `link:${feature.uri}`
  return `tag:${feature.tag}`
}

// an unresolved mention arrives with an empty did and must not reach the wire
function isUsableFeature(feature: NavigationFeature): boolean {
  return !('did' in feature) || feature.did.trim().length > 0
}

/**
 * Wire facets allow overlaps that benday's renderer handles, but the two
 * sources disagree: an explicit labelled link must win over an autodetected
 * navigation span, and a navigation span can never be split. Only links,
 * mentions and tags reach the wire; style features are never produced.
 */
function canonicalFacets(
  explicitFacets: readonly WireFacet[],
  detectedFacets: readonly WireFacet[],
): WireFacet[] {
  const navigation: ResolvedFeature[] = []

  const collect = (facets: readonly WireFacet[], explicit: boolean) => {
    const explicitLinks: ResolvedFeature[] = []
    const automatic: ResolvedFeature[] = []

    for (const facet of facets) {
      const start = facet.index.byteStart
      const end = facet.index.byteEnd
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue
      if (start < 0 || end <= start) continue

      const seen = new Set<string>()
      for (const raw of facet.features) {
        const feature = asNavigation(raw)
        if (feature === null) continue
        const key = featureKey(feature)
        if (seen.has(key)) continue
        seen.add(key)
        if (!isUsableFeature(feature)) continue

        const resolved = { start, end, feature }
        if (explicit && feature.$type === 'app.bsky.richtext.facet#link') {
          explicitLinks.push(resolved)
        } else {
          automatic.push(resolved)
        }
      }
    }

    navigation.push(...explicitLinks, ...automatic)
  }

  collect(explicitFacets, true)
  collect(detectedFacets, false)

  const selected: ResolvedFeature[] = []
  for (const candidate of navigation) {
    const overlaps = selected.some(
      (span) => candidate.start < span.end && span.start < candidate.end,
    )
    if (!overlaps) selected.push(candidate)
  }
  selected.sort((left, right) => left.start - right.start || left.end - right.end)

  return selected.map((span) => ({
    index: { byteStart: span.start, byteEnd: span.end },
    features: [span.feature],
  }))
}

function requireAgent() {
  const agent = getAuthAgent()
  if (agent === null) throw new Error('sign in to write')
  return agent
}

function requireSameAgent(agent: AtpBaseClient): void {
  if (getAuthAgent() !== agent) throw new Error('account changed before the post could be sent')
}

async function preparedText(text: string, agent: AtpBaseClient): Promise<RichText> {
  const parsed = parseMarkdown(text)
  const rich = new RichText({ text: parsed.text })
  if (rich.text.length > 0) await rich.detectFacets(agent)
  rich.facets = canonicalFacets(parsed.facets, rich.facets ?? [])
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
  const agent = requireAgent()
  const rich = await preparedText(text, agent)
  requireSameAgent(agent)
  const record: Partial<AppBskyFeedPost.Record> = { text: rich.text }
  applyFacets(record, rich)
  return agent.post(record)
}

export async function createReply(text: string, post: PostModel): Promise<WriteResult> {
  const agent = requireAgent()
  const rich = await preparedText(text, agent)
  requireSameAgent(agent)
  const parent = { uri: post.uri, cid: post.cid }
  const root = post.replyRoot ?? parent
  const record: Partial<AppBskyFeedPost.Record> = {
    text: rich.text,
    reply: { root, parent },
  }
  applyFacets(record, rich)
  return agent.post(record)
}

export async function sendFeedFeedback(
  feedUri: string,
  generatorDid: string,
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

  // interactions belong to the feed generator service, not the appview: the
  // pds resolves this did's `#bsky_fg` endpoint and forwards the call there
  const feedgen = agent.withProxy('bsky_fg', generatorDid)
  await feedgen.app.bsky.feed.sendInteractions({
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

  const batches: string[][] = []
  for (let index = 0; index < unique.length; index += VIEWER_BATCH) {
    batches.push(unique.slice(index, index + VIEWER_BATCH))
  }

  const settled = await Promise.allSettled(
    batches.map((batch) => appView.app.bsky.feed.getPosts({ uris: batch })),
  )

  // merge in batch order so the result never depends on which response landed
  // first
  const states = new Map<string, ViewerState>()
  let firstRejection: PromiseRejectedResult | null = null
  let fulfilled = 0
  for (const result of settled) {
    if (result.status === 'rejected') {
      firstRejection ??= result
      continue
    }
    fulfilled += 1
    for (const post of result.value.data.posts) {
      states.set(post.uri, {
        likeUri: post.viewer?.like ?? null,
        repostUri: post.viewer?.repost ?? null,
      })
    }
  }

  // a single failed batch must not discard the batches that answered, but a
  // read where nothing answered has confirmed nothing; report that failure
  // instead of pretending the requested posts have no interaction state
  if (batches.length > 0 && fulfilled === 0) throw firstRejection?.reason

  return states
}
