import type { AppBskyRichtextFacet } from '@atproto/api'
import { AtpAgent, RichText } from '@atproto/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postFixture } from '../test/fixtures'
import { installTransport, jsonResponse } from '../test/transport'
import {
  createPost,
  createQuote,
  createReply,
  deletePost,
  fetchViewerStates,
  sendFeedFeedback,
} from './actions'
import { getAuthAgent } from './auth'
import { segmentText } from './facets'
import { mapFacets } from './model'

vi.mock('./auth', () => ({
  getAuthAgent: vi.fn(),
}))

const GENERATOR_FEED = 'at://did:plc:test/app.bsky.feed.generator/one'
const GENERATOR_DID = 'did:web:feeds.test'

interface PostedRecord {
  text: string
  facets?: AppBskyRichtextFacet.Main[]
  reply?: {
    root: { uri: string; cid: string }
    parent: { uri: string; cid: string }
  }
  embed?: { $type: string; record: { uri: string; cid: string } }
}

function fakeAgent(resolve: (handle: string) => Promise<string> = async () => 'did:plc:test') {
  const post = vi.fn(async (_record: PostedRecord) => ({ uri: 'at://new', cid: 'new-cid' }))
  const resolveHandle = vi.fn(async ({ handle }: { handle: string }) => ({
    data: { did: await resolve(handle) },
  }))
  const agent = {
    post,
    com: { atproto: { identity: { resolveHandle } } },
  } as unknown as AtpAgent
  vi.mocked(getAuthAgent).mockReturnValue(agent)
  return { post, resolveHandle }
}

function posted(post: { mock: { calls: unknown[][] } }, index = 0): PostedRecord {
  const record = post.mock.calls[index]?.[0]
  if (record === undefined) throw new Error('nothing was posted')
  return record as PostedRecord
}

// the standard wire walk: navigation must survive it and no text may vanish
function wireSegments(record: PostedRecord) {
  const rich = new RichText({ text: record.text, facets: record.facets ?? [] })
  return [...rich.segments()].map((segment) => ({
    text: segment.text,
    link: segment.isLink(),
    mention: segment.isMention(),
  }))
}

// benday's overlap-aware walk keeps formatting that sits inside navigation
function mappedSegments(record: PostedRecord) {
  return segmentText(record.text, mapFacets(record.facets, record.text)).map((segment) => ({
    text: segment.text,
    kinds: segment.features.map((feature) => feature.kind).sort(),
  }))
}

beforeEach(() => {
  vi.mocked(getAuthAgent).mockReset()
})

describe('fetchViewerStates', () => {
  it('routes viewer-state reads through the official appview proxy', async () => {
    const getPosts = vi.fn(async () => ({
      data: {
        posts: [
          {
            uri: 'at://did:plc:test/app.bsky.feed.post/1',
            viewer: { like: 'at://like/1', repost: null },
          },
        ],
      },
    }))
    const withProxy = vi.fn(() => ({
      app: { bsky: { feed: { getPosts } } },
    }))

    vi.mocked(getAuthAgent).mockReturnValue({ withProxy } as unknown as AtpAgent)

    const states = await fetchViewerStates(['at://did:plc:test/app.bsky.feed.post/1'])

    expect(withProxy).toHaveBeenCalledWith('bsky_appview', 'did:web:api.bsky.app')
    expect(getPosts).toHaveBeenCalledWith({
      uris: ['at://did:plc:test/app.bsky.feed.post/1'],
    })
    expect(states.get('at://did:plc:test/app.bsky.feed.post/1')).toEqual({
      likeUri: 'at://like/1',
      repostUri: null,
    })
  })

  it('keeps the batches that answered when another batch fails', async () => {
    const uris = Array.from(
      { length: 26 },
      (_, index) => `at://did:plc:test/app.bsky.feed.post/${index}`,
    )
    let batch = 0
    const getPosts = vi.fn(async ({ uris: requested }: { uris: string[] }) => {
      batch += 1
      if (batch === 2) throw new Error('viewer state unavailable')
      return {
        data: {
          posts: requested.map((uri) => ({
            uri,
            viewer: { like: `at://like/${uri}`, repost: null },
          })),
        },
      }
    })
    const withProxy = vi.fn(() => ({ app: { bsky: { feed: { getPosts } } } }))
    vi.mocked(getAuthAgent).mockReturnValue({ withProxy } as unknown as AtpAgent)

    const states = await fetchViewerStates(uris)

    expect(getPosts).toHaveBeenCalledTimes(2)
    expect(states.size).toBe(25)
    const kept = uris[24] ?? ''
    const failed = uris[25] ?? ''
    expect(states.get(kept)).toEqual({ likeUri: `at://like/${kept}`, repostUri: null })
    // a uri from the failed batch stays absent instead of claiming null state
    expect(states.has(failed)).toBe(false)
  })

  it('rejects when every batch fails', async () => {
    const getPosts = vi.fn(async () => {
      throw new Error('viewer state unavailable')
    })
    const withProxy = vi.fn(() => ({ app: { bsky: { feed: { getPosts } } } }))
    vi.mocked(getAuthAgent).mockReturnValue({ withProxy } as unknown as AtpAgent)

    await expect(fetchViewerStates(['at://did:plc:test/app.bsky.feed.post/1'])).rejects.toThrow(
      'viewer state unavailable',
    )
  })

  it('reads nothing for an empty request', async () => {
    const getPosts = vi.fn(async () => ({ data: { posts: [] } }))
    const withProxy = vi.fn(() => ({ app: { bsky: { feed: { getPosts } } } }))
    vi.mocked(getAuthAgent).mockReturnValue({ withProxy } as unknown as AtpAgent)

    await expect(fetchViewerStates([])).resolves.toEqual(new Map())
    expect(getPosts).not.toHaveBeenCalled()
  })

  it('deletes a post record by at-uri', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await deletePost('at://did:plc:test/app.bsky.feed.post/abc123')

    expect(deleteRecord).toHaveBeenCalledWith({
      repo: 'did:plc:test',
      collection: 'app.bsky.feed.post',
      rkey: 'abc123',
    })
  })

  it('refuses to delete a record outside the post collection', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await expect(deletePost('at://did:plc:test/app.bsky.feed.like/abc123')).rejects.toThrow(
      'invalid post uri',
    )
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('refuses to delete a post owned by another repo', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await expect(deletePost('at://did:plc:other/app.bsky.feed.post/abc123')).rejects.toThrow(
      'invalid post uri',
    )
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('refuses an at-uri with more than five segments', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await expect(deletePost('at://did:plc:test/app.bsky.feed.post/abc123/extra')).rejects.toThrow(
      'invalid post uri',
    )
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('sends more and less feed interactions with feed context to the generator service', async () => {
    const sendInteractions = vi.fn(async () => ({}))
    const withProxy = vi.fn(() => ({ app: { bsky: { feed: { sendInteractions } } } }))
    vi.mocked(getAuthAgent).mockReturnValue({
      app: { bsky: { feed: { sendInteractions: vi.fn() } } },
      withProxy,
    } as unknown as AtpAgent)
    const post = { ...postFixture(), feedContext: 'ctx-1', reqId: 'req-1' }

    await sendFeedFeedback(GENERATOR_FEED, GENERATOR_DID, post, 'more')
    await sendFeedFeedback(GENERATOR_FEED, GENERATOR_DID, post, 'less')

    // interactions belong to the feed generator service named by its record did
    expect(withProxy).toHaveBeenCalledWith('bsky_fg', GENERATOR_DID)
    expect(sendInteractions).toHaveBeenNthCalledWith(1, {
      feed: GENERATOR_FEED,
      interactions: [
        {
          $type: 'app.bsky.feed.defs#interaction',
          item: post.uri,
          event: 'app.bsky.feed.defs#requestMore',
          feedContext: 'ctx-1',
          reqId: 'req-1',
        },
      ],
    })
    expect(sendInteractions).toHaveBeenNthCalledWith(2, {
      feed: GENERATOR_FEED,
      interactions: [
        {
          $type: 'app.bsky.feed.defs#interaction',
          item: post.uri,
          event: 'app.bsky.feed.defs#requestLess',
          feedContext: 'ctx-1',
          reqId: 'req-1',
        },
      ],
    })
  })

  it('puts the interaction on the pds wire and rejects a failed request', async () => {
    const transport = installTransport()
    const PDS = 'https://pds.test'
    transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
      jsonResponse(200, {
        did: 'did:plc:test',
        handle: 'test.bsky.social',
        accessJwt: 'access',
        refreshJwt: 'refresh',
        active: true,
      }),
    )
    const agent = new AtpAgent({ service: PDS })
    await agent.login({ identifier: 'test.bsky.social', password: 'app-pass' })
    vi.mocked(getAuthAgent).mockReturnValue(agent)
    transport.calls.length = 0

    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () =>
      jsonResponse(200, {}),
    )
    const post = { ...postFixture(), feedContext: 'ctx-1', reqId: 'req-1' }

    await sendFeedFeedback(GENERATOR_FEED, GENERATOR_DID, post, 'more')

    // the real SDK request is what crosses the wire, not an echoed mock argument
    const [call] = transport.calls
    expect(call?.method).toBe('POST')
    expect(new URL(call?.url ?? '').pathname).toBe('/xrpc/app.bsky.feed.sendInteractions')
    // the request still goes to the pds; the header names the feedgen service
    expect(new URL(call?.url ?? '').origin).toBe(PDS)
    expect(call?.headers['atproto-proxy']).toBe(`${GENERATOR_DID}#bsky_fg`)
    expect(JSON.parse(call?.body ?? '')).toEqual({
      feed: GENERATOR_FEED,
      interactions: [
        {
          $type: 'app.bsky.feed.defs#interaction',
          item: post.uri,
          event: 'app.bsky.feed.defs#requestMore',
          feedContext: 'ctx-1',
          reqId: 'req-1',
        },
      ],
    })

    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'feedback refused' }),
    )
    await expect(sendFeedFeedback(GENERATOR_FEED, GENERATOR_DID, post, 'less')).rejects.toThrow()
  })

  it('converts markdown markers into record facets', async () => {
    const { post } = fakeAgent()

    await createPost('**bold** and ~~gone~~')

    const record = posted(post)
    expect(record.text).toBe('bold and gone')
    expect(record.facets).toEqual([
      {
        index: { byteStart: 0, byteEnd: 4 },
        features: [{ $type: 'app.bsky.richtext.facet#bold' }],
      },
      {
        index: { byteStart: 9, byteEnd: 13 },
        features: [{ $type: 'app.bsky.richtext.facet#strikethrough' }],
      },
    ])
  })
})

describe('post composition', () => {
  it('keeps the original root on a nested reply and the parent it answers', async () => {
    const parent = postFixture()
    const root = { uri: 'at://did:plc:test/app.bsky.feed.post/root', cid: 'root-cid' }
    const nested = postFixture({
      uri: 'at://did:plc:test/app.bsky.feed.post/child',
      cid: 'child-cid',
      replyRoot: root,
      replyParent: { uri: parent.uri, cid: parent.cid },
    })
    const { post } = fakeAgent()

    await createReply('nested', nested)
    expect(posted(post).reply).toEqual({
      root,
      parent: { uri: nested.uri, cid: nested.cid },
    })

    await createReply('top level', parent)
    expect(posted(post, 1).reply).toEqual({
      root: { uri: parent.uri, cid: parent.cid },
      parent: { uri: parent.uri, cid: parent.cid },
    })
  })

  it('quotes the exact record it was opened from', async () => {
    const post = postFixture()
    const { post: send } = fakeAgent()

    await createQuote('worth reading', post)

    expect(posted(send).embed).toEqual({
      $type: 'app.bsky.embed.record',
      record: { uri: post.uri, cid: post.cid },
    })
  })

  it('keeps navigation intact through the standard wire segment walk', async () => {
    const { post } = fakeAgent()

    await createPost('see https://example.com **bold _and italic_**')

    const record = posted(post)
    expect(record.text).toBe('see https://example.com bold and italic')

    const segments = wireSegments(record)
    expect(segments.map((segment) => segment.text).join('')).toBe(record.text)
    expect(segments.filter((segment) => segment.link).map((segment) => segment.text)).toEqual([
      'https://example.com',
    ])
    expect(mappedSegments(record)).toEqual([
      { text: 'see ', kinds: [] },
      { text: 'https://example.com', kinds: ['link'] },
      { text: ' ', kinds: [] },
      { text: 'bold ', kinds: ['bold'] },
      { text: 'and italic', kinds: ['bold', 'italic'] },
    ])
  })

  it('splits emphasis around a link it contains', async () => {
    const { post } = fakeAgent()

    await createPost('**see https://example.com**')

    const record = posted(post)
    expect(record.text).toBe('see https://example.com')
    expect(
      wireSegments(record)
        .map((segment) => segment.text)
        .join(''),
    ).toBe(record.text)
    expect(mappedSegments(record)).toEqual([
      { text: 'see ', kinds: ['bold'] },
      { text: 'https://example.com', kinds: ['bold', 'link'] },
    ])
  })

  it('publishes one link when markdown and autodetection agree', async () => {
    const { post } = fakeAgent()

    await createPost('[https://example.com](https://example.com)')

    const links = (posted(post).facets ?? [])
      .flatMap((facet) => facet.features)
      .filter((feature) => feature.$type === 'app.bsky.richtext.facet#link')
    expect(links).toHaveLength(1)
  })

  it('keeps a whole mention span when only part of it is emphasized', async () => {
    const { post } = fakeAgent(async () => 'did:plc:alice')

    await createPost('é *@alice*.bsky.social')

    const record = posted(post)
    expect(record.text).toBe('é @alice.bsky.social')
    expect(
      wireSegments(record)
        .filter((segment) => segment.mention)
        .map((s) => s.text),
    ).toEqual(['@alice.bsky.social'])
    expect(mappedSegments(record)).toEqual([
      { text: 'é ', kinds: [] },
      { text: '@alice', kinds: ['italic', 'mention'] },
      { text: '.bsky.social', kinds: ['mention'] },
    ])
  })

  it('leaves an unresolved mention as plain text', async () => {
    const { post } = fakeAgent(async () => {
      throw new Error('no such handle')
    })

    await createPost('hello @nobody.test')

    const record = posted(post)
    expect(record.text).toBe('hello @nobody.test')
    const mentions = (record.facets ?? [])
      .flatMap((facet) => facet.features)
      .filter((feature) => 'did' in feature)
    expect(mentions).toEqual([])
  })

  it('refuses to publish when the account changed during handle resolution', async () => {
    const gate = Promise.withResolvers<void>()
    const sendA = vi.fn()
    const sendB = vi.fn()
    const resolveHandle = vi.fn(async () => {
      await gate.promise
      return { data: { did: 'did:plc:alice' } }
    })
    const agent = (send: typeof sendA) =>
      ({
        post: send,
        com: { atproto: { identity: { resolveHandle } } },
      }) as unknown as AtpAgent

    vi.mocked(getAuthAgent).mockReturnValue(agent(sendA))
    const sending = createPost('hi @alice.test')
    vi.mocked(getAuthAgent).mockReturnValue(agent(sendB))
    gate.resolve()

    await expect(sending).rejects.toThrow('account changed before the post could be sent')
    expect(sendA).not.toHaveBeenCalled()
    expect(sendB).not.toHaveBeenCalled()
  })
})
