import type { AtpSessionData } from '@atproto/api'
import { AtpAgent, RichText } from '@atproto/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postFixture } from '../test/fixtures'
import type { RouteRequest, TestTransport } from '../test/transport'
import { installTransport, jsonResponse } from '../test/transport'
import { createPost, createReply, deletePost, fetchViewerStates, sendFeedFeedback } from './actions'
import { getAuthAgent } from './auth'
import { segmentText } from './facets'
import { mapFacets } from './model'
import { isRecord } from './records'

vi.mock('./auth', () => ({
  getAuthAgent: vi.fn(),
}))

const PDS = 'https://pds.test'
const OWN_DID = 'did:plc:test'
const APPVIEW_PROXY = 'did:web:api.bsky.app#bsky_appview'
const CREATE_RECORD = '/xrpc/com.atproto.repo.createRecord'
const DELETE_RECORD = '/xrpc/com.atproto.repo.deleteRecord'
const RESOLVE_HANDLE = '/xrpc/com.atproto.identity.resolveHandle'
const GET_POSTS = '/xrpc/app.bsky.feed.getPosts'
const SEND_INTERACTIONS = '/xrpc/app.bsky.feed.sendInteractions'
// a real CID: the SDK validates the createRecord response cid
const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
const LIKE_URI = `at://${OWN_DID}/app.bsky.feed.like/3klike`

const GENERATOR_FEED = 'at://did:plc:test/app.bsky.feed.generator/one'
const GENERATOR_DID = 'did:web:feeds.test'

interface StrongRef {
  uri: string
  cid: string
}

type WireFeature =
  | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  | { $type: 'app.bsky.richtext.facet#bold' }
  | { $type: 'app.bsky.richtext.facet#italic' }
  | { $type: 'app.bsky.richtext.facet#strikethrough' }

interface PostedFacet {
  index: { byteStart: number; byteEnd: number }
  features: WireFeature[]
}

interface PostedRecord {
  text: string
  facets: PostedFacet[] | undefined
  reply: { root: StrongRef; parent: StrongRef } | undefined
  embed: { $type: string; record: StrongRef } | undefined
}

let transport: TestTransport

function signedInAgent(did = OWN_DID): AtpAgent {
  const agent = new AtpAgent({ service: PDS })
  const session: AtpSessionData = {
    accessJwt: 'access',
    refreshJwt: 'refresh',
    handle: 'test.bsky.social',
    did,
    active: true,
  }
  agent.sessionManager.session = session
  return agent
}

function routeCreateRecord(): void {
  transport.route('POST', `${PDS}${CREATE_RECORD}`, () =>
    jsonResponse(200, { uri: `at://${OWN_DID}/app.bsky.feed.post/3krecord`, cid: CID }),
  )
}

function malformed(reason: string): never {
  throw new Error(`malformed createRecord body: ${reason}`)
}

function parseJson(body: string | null): unknown {
  if (body === null) malformed('no body')
  return JSON.parse(body)
}

function readStrongRef(value: unknown, field: string): StrongRef {
  if (!isRecord(value)) malformed(`${field} is not an object`)
  if (typeof value['uri'] !== 'string' || typeof value['cid'] !== 'string') {
    malformed(`${field} lacks a string uri and cid`)
  }
  return { uri: value['uri'], cid: value['cid'] }
}

function readFeature(value: unknown): WireFeature {
  if (!isRecord(value)) malformed('facet feature is not an object')
  const type = value['$type']
  if (typeof type !== 'string') malformed('facet feature has no $type')

  switch (type) {
    case 'app.bsky.richtext.facet#mention':
      if (typeof value['did'] !== 'string') malformed('mention feature has no did')
      return { $type: type, did: value['did'] }
    case 'app.bsky.richtext.facet#link':
      if (typeof value['uri'] !== 'string') malformed('link feature has no uri')
      return { $type: type, uri: value['uri'] }
    case 'app.bsky.richtext.facet#tag':
      if (typeof value['tag'] !== 'string') malformed('tag feature has no tag')
      return { $type: type, tag: value['tag'] }
    case 'app.bsky.richtext.facet#bold':
    case 'app.bsky.richtext.facet#italic':
    case 'app.bsky.richtext.facet#strikethrough':
      return { $type: type }
    default:
      malformed(`unsupported facet feature ${type}`)
  }
}

function readFacet(value: unknown): PostedFacet {
  if (!isRecord(value)) malformed('facet is not an object')
  if (!isRecord(value['index'])) malformed('facet has no index')
  const { byteStart, byteEnd } = value['index']
  if (typeof byteStart !== 'number' || !Number.isInteger(byteStart)) {
    malformed('facet byteStart is not an integer')
  }
  if (typeof byteEnd !== 'number' || !Number.isInteger(byteEnd)) {
    malformed('facet byteEnd is not an integer')
  }
  if (!Array.isArray(value['features'])) malformed('facet has no feature array')

  return {
    index: { byteStart, byteEnd },
    features: value['features'].map(readFeature),
  }
}

function readFacets(value: unknown): PostedFacet[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) malformed('facets is not an array')
  return value.map(readFacet)
}

function readReply(value: unknown): PostedRecord['reply'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) malformed('reply is not an object')
  return {
    root: readStrongRef(value['root'], 'reply.root'),
    parent: readStrongRef(value['parent'], 'reply.parent'),
  }
}

function readEmbed(value: unknown): PostedRecord['embed'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) malformed('embed is not an object')
  if (typeof value['$type'] !== 'string') malformed('embed has no $type')
  return { $type: value['$type'], record: readStrongRef(value['record'], 'embed.record') }
}

function parsePostedRecord(body: string | null): PostedRecord {
  const payload = parseJson(body)
  if (!isRecord(payload)) malformed('body is not an object')
  if (payload['collection'] !== 'app.bsky.feed.post') malformed('not a post record')
  const record = payload['record']
  if (!isRecord(record)) malformed('body has no record object')
  if (typeof record['text'] !== 'string') malformed('record text is not a string')

  return {
    text: record['text'],
    facets: readFacets(record['facets']),
    reply: readReply(record['reply']),
    embed: readEmbed(record['embed']),
  }
}

function isCreateRecord(call: RouteRequest): boolean {
  return call.method === 'POST' && new URL(call.url).pathname === CREATE_RECORD
}

// reads the records this test actually put on the wire, validated before use
function postedRecords(): PostedRecord[] {
  return transport.calls.filter(isCreateRecord).map((call) => parsePostedRecord(call.body))
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

function postView(uri: string, viewer?: Record<string, string>) {
  return {
    uri,
    cid: CID,
    author: { did: OWN_DID, handle: 'test.bsky.social' },
    record: { $type: 'app.bsky.feed.post', text: 'hello', createdAt: '2026-10-29T12:00:00.000Z' },
    indexedAt: '2026-10-29T12:00:00.000Z',
    ...(viewer === undefined ? {} : { viewer }),
  }
}

function signedIn(): void {
  vi.mocked(getAuthAgent).mockReturnValue(signedInAgent())
}

beforeEach(() => {
  vi.mocked(getAuthAgent).mockReset()
  transport = installTransport()
})

describe('fetchViewerStates', () => {
  it('routes viewer-state reads through the official appview proxy', async () => {
    const uri = `at://${OWN_DID}/app.bsky.feed.post/1`
    transport.route('GET', `${PDS}${GET_POSTS}`, (request) => {
      const requested = new URL(request.url).searchParams.getAll('uris')
      return jsonResponse(200, {
        posts: requested.map((requestedUri) => postView(requestedUri, { like: LIKE_URI })),
      })
    })
    signedIn()

    const states = await fetchViewerStates([uri])

    expect(transport.calls).toHaveLength(1)
    const [call] = transport.calls
    expect(call?.method).toBe('GET')
    expect(new URL(call?.url ?? '').pathname).toBe(GET_POSTS)
    // the wire carries repeated uris params, not one joined value
    expect(new URL(call?.url ?? '').searchParams.getAll('uris')).toEqual([uri])
    expect(call?.headers['atproto-proxy']).toBe(APPVIEW_PROXY)
    expect(call?.headers['authorization']).toBe('Bearer access')
    expect(states.get(uri)).toEqual({ likeUri: LIKE_URI, repostUri: null })
  })

  it('keeps the batches that answered when another batch fails', async () => {
    const uris = Array.from(
      { length: 26 },
      (_, index) => `at://${OWN_DID}/app.bsky.feed.post/${index}`,
    )
    // neither request may answer before both have started: a serial read would
    // deadlock here instead of quietly passing
    let started = 0
    const bothStarted = Promise.withResolvers<void>()
    transport.route('GET', `${PDS}${GET_POSTS}`, async (request) => {
      started += 1
      if (started === 2) bothStarted.resolve()
      await bothStarted.promise

      const requested = new URL(request.url).searchParams.getAll('uris')
      if (requested.length === 1) {
        return jsonResponse(500, {
          error: 'InternalServerError',
          message: 'viewer state unavailable',
        })
      }
      return jsonResponse(200, {
        posts: requested.map((requestedUri) => postView(requestedUri, { like: LIKE_URI })),
      })
    })
    signedIn()

    const states = await fetchViewerStates(uris)

    expect(transport.calls).toHaveLength(2)
    const batches = transport.calls.map((call) => new URL(call.url).searchParams.getAll('uris'))
    expect(batches.map((batch) => batch.length)).toEqual([25, 1])
    expect(batches[0]).toEqual(uris.slice(0, 25))
    expect(batches[1]).toEqual(uris.slice(25))
    expect(states.size).toBe(25)

    const kept = uris[24] ?? ''
    const failed = uris[25] ?? ''
    expect(states.get(kept)).toEqual({ likeUri: LIKE_URI, repostUri: null })
    // a uri from the failed batch stays absent instead of claiming null state
    expect(states.has(failed)).toBe(false)
  })

  it('rejects when every batch fails', async () => {
    transport.route('GET', `${PDS}${GET_POSTS}`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'viewer state unavailable' }),
    )
    signedIn()

    await expect(fetchViewerStates([`at://${OWN_DID}/app.bsky.feed.post/1`])).rejects.toThrow(
      'viewer state unavailable',
    )
  })

  it('reads nothing for an empty request', async () => {
    signedIn()

    await expect(fetchViewerStates([])).resolves.toEqual(new Map())
    expect(transport.calls).toEqual([])
  })
})

describe('deletePost', () => {
  it('deletes a post record by at-uri', async () => {
    transport.route('POST', `${PDS}${DELETE_RECORD}`, () => jsonResponse(200, {}))
    signedIn()

    await deletePost(`at://${OWN_DID}/app.bsky.feed.post/abc123`)

    expect(transport.calls).toHaveLength(1)
    const [call] = transport.calls
    expect(call?.method).toBe('POST')
    expect(new URL(call?.url ?? '').pathname).toBe(DELETE_RECORD)
    expect(call?.headers['authorization']).toBe('Bearer access')
    expect(parseJson(call?.body ?? null)).toEqual({
      repo: OWN_DID,
      collection: 'app.bsky.feed.post',
      rkey: 'abc123',
    })
  })

  it.each([
    ['another collection', `at://${OWN_DID}/app.bsky.feed.like/abc123`],
    ['another repo', `at://did:plc:other/app.bsky.feed.post/abc123`],
    ['extra segments', `at://${OWN_DID}/app.bsky.feed.post/abc123/extra`],
  ])('refuses a post uri from %s without touching the wire', async (_label, uri) => {
    signedIn()

    await expect(deletePost(uri)).rejects.toThrow('invalid post uri')
    expect(transport.calls).toEqual([])
  })
})

describe('sendFeedFeedback', () => {
  it('sends more and less interactions with feed context to the generator service', async () => {
    transport.route('POST', `${PDS}${SEND_INTERACTIONS}`, () => jsonResponse(200, {}))
    signedIn()
    const post = { ...postFixture(), feedContext: 'ctx-1', reqId: 'req-1' }

    await sendFeedFeedback(GENERATOR_FEED, GENERATOR_DID, post, 'more')
    await sendFeedFeedback(GENERATOR_FEED, GENERATOR_DID, post, 'less')

    expect(transport.calls).toHaveLength(2)
    const bodies = transport.calls.map((call) => parseJson(call.body))
    expect(bodies).toEqual([
      {
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
      },
      {
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
      },
    ])
    for (const call of transport.calls) {
      // the request still goes to the pds; the header names the feedgen service
      expect(new URL(call.url).origin).toBe(PDS)
      expect(call.headers['atproto-proxy']).toBe(`${GENERATOR_DID}#bsky_fg`)
      expect(call.headers['authorization']).toBe('Bearer access')
    }
  })

  it('rejects when the generator refuses the interaction', async () => {
    transport.route('POST', `${PDS}${SEND_INTERACTIONS}`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'feedback refused' }),
    )
    signedIn()

    await expect(
      sendFeedFeedback(GENERATOR_FEED, GENERATOR_DID, postFixture(), 'less'),
    ).rejects.toThrow('feedback refused')
  })
})

describe('post composition', () => {
  it('publishes markdown markers literally with no style facets', async () => {
    routeCreateRecord()
    signedIn()

    await createPost('**bold** and ~~gone~~')

    const [record] = postedRecords()
    expect(record?.text).toBe('**bold** and ~~gone~~')
    expect(record?.facets ?? []).toEqual([])
  })

  it('keeps the original root on a nested reply and the parent it answers', async () => {
    routeCreateRecord()
    signedIn()
    const parent = postFixture()
    const root = { uri: 'at://did:plc:test/app.bsky.feed.post/root', cid: 'root-cid' }
    const nested = postFixture({
      uri: 'at://did:plc:test/app.bsky.feed.post/child',
      cid: 'child-cid',
      replyRoot: root,
      replyParent: { uri: parent.uri, cid: parent.cid },
    })

    await createReply('nested', nested)
    await createReply('top level', parent)

    const records = postedRecords()
    expect(records[0]?.reply).toEqual({
      root,
      parent: { uri: nested.uri, cid: nested.cid },
    })
    expect(records[1]?.reply).toEqual({
      root: { uri: parent.uri, cid: parent.cid },
      parent: { uri: parent.uri, cid: parent.cid },
    })
  })

  it('keeps navigation intact through the standard wire segment walk', async () => {
    routeCreateRecord()
    signedIn()

    await createPost('see https://example.com **bold _and italic_**')

    const [record] = postedRecords()
    if (record === undefined) throw new Error('nothing was posted')
    expect(record.text).toBe('see https://example.com **bold _and italic_**')

    const segments = wireSegments(record)
    expect(segments.map((segment) => segment.text).join('')).toBe(record.text)
    expect(segments.filter((segment) => segment.link).map((segment) => segment.text)).toEqual([
      'https://example.com',
    ])
    expect(mappedSegments(record)).toEqual([
      { text: 'see ', kinds: [] },
      { text: 'https://example.com', kinds: ['link'] },
      { text: ' **bold _and italic_**', kinds: [] },
    ])
  })

  it('keeps a bare url as one automatic link beside literal markers', async () => {
    routeCreateRecord()
    signedIn()

    await createPost('**see https://example.com**')

    const [record] = postedRecords()
    if (record === undefined) throw new Error('nothing was posted')
    expect(record.text).toBe('**see https://example.com**')
    // autodetection owns the bare url: the trailing markers sit inside its span
    expect(mappedSegments(record)).toEqual([
      { text: '**see ', kinds: [] },
      { text: 'https://example.com**', kinds: ['link'] },
    ])
  })

  it('publishes a labelled link as its label with the exact destination', async () => {
    routeCreateRecord()
    signedIn()

    await createPost('see [label](https://example.com/a_(b))')

    const [record] = postedRecords()
    if (record === undefined) throw new Error('nothing was posted')
    expect(record.text).toBe('see label')
    expect(record.facets).toEqual([
      {
        index: { byteStart: 4, byteEnd: 9 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.com/a_(b)',
          },
        ],
      },
    ])
  })

  it('publishes one link when markdown and autodetection agree', async () => {
    routeCreateRecord()
    signedIn()

    await createPost('[https://example.com](https://example.com)')

    const [record] = postedRecords()
    const links = (record?.facets ?? [])
      .flatMap((facet) => facet.features)
      .filter((feature) => feature.$type === 'app.bsky.richtext.facet#link')
    expect(links).toHaveLength(1)
  })

  it('keeps a mention as one automatic facet beside literal markers', async () => {
    routeCreateRecord()
    transport.route('GET', `${PDS}${RESOLVE_HANDLE}`, () =>
      jsonResponse(200, { did: 'did:plc:alice' }),
    )
    signedIn()

    await createPost('*see @alice.bsky.social*')

    const [record] = postedRecords()
    if (record === undefined) throw new Error('nothing was posted')
    expect(record.text).toBe('*see @alice.bsky.social*')
    expect(
      wireSegments(record)
        .filter((segment) => segment.mention)
        .map((segment) => segment.text),
    ).toEqual(['@alice.bsky.social'])
    expect(mappedSegments(record)).toEqual([
      { text: '*see ', kinds: [] },
      { text: '@alice.bsky.social', kinds: ['mention'] },
      { text: '*', kinds: [] },
    ])
  })

  it('leaves an unresolved mention as plain text', async () => {
    routeCreateRecord()
    transport.route('GET', `${PDS}${RESOLVE_HANDLE}`, () =>
      jsonResponse(400, { error: 'InvalidRequest', message: 'no such handle' }),
    )
    signedIn()

    await createPost('hello @nobody.test')

    const [record] = postedRecords()
    expect(record?.text).toBe('hello @nobody.test')
    const mentions = (record?.facets ?? [])
      .flatMap((facet) => facet.features)
      .filter((feature) => feature.$type === 'app.bsky.richtext.facet#mention')
    expect(mentions).toEqual([])
    // the resolve attempt itself reached the wire before returning an empty did
    expect(transport.calls.map((call) => new URL(call.url).pathname)).toEqual([
      RESOLVE_HANDLE,
      CREATE_RECORD,
    ])
  })

  it('refuses to publish when the account changed during handle resolution', async () => {
    routeCreateRecord()
    const gate = Promise.withResolvers<void>()
    transport.route('GET', `${PDS}${RESOLVE_HANDLE}`, async () => {
      await gate.promise
      return jsonResponse(200, { did: 'did:plc:alice' })
    })

    const first = signedInAgent(OWN_DID)
    const second = signedInAgent('did:plc:other')
    vi.mocked(getAuthAgent).mockReturnValue(first)
    const sending = createPost('hi @alice.test')
    vi.mocked(getAuthAgent).mockReturnValue(second)
    gate.resolve()

    await expect(sending).rejects.toThrow('account changed before the post could be sent')
    expect(postedRecords()).toEqual([])
  })
})
