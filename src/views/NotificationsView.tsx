import { type MouseEvent as ReactMouseEvent, useEffect, useRef } from 'react'
import { Link, useLocation } from 'wouter'
import { Avatar } from '../components/Avatar'
import { Deck } from '../components/Deck'
import { RelativeTime } from '../components/RelativeTime'
import { EmptyState, ErrorNotice, FrameBody, FrameHead, Progress } from '../components/ui'
import { notificationsQueryKey, useNotifications } from '../hooks/useNotifications'
import { useRetainedError } from '../hooks/useRetainedError'
import { useAuthStore } from '../lib/auth'
import { focusDeckAfterSwap } from '../lib/deckFocus'
import { errorInfo } from '../lib/errors'
import { truncateGraphemes } from '../lib/graphemes'
import {
  type NotificationModel,
  notificationReasonGroup,
  notificationReasonLabel,
  notificationSubjectHref,
  postThreadHref,
} from '../lib/notifications'
import { uiOwnsKeyboard } from '../lib/ui'

const PREVIEW_LIMIT = 220

function displayName(author: NotificationModel['author'], fallbackHandle: string): string {
  return author.displayName.length > 0 ? author.displayName : `@${fallbackHandle}`
}

/**
 * A preview keeps whole grapheme clusters and marks truncation only when the
 * text really lost a tail, so a split emoji never reaches the screen.
 */
function previewText(text: string): string {
  const clipped = truncateGraphemes(text, PREVIEW_LIMIT)
  return clipped === text ? text : `${clipped.trimEnd()}…`
}

/** The subject post's visible weight, printed beside its excerpt. */
function subjectStats(post: NonNullable<NotificationModel['subjectPost']>): string {
  const parts: string[] = []
  if (post.replyCount > 0)
    parts.push(`${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`)
  if (post.likeCount > 0) parts.push(`${post.likeCount} ${post.likeCount === 1 ? 'like' : 'likes'}`)
  if (post.repostCount > 0) {
    parts.push(`${post.repostCount} ${post.repostCount === 1 ? 'repost' : 'reposts'}`)
  }
  return parts.join(' · ')
}

/** Profile card target, shared by the author link and the deck's enter key. */
function profileHref(notification: NotificationModel): string {
  const handle = notification.author.handle.length > 0 ? notification.author.handle : 'unknown'
  return `/profile/${encodeURIComponent(handle)}`
}

/**
 * Where a notification opens. A follow is a profile visit, so an empty handle
 * resolves to the shared `unknown` fallback instead of an empty profile path;
 * every other reason keeps the subject helper's post target and only falls
 * back to the author's profile when the record names no post.
 */
function openHref(notification: NotificationModel): string {
  if (notificationReasonGroup(notification.reason) === 'follow') return profileHref(notification)
  return notificationSubjectHref(notification) ?? profileHref(notification)
}

/** Native controls own their own click; the row must not activate behind them. */
const NESTED_CONTROL =
  'a, button, input, textarea, select, summary, label, [role="button"], [role="link"], [contenteditable="true"]'

function NotificationCard({ notification }: { notification: NotificationModel }) {
  const author = notification.author
  const handle = author.handle.length > 0 ? author.handle : 'unknown'
  const href = openHref(notification)
  const [, navigate] = useLocation()
  // the context block shows the subject post, so it opens that post; the
  // footer keeps the notification's own target
  const contextHref =
    notification.subjectPost === null ? null : postThreadHref(notification.subjectPost.uri)
  // a follow is a profile visit and a record with no post target falls back to
  // the author's profile, so the destination decides the footer label
  const opensProfile = href.startsWith('/profile/')
  const stats = notification.subjectPost === null ? '' : subjectStats(notification.subjectPost)
  // the raw handle, never the `displayName` helper that prefixes its fallback
  const avatarName = author.displayName.length > 0 ? author.displayName : handle

  // the deck owns keyboard activation; a pointer click on noninteractive body
  // text opens the same destination, while a nested link or control keeps its
  // own click so nothing navigates twice
  const handleClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.defaultPrevented) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('.b-notif__body') === null) return
    if (target.closest(NESTED_CONTROL) !== null) return
    navigate(href)
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the deck owns keyboard activation for rows
    <article
      className="b-frame b-notif"
      data-unread={notification.isRead ? 'false' : 'true'}
      data-clickable="true"
      onClick={handleClick}
    >
      <FrameHead
        className="b-notif__head"
        label={notificationReasonLabel(notification.reason)}
        meta={
          <span className="b-notif__head-right">
            {notification.isRead ? null : (
              <span className="b-notif__unread">
                <span className="visually-hidden">unread</span>
              </span>
            )}
            <RelativeTime iso={notification.indexedAt} className="b-notif__time" />
          </span>
        }
      />
      <FrameBody className="b-notif__body">
        <div className="b-notif__author">
          <div className="b-notif__avatar">
            <Avatar
              src={author.avatar}
              alt={`avatar of @${handle}`}
              name={avatarName}
              emptyGlyph="·"
              preserveCase
            />
          </div>
          <span className="b-notif__identity">
            <Link href={profileHref(notification)} className="b-notif__name" title={author.did}>
              {displayName(author, handle)}
            </Link>
            <span className="b-notif__handle">@{handle}</span>
          </span>
        </div>
        <div className="b-notif__quote">
          {notification.subjectText !== null ? (
            <Link href={href} className="b-notif__subject" dir="auto">
              {previewText(notification.subjectText)}
            </Link>
          ) : null}
          {notification.subjectPost !== null && contextHref !== null ? (
            <Link href={contextHref} className="b-notif__context">
              <span className="b-notif__context-head">
                <span className="b-notif__context-author">
                  @{notification.subjectPost.author.handle}
                </span>
                <RelativeTime
                  iso={notification.subjectPost.indexedAt}
                  className="b-notif__context-time"
                />
              </span>
              {notification.subjectPost.text.trim().length > 0 ? (
                <span className="b-notif__context-text" dir="auto">
                  {previewText(notification.subjectPost.text)}
                </span>
              ) : (
                <span className="b-notif__context-text b-notif__context-text--empty">
                  [no text]
                </span>
              )}
              {stats.length > 0 ? <span className="b-notif__context-stats">{stats}</span> : null}
            </Link>
          ) : null}
        </div>
      </FrameBody>
      <footer className="b-notif__foot">
        <Link href={href} className="b-notif__open">
          {opensProfile ? 'open profile' : 'open thread'} <span aria-hidden="true">→</span>
        </Link>
      </footer>
    </article>
  )
}

export default function NotificationsView() {
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const [, navigate] = useLocation()
  const notifications = useNotifications()
  const rows = notifications.notifications
  const failure = useRetainedError(
    JSON.stringify(notificationsQueryKey(viewerDid)),
    notifications.hasData,
    notifications.error,
    notifications.isFetching,
  )
  const info = failure.error !== null ? errorInfo(failure.error) : null
  const viewRef = useRef<HTMLElement>(null)
  const focusDisposerRef = useRef<(() => void) | null>(null)
  const showingFailure = info !== null
  const failureShownRef = useRef(showingFailure)

  useEffect(() => () => focusDisposerRef.current?.(), [])

  useEffect(() => {
    const wasShowing = failureShownRef.current
    failureShownRef.current = showingFailure
    if (!wasShowing || showingFailure || !notifications.hasData) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    focusDisposerRef.current?.()
    if (rows.length > 0) {
      focusDisposerRef.current = focusDeckAfterSwap(viewRef.current)
    } else if (!uiOwnsKeyboard() && document.querySelector('dialog[open]') === null) {
      viewRef.current?.focus({ preventScroll: true })
    }
  }, [showingFailure, notifications.hasData, rows.length])

  return (
    <section ref={viewRef} tabIndex={-1} className="b-view b-notif-view">
      <h1 className="visually-hidden">notifications</h1>
      <div className="b-view__body b-notif__stage">
        {info !== null && rows.length === 0 ? (
          <div className="b-notif__state">
            <ErrorNotice
              title={info.title}
              message={info.detail}
              retrying={failure.retrying}
              onRetry={() => failure.retry(notifications.reload)}
            />
          </div>
        ) : notifications.isPending ? (
          <div className="b-notif__state">
            <Progress label="loading notifications" indeterminate />
          </div>
        ) : rows.length === 0 ? (
          <div className="b-notif__state">
            <EmptyState
              title="nothing yet"
              hint="when people follow, like or reply to you it shows up here."
            />
          </div>
        ) : (
          <>
            {info !== null ? (
              <div className="b-notif__warning">
                <ErrorNotice
                  title={info.title}
                  message={info.detail}
                  retrying={failure.retrying}
                  onRetry={() => failure.retry(notifications.reload)}
                />
              </div>
            ) : null}
            <Deck
              items={rows}
              layout="list"
              getKey={(notification) => notification.id}
              renderItem={(notification) => <NotificationCard notification={notification} />}
              onActivate={(notification) => {
                navigate(openHref(notification))
              }}
              label="notifications"
              stateKey={viewerDid === null ? 'notifications' : `notifications:${viewerDid}`}
            />
          </>
        )}
      </div>
    </section>
  )
}
