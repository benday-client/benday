import type {
  AppBskyEmbedRecord,
  AppBskyFeedPost,
  AppBskyRichtextFacet,
  AtpBaseClient,
} from '@atproto/api'
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
type WireFeature = WireFacet['features'][number]

interface ResolvedFeature {
  start: number
  end: number
  feature: WireFeature
}

function navigationKind(feature: WireFeature): 'mention' | 'link' | 'tag' | null {
  if ('did' in feature) return 'mention'
  if ('uri' in feature) return 'link'
  if ('tag' in feature) return 'tag'
  return null
}

function featureKey(feature: WireFeature): string {
  if ('did' in feature) return `mention:${feature.did}`
  if ('uri' in feature) return `link:${feature.uri}`
  if ('tag' in feature) return `tag:${feature.tag}`
  return feature.$type
}

// an unresolved mention arrives with an empty did and must not reach the wire
function isUsableFeature(feature: WireFeature): boolean {
  return !('did' in feature) || feature.did.trim().length > 0
}

/**
 * Wire facets allow overlaps that benday's renderer handles, but the two
 * sources disagree: markdown links must win over autodetected navigation, and
 * a navigation span can never be split. Formatting is cut at navigation
 * boundaries so both survive, and identical ranges are merged.
 */
function canonicalFacets(
  markdownFacets: readonly WireFacet[],
  detectedFacets: readonly WireFacet[],
): WireFacet[] {
  const navigation: ResolvedFeature[] = []
  const formatting: ResolvedFeature[] = []

  const collect = (facets: readonly WireFacet[], explicit: boolean) => {
    const explicitLinks: ResolvedFeature[] = []
    const automatic: ResolvedFeature[] = []

    for (const facet of facets) {
      const start = facet.index.byteStart
      const end = facet.index.byteEnd
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue
      if (start < 0 || end <= start) continue

      const seen = new Set<string>()
      for (const feature of facet.features) {
        const key = featureKey(feature)
        if (seen.has(key)) continue
        seen.add(key)
        if (!isUsableFeature(feature)) continue

        const resolved = { start, end, feature }
        if (navigationKind(feature) === null) {
          formatting.push(resolved)
        } else if (explicit) {
          explicitLinks.push(resolved)
        } else {
          automatic.push(resolved)
        }
      }
    }

    navigation.push(...explicitLinks, ...automatic)
  }

  collect(markdownFacets, true)
  collect(detectedFacets, false)

  const selected: ResolvedFeature[] = []
  for (const candidate of navigation) {
    const overlaps = selected.some(
      (span) => candidate.start < span.end && span.start < candidate.end,
    )
    if (!overlaps) selected.push(candidate)
  }

  const cuts = [...new Set(selected.flatMap((span) => [span.start, span.end]))].sort(
    (left, right) => left - right,
  )

  const ranges = new Map<string, { start: number; end: number; features: WireFeature[] }>()
  const addFormatting = (start: number, end: number, feature: WireFeature) => {
    if (end <= start) return
    const key = `${start}:${end}`
    const existing = ranges.get(key)
    if (existing === undefined) {
      ranges.set(key, { start, end, features: [feature] })
      return
    }
    const name = featureKey(feature)
    if (existing.features.some((other) => featureKey(other) === name)) return
    existing.features.push(feature)
  }

  for (const span of formatting) {
    let cursor = span.start
    for (const cut of cuts) {
      if (cut <= span.start) continue
      if (cut >= span.end) break
      addFormatting(cursor, cut, span.feature)
      cursor = cut
    }
    addFormatting(cursor, span.end, span.feature)
  }

  const facets = selected.map((span) => ({
    start: span.start,
    end: span.end,
    features: [span.feature],
    navigation: true,
  }))
  for (const range of ranges.values()) facets.push({ ...range, navigation: false })

  facets.sort(
    (left, right) =>
      left.start - right.start ||
      Number(right.navigation) - Number(left.navigation) ||
      left.end - right.end,
  )

  return facets.map((facet) => ({
    index: { byteStart: facet.start, byteEnd: facet.end },
    features: facet.features,
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

export async function createQuote(text: string, post: PostModel): Promise<WriteResult> {
  const agent = requireAgent()
  const rich = await preparedText(text, agent)
  requireSameAgent(agent)
  const embed: AppBskyEmbedRecord.Main = {
    $type: 'app.bsky.embed.record',
    record: { uri: post.uri, cid: post.cid },
  }
  const record: Partial<AppBskyFeedPost.Record> = {
    text: rich.text,
    embed,
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
