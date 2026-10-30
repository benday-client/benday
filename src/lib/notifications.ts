import type { AppBskyNotificationListNotifications } from '@atproto/api'
import { getAuthAgent } from './auth'
import type { AuthorModel } from './types'

export const NOTIFICATION_LIMIT = 50

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
  isRead: boolean
  indexedAt: string
}

function mapAuthor(
  author: AppBskyNotificationListNotifications.Notification['author'],
): AuthorModel {
  return {
    did: author.did,
    handle: author.handle,
    displayName: author.displayName ?? '',
    avatar: author.avatar ?? null,
  }
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
  if (typeof subject !== 'object' || subject === null) return null
  const uri = (subject as Record<string, unknown>)['uri']
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

export function notificationSubjectHref(notification: NotificationModel): string | null {
  if (notificationReasonGroup(notification.reason) === 'follow') {
    return `/profile/${encodeURIComponent(notification.author.handle)}`
  }
  const uri = notification.subject ?? notification.uri
  if (!POST_URI.test(uri)) return null
  return `/thread?uri=${encodeURIComponent(uri)}`
}

export async function fetchNotifications(): Promise<NotificationModel[]> {
  const agent = getAuthAgent()
  if (agent === null) throw new Error('notifications need a signed-in account')

  const response = await agent.listNotifications({ limit: NOTIFICATION_LIMIT })
  return response.data.notifications.map(mapNotification)
}

/**
 * Best effort: a failed seen update must never disturb the notification list.
 * Returns true only when the server accepted the update.
 */
export async function markNotificationsSeen(seenAt?: string): Promise<boolean> {
  const agent = getAuthAgent()
  if (agent === null) return false
  try {
    await agent.updateSeenNotifications(seenAt)
    return true
  } catch {
    return false
  }
}
