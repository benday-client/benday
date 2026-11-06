import type { AppBskyNotificationListNotifications, AtpSessionData } from '@atproto/api'
import { beforeEach, describe, expect, it } from 'vitest'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import { useAuthStore } from './auth'
import {
  fetchNotifications,
  mapNotification,
  markNotificationsSeen,
  notificationReasonGroup,
  notificationReasonLabel,
  notificationSubjectHref,
} from './notifications'

const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'
const POST = 'at://did:plc:me/app.bsky.feed.post/mine'
/** the post an interaction notification points at, distinct from `POST` */
const NOTIFY_POST = 'at://did:plc:actor/app.bsky.feed.post/1'
const PDS_A = 'https://pds.a.test'
const PDS_B = 'https://pds.b.test'

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

function wireNotification(overrides: Record<string, unknown> = {}) {
  return {
    uri: NOTIFY_POST,
    cid: CID,
    author: { did: 'did:plc:actor', handle: 'actor.test' },
    reason: 'like',
    record: {
      $type: 'app.bsky.feed.like',
      subject: { uri: POST, cid: CID },
      createdAt: '2026-10-29T12:00:00.000Z',
    },
    isRead: false,
    indexedAt: '2026-10-29T12:00:00.000Z',
    ...overrides,
  } as AppBskyNotificationListNotifications.Notification
}

function mapped(reason: string) {
  return mapNotification(wireNotification({ reason }))
}

describe('notification mapping', () => {
  it.each([
    ['follow', 'follow', 'followed you', '/profile/actor.test'],
    ['like', 'like', 'liked your post', `/thread?uri=${encodeURIComponent(POST)}`],
    ['like-via-repost', 'like', 'liked your repost', `/thread?uri=${encodeURIComponent(POST)}`],
    ['repost', 'repost', 'reposted your post', `/thread?uri=${encodeURIComponent(POST)}`],
    [
      'repost-via-repost',
      'repost',
      'reposted your repost',
      `/thread?uri=${encodeURIComponent(POST)}`,
    ],
    ['reply', 'reply', 'replied to your post', `/thread?uri=${encodeURIComponent(NOTIFY_POST)}`],
    ['mention', 'mention', 'mentioned you', `/thread?uri=${encodeURIComponent(NOTIFY_POST)}`],
    ['quote', 'quote', 'quoted your post', `/thread?uri=${encodeURIComponent(NOTIFY_POST)}`],
    ['verified', 'other', 'verified your account', `/thread?uri=${encodeURIComponent(POST)}`],
    ['unverified', 'other', 'unverified your account', `/thread?uri=${encodeURIComponent(POST)}`],
    [
      'contact-match',
      'other',
      'connected through contacts',
      `/thread?uri=${encodeURIComponent(POST)}`,
    ],
    ['something-new', 'other', 'new activity', `/thread?uri=${encodeURIComponent(POST)}`],
  ])('maps %s to its group, label and destination', (reason, group, label, href) => {
    const notification = mapped(reason)

    expect(notificationReasonGroup(reason)).toBe(group)
    expect(notificationReasonLabel(reason)).toBe(label)
    // the subject is the parent post while the uri is the actor's own record,
    // so each reason has to pick the right side
    expect(notification.subject).toBe(POST)
    expect(notification.uri).toBe(NOTIFY_POST)
    expect(notificationSubjectHref(notification)).toBe(href)
  })

  it.each(['reply', 'mention', 'quote'])(
    'opens the %s post itself rather than the parent it answers',
    (reason) => {
      const notification = mapNotification(
        wireNotification({
          reason,
          uri: 'at://did:plc:actor/app.bsky.feed.post/reply',
          reasonSubject: 'at://did:plc:me/app.bsky.feed.post/parent',
          record: { $type: 'app.bsky.feed.post', text: 'a new post' },
        }),
      )

      expect(notificationSubjectHref(notification)).toBe(
        `/thread?uri=${encodeURIComponent('at://did:plc:actor/app.bsky.feed.post/reply')}`,
      )
    },
  )

  it.each(['like', 'repost', 'like-via-repost', 'repost-via-repost'])(
    'keeps the %s destination on the subject post',
    (reason) => {
      const notification = mapNotification(
        wireNotification({
          reason,
          uri: 'at://did:plc:actor/app.bsky.feed.like/1',
          reasonSubject: 'at://did:plc:me/app.bsky.feed.post/parent',
        }),
      )

      expect(notificationSubjectHref(notification)).toBe(
        `/thread?uri=${encodeURIComponent('at://did:plc:me/app.bsky.feed.post/parent')}`,
      )
    },
  )

  it('prefers the reason subject over the record subject', () => {
    const notification = mapNotification(
      wireNotification({
        reason: 'reply',
        reasonSubject: POST,
        record: { $type: 'app.bsky.feed.post', text: 'a reply' },
      }),
    )

    expect(notification.subject).toBe(POST)
    expect(notification.subjectText).toBe('a reply')
    // a reply opens its own post even though the parent is the subject
    expect(notificationSubjectHref(notification)).toBe(
      `/thread?uri=${encodeURIComponent(NOTIFY_POST)}`,
    )
  })

  it('falls back to the record subject when the reason has none', () => {
    const notification = mapNotification(
      wireNotification({ record: { $type: 'app.bsky.feed.like', subject: { uri: POST } } }),
    )

    expect(notification.subject).toBe(POST)
  })

  it('treats an empty snippet as no snippet', () => {
    const blank = mapNotification(wireNotification({ record: { text: '   ' } }))
    const none = mapNotification(wireNotification({ record: {} }))
    const trimmed = mapNotification(wireNotification({ record: { text: '  hello  ' } }))

    expect(blank.subjectText).toBeNull()
    expect(none.subjectText).toBeNull()
    expect(trimmed.subjectText).toBe('hello')
  })

  it('leaves a non-post subject without a destination', () => {
    const notification = mapNotification(
      wireNotification({
        uri: 'at://did:plc:actor/app.bsky.graph.follow/1',
        reason: 'starterpack-joined',
        record: { $type: 'app.bsky.graph.starterpack' },
      }),
    )

    expect(notificationSubjectHref(notification)).toBeNull()
  })
})

describe('notification seen state', () => {
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
    // subject hydration asks the pds for the notification's post; a case that
    // asserts a preview routes its own answer over this quiet one
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getPosts`, () =>
      jsonResponse(200, { posts: [] }),
    )

    await useAuthStore.getState().signOut()
    transport.calls.length = 0
  })

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

  it('issues no seen request for a previous account', async () => {
    await signIn(ALICE, PDS_A)
    await signIn(BRAVO, PDS_B)
    transport.calls.length = 0

    await expect(markNotificationsSeen(ALICE.did, '2026-10-29T12:00:00.000Z')).resolves.toBe(false)
    expect(transport.calls).toEqual([])
  })

  it('drops notifications from muted and blocked accounts', async () => {
    await signIn(ALICE, PDS_A)
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: [
          wireNotification({
            author: { did: 'did:plc:muted', handle: 'muted.test', viewer: { muted: true } },
          }),
          wireNotification({
            uri: 'at://did:plc:blocked/app.bsky.feed.post/2',
            author: { did: 'did:plc:blocked', handle: 'blocked.test', viewer: { blockedBy: true } },
          }),
          wireNotification({
            uri: 'at://did:plc:ok/app.bsky.feed.post/3',
            author: { did: 'did:plc:ok', handle: 'ok.test' },
          }),
        ],
      }),
    )

    const { notifications } = await fetchNotifications(ALICE.did)
    expect(notifications.map((notification) => notification.author.handle)).toEqual(['ok.test'])
  })

  it('hydrates the subject post of a notification', async () => {
    await signIn(ALICE, PDS_A)
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: [
          wireNotification({
            reason: 'like',
            reasonSubject: NOTIFY_POST,
            record: {
              $type: 'app.bsky.feed.like',
              subject: { uri: NOTIFY_POST, cid: CID },
              createdAt: '2026-10-29T12:00:00.000Z',
            },
          }),
        ],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getPosts`, () =>
      jsonResponse(200, {
        posts: [
          {
            uri: NOTIFY_POST,
            cid: CID,
            author: { did: 'did:plc:me', handle: 'me.test', displayName: 'me' },
            record: {
              $type: 'app.bsky.feed.post',
              text: 'the liked post',
              createdAt: '2026-10-29T12:00:00.000Z',
            },
            indexedAt: '2026-10-29T12:00:00.000Z',
            likeCount: 7,
            replyCount: 2,
            repostCount: 1,
          },
        ],
      }),
    )

    const { notifications } = await fetchNotifications(ALICE.did)

    expect(notifications[0]?.subjectPost?.uri).toBe(NOTIFY_POST)
    expect(notifications[0]?.subjectPost?.text).toBe('the liked post')
    expect(notifications[0]?.subjectPost?.likeCount).toBe(7)
  })

  it('asks only for post subjects and skips a starter pack record', async () => {
    await signIn(ALICE, PDS_A)
    const STARTER = 'at://did:plc:actor/app.bsky.graph.starterpack/1'
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: [
          wireNotification({
            uri: 'at://did:plc:actor/app.bsky.feed.post/starter',
            reason: 'starterpack-joined',
            reasonSubject: STARTER,
            record: { $type: 'app.bsky.graph.starterpack' },
          }),
          wireNotification({
            reason: 'like',
            reasonSubject: NOTIFY_POST,
            record: {
              $type: 'app.bsky.feed.like',
              subject: { uri: NOTIFY_POST, cid: CID },
              createdAt: '2026-10-29T12:00:00.000Z',
            },
          }),
        ],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getPosts`, (request) => {
      const requested = new URL(request.url).searchParams.getAll('uris')
      return jsonResponse(200, {
        posts: requested.map((uri) => ({
          uri,
          cid: CID,
          author: { did: 'did:plc:me', handle: 'me.test' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'the liked post',
            createdAt: '2026-10-29T12:00:00.000Z',
          },
          indexedAt: '2026-10-29T12:00:00.000Z',
        })),
      })
    })

    const page = await fetchNotifications(ALICE.did)

    const requests = transport.calls.filter(
      (call) => new URL(call.url).pathname === '/xrpc/app.bsky.feed.getPosts',
    )
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]?.url ?? '').searchParams.getAll('uris')).toEqual([NOTIFY_POST])
    expect(page.notifications.find((row) => row.reason === 'like')?.subjectPost?.text).toBe(
      'the liked post',
    )
    expect(
      page.notifications.find((row) => row.reason === 'starterpack-joined')?.subjectPost,
    ).toBeNull()
  })

  it('starts subject-post chunks together and keeps the chunk that answered', async () => {
    await signIn(ALICE, PDS_A)
    const subjects = Array.from(
      { length: 26 },
      (_, index) => `at://did:plc:me/app.bsky.feed.post/p${index}`,
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: subjects.map((subject, index) =>
          wireNotification({
            uri: `at://did:plc:actor/app.bsky.feed.post/n${index}`,
            reason: 'like',
            reasonSubject: subject,
            record: {
              $type: 'app.bsky.feed.like',
              subject: { uri: subject, cid: CID },
              createdAt: '2026-10-29T12:00:00.000Z',
            },
          }),
        ),
      }),
    )
    // a serial reader would deadlock on this barrier
    let started = 0
    const bothStarted = Promise.withResolvers<void>()
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getPosts`, async (request) => {
      started += 1
      if (started === 2) bothStarted.resolve()
      await bothStarted.promise

      const requested = new URL(request.url).searchParams.getAll('uris')
      if (requested.length === 1) {
        return jsonResponse(500, { error: 'InternalServerError', message: 'no subjects' })
      }
      return jsonResponse(200, {
        posts: requested.map((uri) => ({
          uri,
          cid: CID,
          author: { did: 'did:plc:me', handle: 'me.test' },
          record: {
            $type: 'app.bsky.feed.post',
            text: 'a subject',
            createdAt: '2026-10-29T12:00:00.000Z',
          },
          indexedAt: '2026-10-29T12:00:00.000Z',
        })),
      })
    })

    const page = await fetchNotifications(ALICE.did)

    expect(page.notifications.filter((row) => row.subjectPost !== null)).toHaveLength(25)
    // the failed chunk keeps only its own row without a subject post
    expect(page.notifications.find((row) => row.subject === subjects[25])?.subjectPost).toBeNull()
  })

  it('keeps the inbox when the subject posts cannot be read', async () => {
    await signIn(ALICE, PDS_A)
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: [
          wireNotification({
            reason: 'like',
            reasonSubject: NOTIFY_POST,
            record: {
              $type: 'app.bsky.feed.like',
              subject: { uri: NOTIFY_POST, cid: CID },
              createdAt: '2026-10-29T12:00:00.000Z',
            },
          }),
        ],
      }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.feed.getPosts`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'nope' }),
    )

    const { notifications } = await fetchNotifications(ALICE.did)

    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.subjectPost).toBeNull()
  })

  it('advances the seen cursor to the newest wire row even when it is hidden', async () => {
    await signIn(ALICE, PDS_A)
    const NEWEST = '2026-10-30T12:00:00.000Z'
    const OLDER = '2026-10-29T12:00:00.000Z'
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: [
          wireNotification({
            author: { did: 'did:plc:muted', handle: 'muted.test', viewer: { muted: true } },
            indexedAt: NEWEST,
          }),
          wireNotification({
            uri: 'at://did:plc:ok/app.bsky.feed.post/3',
            author: { did: 'did:plc:ok', handle: 'ok.test' },
            indexedAt: OLDER,
          }),
        ],
      }),
    )

    const page = await fetchNotifications(ALICE.did)

    expect(page.notifications.map((notification) => notification.indexedAt)).toEqual([OLDER])
    expect(page.newestIndexedAt).toBe(NEWEST)
  })

  it('keeps a real cursor when every wire row is hidden', async () => {
    await signIn(ALICE, PDS_A)
    const NEWEST = '2026-10-30T12:00:00.000Z'
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, {
        notifications: [
          wireNotification({
            author: { did: 'did:plc:muted', handle: 'muted.test', viewer: { muted: true } },
            indexedAt: NEWEST,
          }),
        ],
      }),
    )

    const page = await fetchNotifications(ALICE.did)

    expect(page.notifications).toEqual([])
    expect(page.newestIndexedAt).toBe(NEWEST)
  })

  it('reports no cursor for a genuinely empty wire page', async () => {
    await signIn(ALICE, PDS_A)
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, { notifications: [] }),
    )

    await expect(fetchNotifications(ALICE.did)).resolves.toEqual({
      notifications: [],
      newestIndexedAt: null,
    })
  })

  it('keeps the notification list intact when a seen update fails', async () => {
    await signIn(ALICE, PDS_A)
    transport.route('POST', `${PDS_A}/xrpc/app.bsky.notification.updateSeen`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'nope' }),
    )
    transport.route('GET', `${PDS_A}/xrpc/app.bsky.notification.listNotifications`, () =>
      jsonResponse(200, { notifications: [wireNotification({ isRead: false })] }),
    )

    await expect(markNotificationsSeen(ALICE.did, '2026-10-29T12:00:00.000Z')).resolves.toBe(false)

    const { notifications } = await fetchNotifications(ALICE.did)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.reason).toBe('like')
    expect(notifications[0]?.subject).toBe(POST)
    // the server snapshot stays the arrival state; a failed seen write is not
    // reflected back into local rows
    expect(notifications[0]?.isRead).toBe(false)
  })
})
