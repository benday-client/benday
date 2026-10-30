import type { AppBskyActorDefs, AppBskyFeedDefs, AppBskyRichtextFacet } from '@atproto/api'
import { describe, expect, it } from 'vitest'
import { flattenThread, mapFacets, mapFeedViewPost, mapPostView, mapProfile } from './model'

const encoder = new TextEncoder()

const INDEXED_AT = '2026-01-01T00:00:00.000Z'

function byteRange(text: string, needle: string): { byteStart: number; byteEnd: number } {
  const index = text.indexOf(needle)
  if (index < 0) throw new Error(`missing substring: ${needle}`)
  const byteStart = encoder.encode(text.slice(0, index)).length
  return { byteStart, byteEnd: byteStart + encoder.encode(needle).length }
}

function facetAt(
  text: string,
  needle: string,
  features: AppBskyRichtextFacet.Main['features'],
): AppBskyRichtextFacet.Main {
  return { index: byteRange(text, needle), features }
}

function mentionFacet(text: string, needle: string, did: string): AppBskyRichtextFacet.Main {
  return facetAt(text, needle, [{ $type: 'app.bsky.richtext.facet#mention', did }])
}

function profileBasic(overrides: Record<string, unknown> = {}): AppBskyActorDefs.ProfileViewBasic {
  return {
    did: 'did:plc:ada',
    handle: 'ada.world',
    displayName: 'ada',
    avatar: 'https://cdn.example/ada.png',
    ...overrides,
  } as unknown as AppBskyActorDefs.ProfileViewBasic
}

function postRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $type: 'app.bsky.feed.post',
    text: '',
    createdAt: INDEXED_AT,
    ...overrides,
  }
}

function postView(overrides: Record<string, unknown> = {}): AppBskyFeedDefs.PostView {
  return {
    $type: 'app.bsky.feed.defs#postView',
    uri: 'at://did:plc:ada/app.bsky.feed.post/1',
    cid: 'cid-1',
    author: profileBasic(),
    record: postRecord(),
    indexedAt: INDEXED_AT,
    ...overrides,
  } as unknown as AppBskyFeedDefs.PostView
}

function feedViewPost(overrides: Record<string, unknown> = {}): AppBskyFeedDefs.FeedViewPost {
  return {
    $type: 'app.bsky.feed.defs#feedViewPost',
    post: postView(),
    ...overrides,
  } as unknown as AppBskyFeedDefs.FeedViewPost
}

function threadNode(
  uri: string,
  overrides: Record<string, unknown> = {},
): AppBskyFeedDefs.ThreadViewPost {
  return {
    $type: 'app.bsky.feed.defs#threadViewPost',
    post: postView({ uri }),
    ...overrides,
  } as unknown as AppBskyFeedDefs.ThreadViewPost
}

describe('mapFacets', () => {
  it('returns no spans for missing facets', () => {
    expect(mapFacets(undefined, 'plain')).toEqual([])
    expect(mapFacets([], 'plain')).toEqual([])
  })

  it('maps a link facet with ascii byte offsets', () => {
    const text = 'read https://example.com now'
    const facets = [
      facetAt(text, 'https://example.com', [
        { $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' },
      ]),
    ]
    const range = byteRange(text, 'https://example.com')

    expect(mapFacets(facets, text)).toEqual([
      {
        start: range.byteStart,
        end: range.byteEnd,
        feature: { kind: 'link', uri: 'https://example.com' },
      },
    ])
  })

  it('decodes mention handles across polish diacritics and an emoji', () => {
    const text = 'zażółć 😀 @ada.world'
    const facets = [mentionFacet(text, '@ada.world', 'did:plc:ada')]
    const range = byteRange(text, '@ada.world')

    expect(mapFacets(facets, text)).toEqual([
      {
        start: range.byteStart,
        end: range.byteEnd,
        feature: { kind: 'mention', did: 'did:plc:ada', handle: 'ada.world' },
      },
    ])
  })

  it('falls back to the did when a mention slice has no handle', () => {
    const text = 'hi @ there'
    const facets = [mentionFacet(text, '@', 'did:plc:solo')]
    const range = byteRange(text, '@')

    expect(mapFacets(facets, text)).toEqual([
      {
        start: range.byteStart,
        end: range.byteEnd,
        feature: { kind: 'mention', did: 'did:plc:solo', handle: 'did:plc:solo' },
      },
    ])
  })

  it('maps tag features and keeps unknown feature type names', () => {
    const text = 'tag #tensorpunk and custom'
    const facets = [
      facetAt(text, '#tensorpunk', [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tensorpunk' }]),
      facetAt(text, 'custom', [{ $type: 'com.example.custom#feature' }]),
    ]
    const tagRange = byteRange(text, '#tensorpunk')
    const unknownRange = byteRange(text, 'custom')

    expect(mapFacets(facets, text)).toEqual([
      {
        start: tagRange.byteStart,
        end: tagRange.byteEnd,
        feature: { kind: 'tag', tag: 'tensorpunk' },
      },
      {
        start: unknownRange.byteStart,
        end: unknownRange.byteEnd,
        feature: { kind: 'unknown', typeName: 'com.example.custom#feature' },
      },
    ])
  })

  it('skips invalid ranges and facets without features', () => {
    const text = 'hello'
    const facets: AppBskyRichtextFacet.Main[] = [
      {
        index: { byteStart: 3, byteEnd: 2 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'backwards' }],
      },
      {
        index: { byteStart: 0, byteEnd: 99 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'long' }],
      },
      { index: { byteStart: 0, byteEnd: 1 }, features: [] },
    ]

    expect(mapFacets(facets, text)).toEqual([])
  })

  it('maps markdown facet feature types', () => {
    const facets = [
      {
        index: { byteStart: 0, byteEnd: 4 },
        features: [{ $type: 'app.bsky.richtext.facet#bold' }],
      },
      {
        index: { byteStart: 5, byteEnd: 9 },
        features: [{ $type: 'app.bsky.richtext.facet#italic' }],
      },
      {
        index: { byteStart: 10, byteEnd: 14 },
        features: [{ $type: 'app.bsky.richtext.facet#strikethrough' }],
      },
      {
        index: { byteStart: 15, byteEnd: 19 },
        features: [{ $type: 'app.bsky.richtext.facet#code' }],
      },
    ] as AppBskyRichtextFacet.Main[]

    expect(mapFacets(facets, 'bold italic gone code')).toEqual([
      { start: 0, end: 4, feature: { kind: 'bold' } },
      { start: 5, end: 9, feature: { kind: 'italic' } },
      { start: 10, end: 14, feature: { kind: 'strikethrough' } },
      { start: 15, end: 19, feature: { kind: 'code' } },
    ])
  })

  it('maps every feature in a facet at the same range', () => {
    const text = 'bold link'
    const facets = [
      facetAt(text, 'bold link', [
        { $type: 'app.bsky.richtext.facet#bold' },
        { $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' },
      ]),
    ]
    const range = byteRange(text, 'bold link')

    expect(mapFacets(facets, text)).toEqual([
      { start: range.byteStart, end: range.byteEnd, feature: { kind: 'bold' } },
      {
        start: range.byteStart,
        end: range.byteEnd,
        feature: { kind: 'link', uri: 'https://example.com' },
      },
    ])
  })
})

describe('mapPostView', () => {
  it('fills defaults when counts, labels and embed are absent', () => {
    expect(mapPostView(postView())).toEqual({
      uri: 'at://did:plc:ada/app.bsky.feed.post/1',
      cid: 'cid-1',
      author: {
        did: 'did:plc:ada',
        handle: 'ada.world',
        displayName: 'ada',
        avatar: 'https://cdn.example/ada.png',
      },
      text: '',
      facets: [],
      indexedAt: INDEXED_AT,
      replyCount: 0,
      repostCount: 0,
      likeCount: 0,
      quoteCount: 0,
      embed: null,
      reason: null,
      isReply: false,
      replyRoot: null,
      replyParent: null,
      replyContext: null,
      labels: [],
    })
  })

  it('reads text, facets, reply state, counts and labels from the record', () => {
    const text = 'hello @ada.world'
    const view = postView({
      record: postRecord({
        text,
        facets: [mentionFacet(text, '@ada.world', 'did:plc:ada')],
        reply: {
          root: { uri: 'at://root', cid: 'root-cid' },
          parent: { uri: 'at://parent', cid: 'parent-cid' },
        },
      }),
      replyCount: 4,
      repostCount: 3,
      likeCount: 12,
      quoteCount: 1,
      labels: [{ val: 'nsfw' }],
    })

    const model = mapPostView(view)
    const range = byteRange(text, '@ada.world')
    expect(model.text).toBe(text)
    expect(model.facets).toEqual([
      {
        start: range.byteStart,
        end: range.byteEnd,
        feature: { kind: 'mention', did: 'did:plc:ada', handle: 'ada.world' },
      },
    ])
    expect(model.isReply).toBe(true)
    expect(model.replyRoot).toEqual({ uri: 'at://root', cid: 'root-cid' })
    expect(model.replyParent).toEqual({ uri: 'at://parent', cid: 'parent-cid' })
    expect(model.replyCount).toBe(4)
    expect(model.repostCount).toBe(3)
    expect(model.likeCount).toBe(12)
    expect(model.quoteCount).toBe(1)
    expect(model.labels).toEqual(['nsfw'])
  })

  it('treats a non-post record as empty text with no reply', () => {
    const model = mapPostView(postView({ record: { text: 'not a post' } }))

    expect(model.text).toBe('')
    expect(model.facets).toEqual([])
    expect(model.isReply).toBe(false)
  })
})

describe('mapPostView embeds', () => {
  it('maps image views with aspect ratios and defaults', () => {
    const view = postView({
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [
          {
            $type: 'app.bsky.embed.images#viewImage',
            thumb: 'thumb-a',
            fullsize: 'full-a',
            alt: 'alt-a',
            aspectRatio: { width: 4, height: 3 },
          },
          {
            $type: 'app.bsky.embed.images#viewImage',
            thumb: 'thumb-b',
            fullsize: 'full-b',
            alt: '',
          },
        ],
      },
    })

    expect(mapPostView(view).embed).toEqual({
      type: 'images',
      images: [
        { thumb: 'thumb-a', fullsize: 'full-a', alt: 'alt-a', width: 4, height: 3 },
        { thumb: 'thumb-b', fullsize: 'full-b', alt: '', width: null, height: null },
      ],
    })
  })

  it('maps gallery items and skips unknown gallery items', () => {
    const view = postView({
      embed: {
        $type: 'app.bsky.embed.gallery#view',
        items: [
          {
            $type: 'app.bsky.embed.gallery#viewImage',
            thumbnail: 'g-thumb',
            fullsize: 'g-full',
            alt: 'g-alt',
            aspectRatio: { width: 1, height: 1 },
          },
          { $type: 'com.example.custom#galleryItem' },
        ],
      },
    })

    expect(mapPostView(view).embed).toEqual({
      type: 'images',
      images: [{ thumb: 'g-thumb', fullsize: 'g-full', alt: 'g-alt', width: 1, height: 1 }],
    })
  })

  it('maps external embeds with a domain and a null thumb fallback', () => {
    const withThumb = postView({
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://example.com/path',
          title: 'title',
          description: 'desc',
          thumb: 'https://cdn.example/thumb.png',
        },
      },
    })
    const withoutThumb = postView({
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: { uri: 'not a url', title: 't', description: 'd' },
      },
    })

    expect(mapPostView(withThumb).embed).toEqual({
      type: 'external',
      uri: 'https://example.com/path',
      title: 'title',
      description: 'desc',
      thumb: 'https://cdn.example/thumb.png',
      domain: 'example.com',
    })
    expect(mapPostView(withoutThumb).embed).toEqual({
      type: 'external',
      uri: 'not a url',
      title: 't',
      description: 'd',
      thumb: null,
      domain: '',
    })
  })

  it('maps video embeds and nulls an empty playlist', () => {
    const withPlaylist = postView({
      embed: {
        $type: 'app.bsky.embed.video#view',
        cid: 'vid-1',
        playlist: 'https://video.example/playlist.m3u8',
        thumbnail: 'https://cdn.example/video.png',
        alt: 'video alt',
      },
    })
    const empty = postView({
      embed: { $type: 'app.bsky.embed.video#view', cid: 'vid-2', playlist: '' },
    })

    expect(mapPostView(withPlaylist).embed).toEqual({
      type: 'video',
      thumbnail: 'https://cdn.example/video.png',
      alt: 'video alt',
      playlist: 'https://video.example/playlist.m3u8',
    })
    expect(mapPostView(empty).embed).toEqual({
      type: 'video',
      thumbnail: null,
      alt: '',
      playlist: null,
    })
  })

  it('maps record quotes only when the quoted value is a post', () => {
    const quoted = {
      $type: 'app.bsky.embed.record#viewRecord',
      uri: 'at://did:plc:bob/app.bsky.feed.post/9',
      cid: 'cid-quoted',
      author: profileBasic({ did: 'did:plc:bob', handle: 'bob.world', displayName: 'bob' }),
      value: postRecord({ text: 'quoted text' }),
      indexedAt: '2026-01-02T00:00:00.000Z',
      embeds: [{ $type: 'app.bsky.embed.images#view', images: [] }],
    }
    const quoteView = postView({
      embed: { $type: 'app.bsky.embed.record#view', record: quoted },
    })
    const generatorView = postView({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          $type: 'app.bsky.embed.record#viewRecord',
          uri: 'at://did:plc:bob/app.bsky.feed.generator/feed',
          cid: 'cid-generator',
          author: profileBasic({ did: 'did:plc:bob', handle: 'bob.world' }),
          value: { $type: 'app.bsky.feed.generator' },
          indexedAt: '2026-01-02T00:00:00.000Z',
        },
      },
    })

    expect(mapPostView(quoteView).embed).toEqual({
      type: 'quote',
      post: {
        uri: quoted.uri,
        cid: 'cid-quoted',
        author: {
          did: 'did:plc:bob',
          handle: 'bob.world',
          displayName: 'bob',
          avatar: 'https://cdn.example/ada.png',
        },
        text: 'quoted text',
        facets: [],
        indexedAt: '2026-01-02T00:00:00.000Z',
        embedType: 'app.bsky.embed.images#view',
      },
    })
    expect(mapPostView(generatorView).embed).toEqual({
      type: 'unknown',
      typeName: 'app.bsky.feed.generator',
    })
  })

  it('maps a blocked quoted post to an unavailable placeholder', () => {
    const blocked = postView({
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          $type: 'app.bsky.embed.record#viewBlocked',
          uri: 'at://did:plc:bob/app.bsky.feed.post/blocked',
          blocked: true,
          author: { did: 'did:plc:bob' },
        },
      },
    })

    expect(mapPostView(blocked).embed).toEqual({
      type: 'unavailable',
      reason: 'blocked',
      uri: 'at://did:plc:bob/app.bsky.feed.post/blocked',
      label: 'blocked post',
    })
  })

  it('keeps the unavailable placeholder for a blocked recordWithMedia quote', () => {
    const blocked = postView({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          $type: 'app.bsky.embed.record#view',
          record: {
            $type: 'app.bsky.embed.record#viewBlocked',
            uri: 'at://did:plc:bob/app.bsky.feed.post/blocked',
            blocked: true,
            author: { did: 'did:plc:bob' },
          },
        },
        media: { $type: 'app.bsky.embed.images#view', images: [] },
      },
    })

    expect(mapPostView(blocked).embed).toEqual({
      type: 'unavailable',
      reason: 'blocked',
      uri: 'at://did:plc:bob/app.bsky.feed.post/blocked',
      label: 'blocked post',
    })
  })

  it('maps recordWithMedia quotes and media together', () => {
    const quoted = {
      $type: 'app.bsky.embed.record#viewRecord',
      uri: 'at://did:plc:bob/app.bsky.feed.post/9',
      cid: 'cid-quoted',
      author: profileBasic({ did: 'did:plc:bob', handle: 'bob.world' }),
      value: postRecord({ text: 'quoted text' }),
      indexedAt: '2026-01-02T00:00:00.000Z',
    }
    const view = postView({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: { $type: 'app.bsky.embed.record#view', record: quoted },
        media: { $type: 'app.bsky.embed.images#view', images: [] },
      },
    })

    expect(mapPostView(view).embed).toEqual({
      type: 'recordWithMedia',
      quote: {
        uri: quoted.uri,
        cid: 'cid-quoted',
        author: {
          did: 'did:plc:bob',
          handle: 'bob.world',
          displayName: 'ada',
          avatar: 'https://cdn.example/ada.png',
        },
        text: 'quoted text',
        facets: [],
        indexedAt: '2026-01-02T00:00:00.000Z',
        embedType: null,
      },
      media: { type: 'images', images: [] },
    })
  })

  it('keeps unknown embed type names', () => {
    const view = postView({ embed: { $type: 'com.example.custom#embed' } })

    expect(mapPostView(view).embed).toEqual({
      type: 'unknown',
      typeName: 'com.example.custom#embed',
    })
  })
})

describe('mapFeedViewPost', () => {
  it('maps repost and pin reasons', () => {
    const repost = feedViewPost({
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        by: profileBasic({ handle: 'rep.world', displayName: 'rep' }),
        indexedAt: '2026-01-03T00:00:00.000Z',
      },
    })
    const pin = feedViewPost({ reason: { $type: 'app.bsky.feed.defs#reasonPin' } })
    const plain = feedViewPost()

    expect(mapFeedViewPost(repost).reason).toEqual({
      type: 'repost',
      by: {
        did: 'did:plc:ada',
        handle: 'rep.world',
        displayName: 'rep',
        avatar: 'https://cdn.example/ada.png',
      },
    })
    expect(mapFeedViewPost(pin).reason).toEqual({ type: 'pin' })
    expect(mapFeedViewPost(plain).reason).toBeNull()
  })

  it('keeps feed context and request id', () => {
    const model = mapFeedViewPost(feedViewPost({ feedContext: 'ctx-1', reqId: 'req-1' }))

    expect(model.feedContext).toBe('ctx-1')
    expect(model.reqId).toBe('req-1')
  })

  it('maps the parent preview for reply items', () => {
    const parentRef = { uri: 'at://did:plc:ada/app.bsky.feed.post/parent', cid: 'parent-cid' }
    const parent = postView({
      uri: parentRef.uri,
      cid: parentRef.cid,
      author: profileBasic({ handle: 'parent.world', displayName: 'parent' }),
      record: postRecord({ text: 'the post being answered' }),
    })
    const reply = feedViewPost({
      post: postView({
        record: postRecord({ text: 'answer', reply: { root: parentRef, parent: parentRef } }),
      }),
      reply: { root: parent, parent },
    })

    expect(mapFeedViewPost(reply).replyContext).toMatchObject({
      uri: parentRef.uri,
      cid: parentRef.cid,
      text: 'the post being answered',
      author: { handle: 'parent.world' },
    })
  })
})

describe('mapProfile', () => {
  it('fills defaults for a sparse profile', () => {
    const view = {
      $type: 'app.bsky.actor.defs#profileViewDetailed',
      did: 'did:plc:x',
      handle: 'x.world',
    } as unknown as AppBskyActorDefs.ProfileViewDetailed

    expect(mapProfile(view)).toEqual({
      did: 'did:plc:x',
      handle: 'x.world',
      displayName: '',
      description: '',
      pronouns: '',
      avatar: null,
      banner: null,
      followersCount: 0,
      followsCount: 0,
      postsCount: 0,
      createdAt: null,
      labels: [],
      links: [],
      isBot: false,
      viewer: {
        following: null,
        followedBy: null,
        muted: false,
        mutedOnlyReposts: false,
        mutedOnlyQuoteposts: false,
        blocking: null,
        blockedBy: false,
        activitySubscription: null,
      },
    })
  })
})

describe('flattenThread', () => {
  it('orders ancestors root first, then focus, then replies in pre-order', () => {
    const root = threadNode('root')
    const parent = threadNode('parent', { parent: root })
    const childA1 = threadNode('a1')
    const childA = threadNode('a', { replies: [childA1] })
    const childB = threadNode('b')
    const blocked = {
      $type: 'app.bsky.feed.defs#blockedPost',
      uri: 'at://blocked',
      blocked: true,
      author: { did: 'did:plc:z', handle: 'z.world' },
    }
    const notFound = {
      $type: 'app.bsky.feed.defs#notFoundPost',
      uri: 'at://missing',
      notFound: true,
    }
    const focus = threadNode('focus', {
      parent,
      replies: [blocked, childA, notFound, childB],
    })

    const model = flattenThread(focus)

    expect(model.focusUri).toBe('focus')
    expect(model.entries.map((entry) => entry.post.uri)).toEqual([
      'root',
      'parent',
      'focus',
      'a',
      'a1',
      'b',
    ])
    expect(model.entries.map((entry) => entry.depth)).toEqual([-2, -1, 0, 1, 2, 1])
    expect(model.entries.map((entry) => entry.role)).toEqual([
      'ancestor',
      'ancestor',
      'focus',
      'reply',
      'reply',
      'reply',
    ])
  })

  it('caps the flattened thread at eighty entries', () => {
    const replies = Array.from({ length: 100 }, (_, index) => threadNode(`r${index}`))
    const focus = threadNode('focus', { replies })

    const model = flattenThread(focus)

    expect(model.entries).toHaveLength(80)
    expect(model.entries[79]?.post.uri).toBe('r78')
  })
})
