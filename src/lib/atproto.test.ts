import type { AppBskyActorDefs, AtpSessionData } from '@atproto/api'
import { beforeEach, describe, expect, it } from 'vitest'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import {
  fetchFeedPage,
  fetchPinnedFeeds,
  fetchProfile,
  fetchThread,
  pinnedFeedUris,
} from './atproto'
import { useAuthStore } from './auth'
import { fetchNotifications } from './notifications'

const ALICE: AtpSessionData = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

const BRAVO: AtpSessionData = {
  did: 'did:plc:bravo',
  handle: 'bravo.test',
  accessJwt: 'bravo-access',
  refreshJwt: 'bravo-refresh',
  active: true,
}

// lexicon validation rejects invented cid strings
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'

const FEED_URI = 'at://did:plc:test/app.bsky.feed.generator/one'

const PDS_A = 'https://pds.a.test'
const PDS_B = 'https://pds.b.test'
// the one read service every fetcher builds its agent for
const APPVIEW = 'https://api.bsky.app'

function wirePost(index: number, parentUri?: string) {
  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text: `post ${index}`,
    createdAt: '2026-10-29T12:00:00.000Z',
  }
  if (parentUri !== undefined) {
    const ref = { uri: parentUri, cid: CID }
    record['reply'] = { root: ref, parent: ref }
  }
  return {
    uri: `at://did:plc:test/app.bsky.feed.post/${index}`,
    cid: CID,
    author: { did: 'did:plc:test', handle: 'test.bsky.social' },
    record,
    indexedAt: '2026-10-29T12:00:00.000Z',
  }
}

function profileView(overrides: Record<string, unknown> = {}) {
  return { did: 'did:plc:target', handle: 'target.test', displayName: 'target host', ...overrides }
}

const HIDDEN_DID = 'did:plc:hidden'
const HIDDEN_AUTHOR = { did: HIDDEN_DID, handle: 'hidden.test' }
const VISIBLE_AUTHOR = { did: 'did:plc:test', handle: 'test.bsky.social' }

function hiddenWirePost(index: number) {
  return { ...wirePost(index), author: HIDDEN_AUTHOR }
}

function quoteViewRecord(author: Record<string, unknown>, text: string) {
  return {
    $type: 'app.bsky.embed.record#viewRecord',
    uri: `at://${String(author['did'])}/app.bsky.feed.post/quoted`,
    cid: CID,
    author,
    value: { $type: 'app.bsky.feed.post', text, createdAt: '2026-10-29T12:00:00.000Z' },
    indexedAt: '2026-10-29T12:00:00.000Z',
  }
}

function quoteEmbed(author: Record<string, unknown>, text: string) {
  return { $type: 'app.bsky.embed.record#view', record: quoteViewRecord(author, text) }
}

const IMAGES_VIEW = {
  $type: 'app.bsky.embed.images#view',
  images: [
    {
      $type: 'app.bsky.embed.images#viewImage',
      thumb: 'https://cdn.example/thumb.png',
      fullsize: 'https://cdn.example/full.png',
      alt: '',
    },
  ],
}

function threadViewPost(post: Record<string, unknown>, replies: unknown[] = []) {
  return { $type: 'app.bsky.feed.defs#threadViewPost', post, replies }
}

let transport: TestTransport

beforeEach(async () => {
  transport = installTransport()
  transport.route('POST', `${PDS_A}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, ALICE),
  )
  transport.route('POST', `${PDS_B}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, BRAVO),
  )
  transport.route('POST', `${PDS_A}/xrpc/com.atproto.server.deleteSession`, () =>
    jsonResponse(200, {}),
  )
  transport.route('POST', `${PDS_B}/xrpc/com.atproto.server.deleteSession`, () =>
    jsonResponse(200, {}),
  )

  await useAuthStore.getState().signOut()
  transport.calls.length = 0
})

// signed-in feed reads hydrate hidden authors and reply parents best effort;
// answering "nothing to change" keeps each case's own wire the subject
function routeQuietViewerReads(host = PDS_A): void {
  transport.route('GET', `${host}/xrpc/app.bsky.actor.getProfiles`, () =>
    jsonResponse(200, { profiles: [] }),
  )
  transport.route('GET', `${host}/xrpc/app.bsky.feed.getPosts`, () =>
    jsonResponse(200, { posts: [] }),
  )
}

async function signIn(session: AtpSessionData, service: string): Promise<void> {
  transport.route('GET', `https://plc.directory/${session.did}`, () =>
    jsonResponse(200, {
      id: session.did,
      service: [
        { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: service },
      ],
    }),
  )
  await expect(useAuthStore.getState().signIn(session.did, 'password')).resolves.toBe(true)
}

describe('fetchFeedPage', () => {
  it('distinguishes the public reader from the signed-in one by origin', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1) }] }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(2) }] }),
    )

    const anonymous = await fetchFeedPage({ kind: 'feed', uri: FEED_URI }, null)
    expect(anonymous.posts[0]?.text).toBe('post 1')

    routeQuietViewerReads()
    await signIn(ALICE, PDS_A)
    const signedIn = await fetchFeedPage({ kind: 'feed', uri: FEED_URI }, ALICE.did)
    expect(signedIn.posts[0]?.text).toBe('post 2')
  })

  it('drops muted and blocked authors and their reposts from a page', async () => {
    const muted = {
      ...wirePost(1),
      author: { did: 'did:plc:muted', handle: 'muted.test', viewer: { muted: true } },
    }
    const blocked = {
      ...wirePost(2),
      author: { did: 'did:plc:blocked', handle: 'blocked.test', viewer: { blockedBy: true } },
    }
    const reposted = {
      post: wirePost(4),
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        by: { did: 'did:plc:muted', handle: 'muted.test', viewer: { muted: true } },
        indexedAt: '2026-10-29T12:00:00.000Z',
      },
    }
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, {
        feed: [{ post: muted }, { post: blocked }, { post: wirePost(3) }, reposted],
      }),
    )
    routeQuietViewerReads()
    await signIn(ALICE, PDS_A)

    const page = await fetchFeedPage({ kind: 'feed', uri: FEED_URI }, ALICE.did)
    expect(page.posts.map((post) => post.text)).toEqual(['post 3'])
  })

  it('reads author and search feeds from the canonical appview for any owner', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
      jsonResponse(200, { posts: [] }),
    )
    await signIn(ALICE, PDS_A)
    transport.calls.length = 0

    await fetchFeedPage({ kind: 'author', actor: 'alice.test' }, ALICE.did)
    await fetchFeedPage({ kind: 'search', query: 'cats' }, ALICE.did)

    expect(transport.calls.map((call) => new URL(call.url).origin)).toEqual([APPVIEW, APPVIEW])
  })

  it('never hydrates reply parents on a list page', async () => {
    const parent = 'at://did:plc:test/app.bsky.feed.post/parent-0'
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
      jsonResponse(200, { posts: [wirePost(1, parent)] }),
    )

    const page = await fetchFeedPage({ kind: 'search', query: 'cats' }, null)

    expect(page.posts).toHaveLength(1)
    expect(page.posts[0]?.replyContext).toBeNull()
    expect(transport.calls.some((call) => call.url.includes('getPosts'))).toBe(false)
  })

  it('drops a search author the canonical appview reports as muted', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
      jsonResponse(200, {
        posts: [
          wirePost(1),
          { ...wirePost(2), author: { did: 'did:plc:muted', handle: 'muted.test' } },
        ],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [
          { did: 'did:plc:test', handle: 'test.bsky.social' },
          { did: 'did:plc:muted', handle: 'muted.test', viewer: { muted: true } },
        ],
      }),
    )
    await signIn(ALICE, PDS_A)
    transport.calls.length = 0

    const page = await fetchFeedPage({ kind: 'search', query: 'cats' }, ALICE.did)

    expect(page.posts.map((post) => post.text)).toEqual(['post 1'])
    const viewerStateCalls = transport.calls.filter((call) =>
      call.url.includes('app.bsky.actor.getProfiles'),
    )
    expect(viewerStateCalls.map((call) => new URL(call.url).origin)).toEqual([PDS_A])
    expect(transport.calls.some((call) => new URL(call.url).origin === APPVIEW)).toBe(true)
  })

  it('keeps search posts for an anonymous reader without asking for viewer state', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
      jsonResponse(200, {
        posts: [{ ...wirePost(1), author: { did: 'did:plc:muted', handle: 'muted.test' } }],
      }),
    )

    const page = await fetchFeedPage({ kind: 'search', query: 'cats' }, null)

    expect(page.posts.map((post) => post.text)).toEqual(['post 1'])
    const viewerStateCalls = transport.calls.filter((call) =>
      call.url.includes('app.bsky.actor.getProfiles'),
    )
    expect(viewerStateCalls).toEqual([])
  })

  it('prunes hidden quotes and media quotes from a search page', async () => {
    const parentUri = `at://${HIDDEN_DID}/app.bsky.feed.post/parent`
    const visibleParentUri = 'at://did:plc:test/app.bsky.feed.post/visible-parent'
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
      jsonResponse(200, {
        posts: [
          wirePost(1, parentUri),
          { ...wirePost(2), embed: quoteEmbed(HIDDEN_AUTHOR, 'hidden quote') },
          {
            ...wirePost(3),
            embed: {
              $type: 'app.bsky.embed.recordWithMedia#view',
              record: { record: quoteViewRecord(HIDDEN_AUTHOR, 'hidden media quote') },
              media: IMAGES_VIEW,
            },
          },
          { ...wirePost(4), embed: quoteEmbed(VISIBLE_AUTHOR, 'visible quote') },
          wirePost(5, visibleParentUri),
        ],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [{ did: HIDDEN_DID, handle: 'hidden.test', viewer: { muted: true } }],
      }),
    )
    await signIn(ALICE, PDS_A)

    const page = await fetchFeedPage({ kind: 'search', query: 'cats' }, ALICE.did)
    const byText = new Map(page.posts.map((post) => [post.text, post]))

    // list pages carry no reply-parent context for either post
    expect(byText.get('post 1')?.replyContext).toBeNull()
    expect(byText.get('post 5')?.replyContext).toBeNull()
    expect(byText.get('post 2')?.embed).toBeNull()
    // a record-with-media keeps its images when only the quoted post is hidden
    expect(byText.get('post 3')?.embed).toEqual({
      type: 'images',
      images: [
        {
          thumb: 'https://cdn.example/thumb.png',
          fullsize: 'https://cdn.example/full.png',
          alt: '',
          width: null,
          height: null,
        },
      ],
    })
    expect(byText.get('post 4')?.embed?.type).toBe('quote')
  })

  it('discards a post reposted by a hidden account without exposing the original', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
      jsonResponse(200, {
        feed: [
          {
            post: wirePost(2),
            reason: {
              $type: 'app.bsky.feed.defs#reasonRepost',
              by: HIDDEN_AUTHOR,
              indexedAt: '2026-10-29T12:00:00.000Z',
            },
          },
          { post: wirePost(1) },
        ],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [
          {
            did: HIDDEN_DID,
            handle: 'hidden.test',
            viewer: { blocking: 'at://did:plc:alice/app.bsky.graph.block/1' },
          },
        ],
      }),
    )
    await signIn(ALICE, PDS_A)

    const page = await fetchFeedPage({ kind: 'author', actor: 'candidate.test' }, ALICE.did)

    expect(page.posts.map((post) => post.text)).toEqual(['post 1'])
  })

  it('prunes a hidden quote from a signed-in generator page', async () => {
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, {
        feed: [{ post: { ...wirePost(1), embed: quoteEmbed(HIDDEN_AUTHOR, 'hidden quote') } }],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [{ did: HIDDEN_DID, handle: 'hidden.test', viewer: { muted: true } }],
      }),
    )
    await signIn(ALICE, PDS_A)

    const page = await fetchFeedPage({ kind: 'feed', uri: FEED_URI }, ALICE.did)

    expect(page.posts).toHaveLength(1)
    expect(page.posts[0]?.embed).toBeNull()
  })
})

describe('fetchThread', () => {
  it('keeps the focus post and drops a reply the viewer has muted', async () => {
    const mutedReply = {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: { ...wirePost(2), author: { did: 'did:plc:muted', handle: 'muted.test' } },
      replies: [],
    }
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getPostThread`, () =>
      jsonResponse(200, {
        thread: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: wirePost(1),
          replies: [mutedReply],
        },
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [
          {
            did: 'did:plc:muted',
            handle: 'muted.test',
            viewer: { blocking: 'at://did:plc:alice/app.bsky.graph.block/1' },
          },
        ],
      }),
    )
    await signIn(ALICE, PDS_A)

    const thread = await fetchThread('at://did:plc:test/app.bsky.feed.post/1', ALICE.did)

    expect(thread.entries.map((entry) => entry.role)).toEqual(['focus'])
    expect(thread.entries[0]?.post.text).toBe('post 1')
  })

  it('takes a hidden reply subtree with it and prunes the focus quote', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getPostThread`, () =>
      jsonResponse(200, {
        thread: threadViewPost(
          { ...wirePost(1), embed: quoteEmbed(HIDDEN_AUTHOR, 'hidden quote') },
          [
            threadViewPost(hiddenWirePost(2), [threadViewPost(wirePost(3))]),
            threadViewPost(wirePost(4)),
          ],
        ),
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [{ did: HIDDEN_DID, handle: 'hidden.test', viewer: { muted: true } }],
      }),
    )
    await signIn(ALICE, PDS_A)

    const thread = await fetchThread('at://did:plc:test/app.bsky.feed.post/1', ALICE.did)

    // the focus post stays, the hidden reply and its visible child do not
    expect(thread.entries.map((entry) => entry.post.text)).toEqual(['post 1', 'post 4'])
    expect(thread.entries[0]?.post.embed).toBeNull()
  })

  it('keeps the focus post when its only ancestor is hidden', async () => {
    const parentUri = `at://${HIDDEN_DID}/app.bsky.feed.post/parent`
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getPostThread`, () =>
      jsonResponse(200, {
        thread: {
          ...threadViewPost(wirePost(2, parentUri)),
          parent: threadViewPost({ ...hiddenWirePost(1), uri: parentUri }),
        },
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [{ did: HIDDEN_DID, handle: 'hidden.test', viewer: { muted: true } }],
      }),
    )
    await signIn(ALICE, PDS_A)

    const thread = await fetchThread('at://did:plc:test/app.bsky.feed.post/2', ALICE.did)

    expect(thread.entries.map((entry) => entry.post.text)).toEqual(['post 2'])
    // the hidden ancestor's text must not survive as the focus reply context
    expect(thread.entries[0]?.post.replyContext).toBeNull()
  })

  it('counts the thread cap after hidden replies are removed', async () => {
    const hiddenReplies = Array.from({ length: 80 }, (_, index) =>
      threadViewPost({
        ...hiddenWirePost(index),
        uri: `at://did:plc:hidden/app.bsky.feed.post/h${index}`,
      }),
    )
    const visibleReplies = Array.from({ length: 20 }, (_, index) =>
      threadViewPost({
        ...wirePost(index),
        uri: `at://did:plc:test/app.bsky.feed.post/v${index}`,
      }),
    )
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getPostThread`, () =>
      jsonResponse(200, {
        thread: threadViewPost(wirePost(1), [...hiddenReplies, ...visibleReplies]),
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, () =>
      jsonResponse(200, {
        profiles: [{ did: HIDDEN_DID, handle: 'hidden.test', viewer: { muted: true } }],
      }),
    )
    await signIn(ALICE, PDS_A)

    const thread = await fetchThread('at://did:plc:test/app.bsky.feed.post/1', ALICE.did)

    expect(thread.entries).toHaveLength(21)
    expect(thread.entries.slice(1).map((entry) => entry.post.uri)).toEqual(
      visibleReplies.map((reply) => reply.post['uri']),
    )
  })
})

describe('account-scoped reads', () => {
  it('refuses a delayed query for a previous account without sending it', async () => {
    await signIn(ALICE, PDS_A)
    await signIn(BRAVO, PDS_B)
    transport.calls.length = 0

    await expect(fetchFeedPage({ kind: 'feed', uri: FEED_URI }, ALICE.did)).rejects.toThrow(
      'account changed before the request could be sent',
    )
    await expect(fetchPinnedFeeds(ALICE.did)).rejects.toThrow(
      'account changed before the request could be sent',
    )
    await expect(fetchNotifications(ALICE.did)).rejects.toThrow(
      'account changed before the request could be sent',
    )
    expect(transport.calls).toEqual([])
  })

  it('keeps the private pinned feed list on the pds through the canonical proxy', async () => {
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getPreferences`, () =>
      jsonResponse(200, {
        preferences: [
          {
            $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
            items: [{ id: '1', type: 'feed', value: FEED_URI, pinned: true }],
          },
        ],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getFeedGenerators`, () =>
      jsonResponse(200, {
        feeds: [
          {
            uri: FEED_URI,
            cid: CID,
            did: 'did:plc:test',
            creator: { did: 'did:plc:test', handle: 'test.bsky.social' },
            displayName: 'One',
            description: 'first',
            indexedAt: '2026-10-29T12:00:00.000Z',
          },
        ],
      }),
    )
    await signIn(ALICE, PDS_A)
    transport.calls.length = 0

    const feeds = await fetchPinnedFeeds(ALICE.did)

    expect(feeds).toEqual([
      {
        uri: FEED_URI,
        name: 'One',
        description: 'first',
        avatar: null,
        generatorDid: 'did:plc:test',
        // the lexicon field is optional, so omitted metadata is unknown rather
        // than a refusal; only an explicit false disables feed feedback
        acceptsInteractions: null,
      },
    ])
    expect(transport.calls.map((call) => new URL(call.url).origin)).toEqual([PDS_A, PDS_A])
    expect(transport.calls.some((call) => new URL(call.url).origin === APPVIEW)).toBe(false)
  })

  it('reads a pinned feed through the account agent', async () => {
    await signIn(ALICE, PDS_A)
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )

    await fetchFeedPage({ kind: 'feed', uri: FEED_URI }, ALICE.did)

    const call = transport.calls.find((entry) => entry.url.includes('getFeed'))
    expect(new URL(call?.url ?? '').searchParams.get('feed')).toBe(FEED_URI)
    expect(new URL(call?.url ?? '').origin).toBe(PDS_A)
  })
})

describe('fetchProfile', () => {
  it('keeps public fields from the public appview and private state from the account', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, profileView({ displayName: 'public appview name' })),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(
        200,
        profileView({
          displayName: 'canonical name',
          viewer: {
            following: 'at://did:plc:alice/app.bsky.graph.follow/1',
            muted: true,
            activitySubscription: { post: true, reply: false },
          },
        }),
      ),
    )
    await signIn(ALICE, PDS_A)
    transport.calls.length = 0

    const profile = await fetchProfile('target.test', ALICE.did)

    expect(profile.displayName).toBe('public appview name')
    expect(profile.viewer.following).toBe('at://did:plc:alice/app.bsky.graph.follow/1')
    expect(profile.viewer.muted).toBe(true)
    expect(profile.viewer.activitySubscription).toEqual({ post: true, reply: false })
    expect(transport.calls.map((call) => new URL(call.url).origin).sort()).toEqual(
      [APPVIEW, PDS_A].sort(),
    )
  })

  it('fails the profile when the private read fails', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, profileView()),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'viewer read failed' }),
    )
    await signIn(ALICE, PDS_A)

    await expect(fetchProfile('target.test', ALICE.did)).rejects.toThrow('viewer read failed')
  })

  it('rejects a private record for a different identity', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, profileView()),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, profileView({ did: 'did:plc:impostor' })),
    )
    await signIn(ALICE, PDS_A)

    await expect(fetchProfile('target.test', ALICE.did)).rejects.toThrow(
      'profile identity did not match',
    )
  })

  it('reads no private state for an anonymous viewer', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, profileView()),
    )

    const profile = await fetchProfile('target.test', null)

    expect(profile.viewer.following).toBeNull()
    expect(transport.calls.map((call) => new URL(call.url).origin)).toEqual([APPVIEW])
  })
})

describe('pinnedFeedUris', () => {
  it('collects pinned feeds from current and legacy preferences', () => {
    const preferences: AppBskyActorDefs.Preferences = [
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: [
          { id: '1', type: 'feed', value: FEED_URI, pinned: true },
          { id: '2', type: 'feed', value: 'at://feed/two', pinned: false },
          { id: '3', type: 'timeline', value: 'at://timeline', pinned: true },
        ],
      },
      {
        $type: 'app.bsky.actor.defs#savedFeedsPref',
        pinned: ['at://did:plc:test/app.bsky.feed.generator/legacy', FEED_URI],
        saved: [],
      },
    ]

    expect(pinnedFeedUris(preferences)).toEqual([
      FEED_URI,
      'at://did:plc:test/app.bsky.feed.generator/legacy',
    ])
  })
})

describe('opaque post records', () => {
  it('keeps a feed page usable when a post body is malformed', async () => {
    const malformed = {
      ...wirePost(1),
      record: {
        $type: 'app.bsky.feed.post',
        text: 42,
        createdAt: '2026-10-29T12:00:00.000Z',
        // a facet with no index and a reply missing its parent cid
        facets: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
        reply: { root: { uri: 'at://did:plc:test/app.bsky.feed.post/root' } },
      },
    }
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: malformed }, { post: wirePost(2) }] }),
    )

    const page = await fetchFeedPage({ kind: 'feed', uri: FEED_URI }, null)

    expect(page.posts.map((post) => post.text)).toEqual(['', 'post 2'])
    expect(page.posts[0]).toMatchObject({
      isReply: false,
      replyRoot: null,
      replyParent: null,
      facets: [],
    })
  })

  it('keeps a quoted post with malformed content from breaking the card', async () => {
    const quoted = {
      ...wirePost(1),
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          $type: 'app.bsky.embed.record#viewRecord',
          uri: 'at://did:plc:test/app.bsky.feed.post/quoted',
          cid: CID,
          author: VISIBLE_AUTHOR,
          value: { $type: 'app.bsky.feed.post', text: 7 },
          indexedAt: '2026-10-29T12:00:00.000Z',
        },
      },
    }
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: quoted }, { post: wirePost(2) }] }),
    )

    const page = await fetchFeedPage({ kind: 'feed', uri: FEED_URI }, null)

    expect(page.posts[0]?.embed).toMatchObject({ type: 'quote', post: { text: '' } })
    expect(page.posts[1]?.text).toBe('post 2')
  })

  it('keeps a thread usable when the focus record is malformed', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getPostThread`, () =>
      jsonResponse(200, {
        thread: threadViewPost(
          {
            ...wirePost(1),
            record: {
              $type: 'app.bsky.feed.post',
              text: null,
              reply: { root: { uri: 'at://root' }, parent: { uri: 'at://parent' } },
            },
          },
          [threadViewPost(wirePost(2))],
        ),
      }),
    )

    const thread = await fetchThread('at://did:plc:test/app.bsky.feed.post/1', null)

    expect(thread.entries[0]?.post.text).toBe('')
    expect(thread.entries[0]?.post.isReply).toBe(false)
    expect(thread.entries.map((entry) => entry.post.uri)).toEqual([
      'at://did:plc:test/app.bsky.feed.post/1',
      'at://did:plc:test/app.bsky.feed.post/2',
    ])
  })
})

describe('hydration batches', () => {
  it('starts hidden-author batches together and keeps the batch that answered', async () => {
    const dids = Array.from({ length: 26 }, (_, index) => `did:plc:author${index}`)
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
      jsonResponse(200, {
        posts: dids.map((did, index) => ({
          ...wirePost(index),
          author: { did, handle: `author${index}.test` },
        })),
      }),
    )
    let started = 0
    const bothStarted = Promise.withResolvers<void>()
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.actor.getProfiles`, async (request) => {
      started += 1
      if (started === 2) bothStarted.resolve()
      await bothStarted.promise

      const requested = new URL(request.url).searchParams.getAll('actors')
      if (requested.length === 1) {
        return jsonResponse(500, { error: 'InternalServerError', message: 'no profiles' })
      }
      return jsonResponse(200, {
        profiles: requested.map((did, index) => ({
          did,
          handle: `author${index}.test`,
          ...(index === 0 ? { viewer: { muted: true } } : {}),
        })),
      })
    })
    await signIn(ALICE, PDS_A)

    const page = await fetchFeedPage({ kind: 'search', query: 'cats' }, ALICE.did)

    // the muted author from the batch that answered is gone; the failed batch's
    // authors stay visible instead of the whole page failing
    expect(page.posts.map((post) => post.author.did)).not.toContain(dids[0])
    expect(page.posts).toHaveLength(25)
    expect(page.posts.map((post) => post.author.did)).toContain(dids[25])
  })
})
