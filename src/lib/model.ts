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
  QuotedPostModel,
  QuoteEmbed,
  ThreadEntry,
  ThreadModel,
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

function mapAuthor(author: AppBskyActorDefs.ProfileViewBasic): AuthorModel {
  return {
    did: author.did,
    handle: author.handle,
    displayName: author.displayName ?? '',
    avatar: author.avatar ?? null,
  }
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
    const feature = facet.features[0]
    if (!feature) continue

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

    spans.push({
      start: byteStart,
      end: byteEnd,
      feature: { kind: 'unknown', typeName: typeNameOf(feature) },
    })
  }

  return spans
}

function mapQuotedRecord(record: QuotedRecord): QuoteEmbed | UnknownEmbed {
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

export function mapEmbed(embed: EmbedView): EmbedModel {
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
    return mapQuotedRecord(embed.record)
  }

  if (AppBskyEmbedRecordWithMedia.isView(embed)) {
    const quote = mapQuotedRecord(embed.record.record)
    const media = mapEmbed(embed.media)
    if (quote.type === 'quote' && isMediaEmbed(media)) {
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
    labels: (view.labels ?? []).map((label) => label.val),
  }
}

export function mapFeedViewPost(view: AppBskyFeedDefs.FeedViewPost): PostModel {
  return { ...mapPostView(view.post), reason: mapReason(view.reason) }
}

export function mapProfile(view: AppBskyActorDefs.ProfileViewDetailed): ProfileModel {
  return {
    did: view.did,
    handle: view.handle,
    displayName: view.displayName ?? '',
    description: view.description ?? '',
    avatar: view.avatar ?? null,
    banner: view.banner ?? null,
    followersCount: view.followersCount ?? 0,
    followsCount: view.followsCount ?? 0,
    postsCount: view.postsCount ?? 0,
    createdAt: view.createdAt ?? null,
    labels: (view.labels ?? []).map((label) => label.val),
  }
}

function collectReplies(
  replies: AppBskyFeedDefs.ThreadViewPost['replies'],
  depth: number,
  entries: ThreadEntry[],
): void {
  if (!replies) return
  for (const reply of replies) {
    if (entries.length >= MAX_THREAD_ENTRIES) return
    if (!AppBskyFeedDefs.isThreadViewPost(reply)) continue
    entries.push({ post: mapPostView(reply.post), depth, role: 'reply' })
    collectReplies(reply.replies, depth + 1, entries)
  }
}

export function flattenThread(thread: AppBskyFeedDefs.ThreadViewPost): ThreadModel {
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
    entries.push({
      post: mapPostView(ancestor.post),
      depth: -(index + 1),
      role: 'ancestor',
    })
  }

  entries.push({ post: mapPostView(thread.post), depth: 0, role: 'focus' })
  collectReplies(thread.replies, 1, entries)

  return { focusUri: thread.post.uri, entries }
}
