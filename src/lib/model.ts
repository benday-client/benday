import {
  type AppBskyActorDefs,
  AppBskyEmbedExternal,
  AppBskyEmbedGallery,
  AppBskyEmbedImages,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyEmbedVideo,
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyRichtextFacet,
  type ComAtprotoLabelDefs,
} from '@atproto/api'
import type {
  AuthorModel,
  EmbedModel,
  ExternalEmbed,
  FacetSpan,
  ImageEmbed,
  ImageModel,
  MediaEmbed,
  PostModel,
  PostReason,
  ProfileModel,
  ProfileViewerState,
  QuotedPostModel,
  QuoteEmbed,
  ReplyContextModel,
  ThreadEntry,
  ThreadModel,
  UnavailableEmbed,
  UnknownEmbed,
} from './types'

const MAX_THREAD_ENTRIES = 80

const encoder = new TextEncoder()
const decoder = new TextDecoder()

type EmbedView = NonNullable<AppBskyFeedDefs.PostView['embed']>
type QuotedRecord = AppBskyEmbedRecord.View['record']
type AspectRatio = { width: number; height: number }

function rawTypeName(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('$type' in value)) return null
  const type = value.$type
  return typeof type === 'string' && type.length > 0 ? type : null
}

function typeNameOf(value: unknown): string {
  return rawTypeName(value) ?? 'unknown'
}

function readPostRecord(record: Record<string, unknown>): AppBskyFeedPost.Record | null {
  if (!AppBskyFeedPost.isRecord(record)) return null
  // the sdk guard checks $type only; appview payloads carry the lexicon shape
  return record as AppBskyFeedPost.Record
}

type AuthorView = AppBskyActorDefs.ProfileViewBasic | AppBskyActorDefs.ProfileView

export function mapAuthor(author: AuthorView): AuthorModel {
  const viewer = author.viewer
  return {
    did: author.did,
    handle: author.handle,
    displayName: author.displayName ?? '',
    avatar: author.avatar ?? null,
    muted: viewer?.muted === true || viewer?.mutedByList != null,
    blocked:
      viewer?.blockedBy === true || viewer?.blocking != null || viewer?.blockingByList != null,
  }
}

/** a muted or blocked account does not get a card, a reply or a notification */
export function hidesAuthor(author: AuthorModel): boolean {
  return author.muted || author.blocked
}

function mapImage(
  thumb: string,
  fullsize: string,
  alt: string,
  ratio: AspectRatio | undefined,
): ImageModel {
  return {
    thumb,
    fullsize,
    alt,
    width: ratio?.width ?? null,
    height: ratio?.height ?? null,
  }
}

function domainOf(uri: string): string {
  try {
    return new URL(uri).hostname
  } catch {
    return ''
  }
}

export function mapFacets(
  facets: AppBskyRichtextFacet.Main[] | undefined,
  text: string,
): FacetSpan[] {
  if (!facets) return []
  const bytes = encoder.encode(text)
  const spans: FacetSpan[] = []

  for (const facet of facets) {
    const { byteStart, byteEnd } = facet.index
    if (!Number.isInteger(byteStart) || !Number.isInteger(byteEnd)) continue
    if (byteStart < 0 || byteEnd <= byteStart || byteEnd > bytes.length) continue

    for (const feature of facet.features) {
      if (AppBskyRichtextFacet.isMention(feature)) {
        const slice = decoder.decode(bytes.slice(byteStart, byteEnd))
        const withoutPrefix = slice.startsWith('@') ? slice.slice(1) : slice
        const handle = withoutPrefix.trim()
        const resolved = handle.length > 0 ? handle : feature.did
        spans.push({
          start: byteStart,
          end: byteEnd,
          feature: { kind: 'mention', did: feature.did, handle: resolved },
        })
        continue
      }

      if (AppBskyRichtextFacet.isLink(feature)) {
        spans.push({ start: byteStart, end: byteEnd, feature: { kind: 'link', uri: feature.uri } })
        continue
      }

      if (AppBskyRichtextFacet.isTag(feature)) {
        spans.push({ start: byteStart, end: byteEnd, feature: { kind: 'tag', tag: feature.tag } })
        continue
      }

      const typeName = typeNameOf(feature)
      if (typeName === 'app.bsky.richtext.facet#bold') {
        spans.push({ start: byteStart, end: byteEnd, feature: { kind: 'bold' } })
        continue
      }
      if (typeName === 'app.bsky.richtext.facet#italic') {
        spans.push({ start: byteStart, end: byteEnd, feature: { kind: 'italic' } })
        continue
      }
      if (typeName === 'app.bsky.richtext.facet#strikethrough') {
        spans.push({ start: byteStart, end: byteEnd, feature: { kind: 'strikethrough' } })
        continue
      }
      if (typeName === 'app.bsky.richtext.facet#code') {
        spans.push({ start: byteStart, end: byteEnd, feature: { kind: 'code' } })
        continue
      }

      spans.push({
        start: byteStart,
        end: byteEnd,
        feature: { kind: 'unknown', typeName: typeNameOf(feature) },
      })
    }
  }

  return spans
}

function mapQuotedRecord(record: QuotedRecord): QuoteEmbed | UnavailableEmbed | UnknownEmbed {
  if (AppBskyEmbedRecord.isViewBlocked(record)) {
    return { type: 'unavailable', reason: 'blocked', uri: record.uri, label: 'blocked post' }
  }
  if (AppBskyEmbedRecord.isViewNotFound(record)) {
    return { type: 'unavailable', reason: 'notFound', uri: record.uri, label: 'post not found' }
  }
  if (AppBskyEmbedRecord.isViewDetached(record)) {
    return { type: 'unavailable', reason: 'detached', uri: record.uri, label: 'detached post' }
  }
  if (!AppBskyEmbedRecord.isViewRecord(record)) {
    return { type: 'unknown', typeName: typeNameOf(record) }
  }

  const value = readPostRecord(record.value)
  if (value === null) {
    return { type: 'unknown', typeName: typeNameOf(record.value) }
  }

  const quoted: QuotedPostModel = {
    uri: record.uri,
    cid: record.cid,
    author: mapAuthor(record.author),
    text: value.text,
    facets: mapFacets(value.facets, value.text),
    indexedAt: record.indexedAt,
    embedType: rawTypeName(record.embeds?.[0]),
  }
  return { type: 'quote', post: quoted }
}

function isMediaEmbed(embed: EmbedModel): embed is MediaEmbed {
  return (
    embed.type === 'images' ||
    embed.type === 'external' ||
    embed.type === 'video' ||
    embed.type === 'unknown'
  )
}

export function mapEmbed(embed: EmbedView): EmbedModel | null {
  if (AppBskyEmbedImages.isView(embed)) {
    const images: ImageEmbed = {
      type: 'images',
      images: embed.images.map((image) =>
        mapImage(image.thumb, image.fullsize, image.alt, image.aspectRatio),
      ),
    }
    return images
  }

  if (AppBskyEmbedGallery.isView(embed)) {
    return {
      type: 'images',
      images: embed.items.flatMap((item) =>
        AppBskyEmbedGallery.isViewImage(item)
          ? [mapImage(item.thumbnail, item.fullsize, item.alt, item.aspectRatio)]
          : [],
      ),
    }
  }

  if (AppBskyEmbedExternal.isView(embed)) {
    const external: ExternalEmbed = {
      type: 'external',
      uri: embed.external.uri,
      title: embed.external.title,
      description: embed.external.description,
      thumb: embed.external.thumb ?? null,
      domain: domainOf(embed.external.uri),
    }
    return external
  }

  if (AppBskyEmbedVideo.isView(embed)) {
    return {
      type: 'video',
      thumbnail: embed.thumbnail ?? null,
      alt: embed.alt ?? '',
      playlist:
        typeof embed.playlist === 'string' && embed.playlist.length > 0 ? embed.playlist : null,
    }
  }

  if (AppBskyEmbedRecord.isView(embed)) {
    const quote = mapQuotedRecord(embed.record)
    // a quote of a muted or blocked account is not shown at all
    if (quote.type === 'quote' && hidesAuthor(quote.post.author)) return null
    return quote
  }

  if (AppBskyEmbedRecordWithMedia.isView(embed)) {
    const quote = mapQuotedRecord(embed.record.record)
    const media = mapEmbed(embed.media)
    if (quote.type === 'unavailable') return quote
    if (quote.type === 'quote' && hidesAuthor(quote.post.author)) {
      return media !== null && isMediaEmbed(media) ? media : null
    }
    if (quote.type === 'quote' && media !== null && isMediaEmbed(media)) {
      return { type: 'recordWithMedia', quote: quote.post, media }
    }
    return { type: 'unknown', typeName: typeNameOf(embed) }
  }

  return { type: 'unknown', typeName: typeNameOf(embed) }
}

function mapReason(reason: AppBskyFeedDefs.FeedViewPost['reason']): PostReason | null {
  if (!reason) return null
  if (AppBskyFeedDefs.isReasonRepost(reason)) {
    return { type: 'repost', by: mapAuthor(reason.by) }
  }
  if (AppBskyFeedDefs.isReasonPin(reason)) {
    return { type: 'pin' }
  }
  return null
}

function mapReplyContext(view: AppBskyFeedDefs.PostView): ReplyContextModel {
  const record = readPostRecord(view.record)
  const text = record?.text ?? ''

  return {
    uri: view.uri,
    cid: view.cid,
    author: mapAuthor(view.author),
    text,
    facets: mapFacets(record?.facets, text),
    indexedAt: view.indexedAt,
  }
}

export function mapPostView(view: AppBskyFeedDefs.PostView): PostModel {
  const record = readPostRecord(view.record)
  const text = record?.text ?? ''

  return {
    uri: view.uri,
    cid: view.cid,
    author: mapAuthor(view.author),
    text,
    facets: mapFacets(record?.facets, text),
    indexedAt: view.indexedAt,
    replyCount: view.replyCount ?? 0,
    repostCount: view.repostCount ?? 0,
    likeCount: view.likeCount ?? 0,
    quoteCount: view.quoteCount ?? 0,
    embed: view.embed ? mapEmbed(view.embed) : null,
    reason: null,
    isReply: record?.reply !== undefined,
    replyRoot: record?.reply?.root ?? null,
    replyParent: record?.reply?.parent ?? null,
    replyContext: null,
    labels: readLabels(view.labels),
  }
}

export function replyContextFromPost(post: PostModel): ReplyContextModel {
  return {
    uri: post.uri,
    cid: post.cid,
    author: post.author,
    text: post.text,
    facets: post.facets,
    indexedAt: post.indexedAt,
  }
}

export function mapFeedViewPost(view: AppBskyFeedDefs.FeedViewPost): PostModel {
  const parent = view.reply?.parent
  const replyContext =
    parent !== undefined && AppBskyFeedDefs.isPostView(parent) ? mapReplyContext(parent) : null

  return {
    ...mapPostView(view.post),
    reason: mapReason(view.reason),
    replyContext,
    ...(view.feedContext !== undefined ? { feedContext: view.feedContext } : {}),
    ...(view.reqId !== undefined ? { reqId: view.reqId } : {}),
  }
}

// a retracted label (neg) must stop rendering, and a malformed value must not
// stand in for one
function readLabels(labels: readonly ComAtprotoLabelDefs.Label[] | undefined): string[] {
  const values: string[] = []
  for (const label of labels ?? []) {
    if (label.neg === true) continue
    if (typeof label.val !== 'string') continue
    values.push(label.val)
  }
  return values
}

export function mapProfileViewer(
  viewer: AppBskyActorDefs.ProfileViewDetailed['viewer'] | null,
): ProfileViewerState {
  return {
    following: viewer?.following ?? null,
    followedBy: viewer?.followedBy ?? null,
    muted: viewer?.muted ?? false,
    mutedOnlyReposts: viewer?.mutedOnlyReposts ?? false,
    mutedOnlyQuoteposts: viewer?.mutedOnlyQuoteposts ?? false,
    blocking: viewer?.blocking ?? null,
    blockedBy: viewer?.blockedBy ?? false,
    activitySubscription:
      viewer?.activitySubscription === undefined
        ? null
        : {
            post: viewer.activitySubscription.post,
            reply: viewer.activitySubscription.reply,
          },
  }
}

export function mapProfile(view: AppBskyActorDefs.ProfileViewDetailed): ProfileModel {
  const labels = readLabels(view.labels)
  const isBot = labels.some((label) => label.toLowerCase() === 'bot')

  return {
    did: view.did,
    handle: view.handle,
    displayName: view.displayName ?? '',
    description: view.description ?? '',
    pronouns: view.pronouns ?? '',
    avatar: view.avatar ?? null,
    banner: view.banner ?? null,
    followersCount: view.followersCount ?? 0,
    followsCount: view.followsCount ?? 0,
    postsCount: view.postsCount ?? 0,
    createdAt: view.createdAt ?? null,
    labels,
    links: (view.links ?? []).map((link) => ({
      url: link.url,
      title: link.title ?? '',
    })),
    isBot,
    viewer: mapProfileViewer(view.viewer ?? null),
  }
}

const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>()

function collectReplies(
  replies: AppBskyFeedDefs.ThreadViewPost['replies'],
  depth: number,
  entries: ThreadEntry[],
  hidden: ReadonlySet<string>,
): void {
  if (!replies) return
  for (const reply of replies) {
    if (!AppBskyFeedDefs.isThreadViewPost(reply)) continue
    const post = mapPostView(reply.post)
    // a hidden author takes their subtree with them
    if (hidesAuthor(post.author) || hidden.has(post.author.did)) continue
    // hidden replies are skipped before the cap so they cannot crowd out
    // replies the reader can actually see
    if (entries.length >= MAX_THREAD_ENTRIES) return
    entries.push({ post, depth, role: 'reply' })
    collectReplies(reply.replies, depth + 1, entries, hidden)
  }
}

/**
 * Every author a reader must resolve moderation state for: the post's own
 * author, its repost author, the reply context it carries, and its quote.
 */
export function postAuthorDids(post: PostModel): string[] {
  const dids = [post.author.did]
  if (post.reason?.type === 'repost') dids.push(post.reason.by.did)
  if (post.replyContext !== null) dids.push(post.replyContext.author.did)
  if (post.embed?.type === 'quote') dids.push(post.embed.post.author.did)
  if (post.embed?.type === 'recordWithMedia') dids.push(post.embed.quote.author.did)
  return dids
}

/**
 * Every author in the raw thread tree, including nested quote and reply-context
 * authors. The focus post's own author is included too, but flattenThread keeps
 * the deliberately opened focus post regardless.
 */
export function threadAuthorDids(thread: AppBskyFeedDefs.ThreadViewPost): string[] {
  const dids = new Set<string>()

  const addNode = (node: AppBskyFeedDefs.ThreadViewPost): void => {
    for (const did of postAuthorDids(mapPostView(node.post))) dids.add(did)
  }

  addNode(thread)

  let cursor = thread.parent
  while (cursor) {
    if (!AppBskyFeedDefs.isThreadViewPost(cursor)) break
    addNode(cursor)
    cursor = cursor.parent
  }

  const addReplies = (replies: AppBskyFeedDefs.ThreadViewPost['replies']): void => {
    for (const reply of replies ?? []) {
      if (!AppBskyFeedDefs.isThreadViewPost(reply)) continue
      addNode(reply)
      addReplies(reply.replies)
    }
  }
  addReplies(thread.replies)

  return [...dids]
}

/**
 * A post that survives canonical moderation must not still point at a hidden
 * account through its reply context or quote. A record-with-media keeps its
 * media when only the quoted post is hidden.
 */
export function pruneHiddenPost(post: PostModel, hidden: ReadonlySet<string>): PostModel {
  const replyContext =
    post.replyContext !== null && hidden.has(post.replyContext.author.did)
      ? null
      : post.replyContext

  let embed = post.embed
  if (embed !== null) {
    if (embed.type === 'quote' && hidden.has(embed.post.author.did)) {
      embed = null
    } else if (embed.type === 'recordWithMedia' && hidden.has(embed.quote.author.did)) {
      embed = embed.media
    }
  }

  if (replyContext === post.replyContext && embed === post.embed) return post
  return { ...post, replyContext, embed }
}

export function flattenThread(
  thread: AppBskyFeedDefs.ThreadViewPost,
  hidden: ReadonlySet<string> = EMPTY_HIDDEN,
): ThreadModel {
  const ancestors: AppBskyFeedDefs.ThreadViewPost[] = []
  let cursor = thread.parent
  while (cursor) {
    if (!AppBskyFeedDefs.isThreadViewPost(cursor)) break
    ancestors.push(cursor)
    cursor = cursor.parent
  }

  const entries: ThreadEntry[] = []
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]
    if (!ancestor) continue
    const post = mapPostView(ancestor.post)
    if (hidesAuthor(post.author) || hidden.has(post.author.did)) continue
    entries.push({ post, depth: -(index + 1), role: 'ancestor' })
  }

  // the reader opened the focus post on purpose, so it stays even when its
  // author is hidden; only its nested content is pruned
  entries.push({ post: mapPostView(thread.post), depth: 0, role: 'focus' })
  collectReplies(thread.replies, 1, entries, hidden)

  // reply contexts come only from entries that survived moderation
  const byUri = new Map(entries.map((entry) => [entry.post.uri, entry.post]))
  const withContext = entries.map((entry) => {
    const parentUri = entry.post.replyParent?.uri
    const parent = parentUri === undefined ? undefined : byUri.get(parentUri)
    const post =
      parent === undefined
        ? entry.post
        : { ...entry.post, replyContext: replyContextFromPost(parent) }
    return { ...entry, post: pruneHiddenPost(post, hidden) }
  })

  return { focusUri: thread.post.uri, entries: withContext }
}
