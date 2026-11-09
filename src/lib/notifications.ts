import type { AppBskyNotificationListNotifications } from '@atproto/api'
import { requireViewerAgent } from './auth'
import { hidesAuthor, mapAuthor, mapPostView } from './model'
import { isRecord } from './records'
import type { AuthorModel, PostModel } from './types'

const NOTIFICATION_LIMIT = 50

export type NotificationReasonGroup =
  | 'follow'
  | 'like'
  | 'repost'
  | 'reply'
  | 'mention'
  | 'quote'
  | 'other'

export interface NotificationModel {
  id: string
  uri: string
  reason: string
  author: AuthorModel
  /** the at-uri the notification points at, or null when it has no subject */
  subject: string | null
  /** text preview of the subject post when the payload carries one */
  subjectText: string | null
  /** the post the notification points at, hydrated a page at a time */
  subjectPost: PostModel | null
  isRead: boolean
  indexedAt: string
}

export interface NotificationPage {
  notifications: NotificationModel[]
  /** newest indexedAt on the wire page, even when every row was filtered */
  newestIndexedAt: string | null
}

function readSubjectText(record: Record<string, unknown>): string | null {
  // post records carry their text here; other record types simply have none
  const text = record['text']
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readSubjectRef(record: Record<string, unknown>): string | null {
  // like and repost records point at their target through subject.uri
  const subject = record['subject']
  if (!isRecord(subject)) return null
  const uri = subject['uri']
  return typeof uri === 'string' && uri.length > 0 ? uri : null
}

export function mapNotification(
  notification: AppBskyNotificationListNotifications.Notification,
): NotificationModel {
  const author = mapAuthor(notification.author)
  const reason = notification.reason
  return {
    id: `${reason}:${notification.uri}:${author.did}:${notification.indexedAt}`,
    uri: notification.uri,
    reason,
    author,
    subject: notification.reasonSubject ?? readSubjectRef(notification.record),
    subjectText: readSubjectText(notification.record),
    subjectPost: null,
    isRead: notification.isRead,
    indexedAt: notification.indexedAt,
  }
}

export function notificationReasonGroup(reason: string): NotificationReasonGroup {
  switch (reason) {
    case 'follow':
      return 'follow'
    case 'like':
    case 'like-via-repost':
      return 'like'
    case 'repost':
    case 'repost-via-repost':
      return 'repost'
    case 'reply':
      return 'reply'
    case 'mention':
      return 'mention'
    case 'quote':
      return 'quote'
    default:
      return 'other'
  }
}

export function notificationReasonLabel(reason: string): string {
  switch (reason) {
    case 'follow':
      return 'followed you'
    case 'like':
      return 'liked your post'
    case 'like-via-repost':
      return 'liked your repost'
    case 'repost':
      return 'reposted your post'
    case 'repost-via-repost':
      return 'reposted your repost'
    case 'reply':
      return 'replied to your post'
    case 'mention':
      return 'mentioned you'
    case 'quote':
      return 'quoted your post'
    case 'starterpack-joined':
      return 'joined your starter pack'
    case 'subscribed-post':
      return 'subscribed to your post'
    case 'verified':
      return 'verified your account'
    case 'unverified':
      return 'unverified your account'
    case 'contact-match':
      return 'connected through contacts'
    default:
      return 'new activity'
  }
}

const POST_URI = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/]+$/

/** The thread route for a post uri, or null when the uri is not a post. */
export function postThreadHref(uri: string): string | null {
  if (!POST_URI.test(uri)) return null
  return `/thread?uri=${encodeURIComponent(uri)}`
}

export function notificationSubjectHref(notification: NotificationModel): string | null {
  const group = notificationReasonGroup(notification.reason)
  if (group === 'follow') {
    return `/profile/${encodeURIComponent(notification.author.handle)}`
  }
  // a reply, mention or quote notification's own uri is the new post the
  // reader wants to open; its subject is the parent post. engagement
  // notifications invert that: the subject is the reader's own post.
  const opensOwnRecord = group === 'reply' || group === 'mention' || group === 'quote'
  return postThreadHref(
    opensOwnRecord ? notification.uri : (notification.subject ?? notification.uri),
  )
}

const SUBJECT_CHUNK = 25

/**
 * One posts call per page gives every notification its subject post: the liked
 * or reposted post, or the parent a reply answers. Context is optional, so a
 * failed read leaves the notifications visible with no subject post.
 */
async function loadSubjectPosts(
  agent: ReturnType<typeof requireViewerAgent>,
  notifications: readonly NotificationModel[],
): Promise<Map<string, PostModel>> {
  // only post subjects have a post to hydrate; a starter pack or profile
  // record uri would spend the read on a record getPosts cannot answer
  const uris = [
    ...new Set(
      notifications
        .map((notification) => notification.subject)
        .filter((uri): uri is string => uri !== null && POST_URI.test(uri)),
    ),
  ]
  const posts = new Map<string, PostModel>()
  if (uris.length === 0) return posts
  const reader = agent.withProxy('bsky_appview', 'did:web:api.bsky.app')
  // the chunks are independent reads and start together; they merge in source
  // order, and a failed chunk is only missing context for its own rows
  const chunks: string[][] = []
  for (let index = 0; index < uris.length; index += SUBJECT_CHUNK) {
    chunks.push(uris.slice(index, index + SUBJECT_CHUNK))
  }
  const settled = await Promise.allSettled(
    chunks.map((chunk) => reader.app.bsky.feed.getPosts({ uris: chunk })),
  )
  for (const result of settled) {
    if (result.status === 'rejected') continue
    for (const view of result.value.data.posts) posts.set(view.uri, mapPostView(view))
  }
  return posts
}

export async function fetchNotifications(viewerDid: string): Promise<NotificationPage> {
  const agent = requireViewerAgent(viewerDid)
  const response = await agent.listNotifications({ limit: NOTIFICATION_LIMIT })
  // the card list hides muted and blocked authors, but the seen cursor must
  // advance past the newest wire row or a hidden newest notification is
  // re-delivered forever
  let newestIndexedAt: string | null = null
  for (const notification of response.data.notifications) {
    if (newestIndexedAt === null || notification.indexedAt > newestIndexedAt) {
      newestIndexedAt = notification.indexedAt
    }
  }
  const visible = response.data.notifications
    .map(mapNotification)
    .filter((notification) => !hidesAuthor(notification.author))
  const posts = await loadSubjectPosts(agent, visible)
  const notifications = visible.map((notification) => ({
    ...notification,
    subjectPost: notification.subject === null ? null : (posts.get(notification.subject) ?? null),
  }))
  return { notifications, newestIndexedAt }
}

/**
 * Best effort: a failed seen update must never disturb the notification list.
 * Returns true only when the server accepted the update.
 */
export async function markNotificationsSeen(viewerDid: string, seenAt: string): Promise<boolean> {
  try {
    // a mismatched account returns false before any request leaves the tab
    const agent = requireViewerAgent(viewerDid)
    await agent.updateSeenNotifications(seenAt)
    return true
  } catch {
    return false
  }
}
