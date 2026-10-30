// biome-ignore-all lint/a11y/noNoninteractiveTabindex: rows are a focusable keyboard list
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { DitherImage } from '../components/DitherImage'
import { RelativeTime } from '../components/RelativeTime'
import { Button, EmptyState, ErrorNotice, Progress } from '../components/ui'
import { isEditableTarget } from '../hooks/useHotkeys'
import { useNotifications } from '../hooks/useNotifications'
import { useAuthStore } from '../lib/auth'
import { errorInfo } from '../lib/errors'
import {
  type NotificationModel,
  notificationReasonGroup,
  notificationReasonLabel,
  notificationSubjectHref,
} from '../lib/notifications'
import { useUiStore } from '../lib/ui'

const PREVIEW_LIMIT = 220

function displayName(author: NotificationModel['author']): string {
  return author.displayName.length > 0 ? author.displayName : `@${author.handle}`
}

function previewText(text: string): string {
  if (text.length <= PREVIEW_LIMIT) return text
  return `${text.slice(0, PREVIEW_LIMIT).trimEnd()}…`
}

interface NotificationRowProps {
  notification: NotificationModel
  focused: boolean
  onFocusRow: (id: string) => void
  onOpen: (href: string) => void
}

function focusRow(row: HTMLElement | undefined): void {
  if (row === undefined) return
  row.focus()
  if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
}

function NotificationRow({ notification, focused, onFocusRow, onOpen }: NotificationRowProps) {
  const author = notification.author
  const handle = author.handle.length > 0 ? author.handle : 'unknown'
  const profileHref = `/profile/${encodeURIComponent(handle)}`
  const subjectHref = notificationSubjectHref(notification)
  const follow = notificationReasonGroup(notification.reason) === 'follow'
  const initial = author.displayName.charAt(0) || handle.charAt(0) || '·'
  const destination = subjectHref ?? profileHref

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLLIElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target
    if (target instanceof HTMLElement && target.closest('a, button') !== null) return
    event.preventDefault()
    onOpen(destination)
  }

  return (
    <li
      className="b-notif"
      data-unread={notification.isRead ? 'false' : 'true'}
      data-focused={focused ? 'true' : 'false'}
      tabIndex={0}
      onFocus={() => {
        onFocusRow(notification.id)
      }}
      onClick={(event) => {
        const target = event.target
        if (target instanceof HTMLElement && target.closest('a, button') !== null) return
        event.currentTarget.focus()
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="b-notif__avatar">
        <DitherImage src={author.avatar} alt={`avatar of @${handle}`} fallback={initial} />
      </div>
      <div className="b-notif__body">
        <div className="b-notif__head">
          {notification.isRead ? null : (
            <span className="b-notif__unread">
              <span className="visually-hidden">unread</span>
            </span>
          )}
          <Link href={profileHref} className="b-notif__name" title={author.did}>
            {displayName(author)}
          </Link>
          <span className="b-notif__handle">@{handle}</span>
          <RelativeTime iso={notification.indexedAt} className="b-notif__time" />
        </div>
        <p className="b-notif__reason">{notificationReasonLabel(notification.reason)}</p>
        {notification.subjectText !== null && subjectHref !== null ? (
          <Link href={subjectHref} className="b-notif__subject">
            {previewText(notification.subjectText)}
          </Link>
        ) : null}
        {subjectHref !== null ? (
          <div className="b-notif__foot">
            <Link href={subjectHref} className="b-notif__open">
              {follow ? 'open profile' : 'open thread'} <span aria-hidden="true">→</span>
            </Link>
          </div>
        ) : null}
      </div>
    </li>
  )
}

export default function NotificationsView() {
  const status = useAuthStore((state) => state.status)
  const openDialog = useUiStore((state) => state.openDialog)
  const [, navigate] = useLocation()
  const notifications = useNotifications()
  const authenticated = status === 'authenticated'
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const unread = notifications.notifications.filter((item) => !item.isRead).length
  const info = notifications.error !== null ? errorInfo(notifications.error) : null

  useEffect(() => {
    if (!authenticated) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (isEditableTarget(event.target)) return
      if (document.querySelector('dialog[open]') !== null) return
      const scroller = scrollRef.current
      if (scroller === null) return

      const rows = Array.from(scroller.querySelectorAll<HTMLElement>('.b-notif'))
      if (rows.length === 0) return
      const active = document.activeElement
      const activeRow =
        active instanceof HTMLElement ? active.closest<HTMLElement>('.b-notif') : null
      const index = activeRow !== null ? rows.indexOf(activeRow) : -1
      if (index === -1) {
        if (event.key !== 'ArrowDown') return
        event.preventDefault()
        focusRow(rows[0])
        return
      }
      const next = index + (event.key === 'ArrowDown' ? 1 : -1)
      if (next < 0 || next >= rows.length) return
      event.preventDefault()
      focusRow(rows[next])
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [authenticated])

  return (
    <section className="b-view b-notif-view">
      <h1 className="visually-hidden">notifications</h1>
      <div className="b-notif__bar">
        <span className="mono-label">notifications</span>
        {authenticated ? (
          <span className="b-notif__count">
            {notifications.isPending
              ? 'loading'
              : unread > 0
                ? `${unread} unread / ${notifications.notifications.length} total`
                : `${notifications.notifications.length} total`}
          </span>
        ) : null}
        {authenticated ? (
          <Button
            variant="ghost"
            className="b-notif__refresh"
            onClick={notifications.reload}
            disabled={notifications.isFetching}
          >
            {notifications.isFetching ? 'refreshing' : 'refresh'}
          </Button>
        ) : null}
      </div>

      <div className="b-notif__scroll" ref={scrollRef}>
        {status === 'restoring' ? (
          <div className="b-notif__state">
            <Progress label="restoring session" indeterminate />
          </div>
        ) : !authenticated ? (
          <div className="b-notif__state">
            <EmptyState
              title="sign in for notifications"
              hint="follows, likes, reposts, replies and mentions land here once you are signed in."
              action={
                <Button
                  variant="solid"
                  onClick={() => {
                    openDialog('login')
                  }}
                >
                  sign in
                </Button>
              }
            />
          </div>
        ) : info !== null && notifications.notifications.length === 0 ? (
          <div className="b-notif__state">
            <ErrorNotice title={info.title} message={info.detail} onRetry={notifications.reload} />
          </div>
        ) : notifications.isPending ? (
          <div className="b-notif__state">
            <Progress label="loading notifications" indeterminate />
          </div>
        ) : notifications.notifications.length === 0 ? (
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
                  onRetry={notifications.reload}
                />
              </div>
            ) : null}
            <ul className="b-notif__list" aria-label="notifications">
              {notifications.notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  focused={notification.id === focusedId}
                  onFocusRow={setFocusedId}
                  onOpen={navigate}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
