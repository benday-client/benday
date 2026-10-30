import { Link } from 'wouter'
import { DitherImage } from '../components/DitherImage'
import { RelativeTime } from '../components/RelativeTime'
import { Button, EmptyState, ErrorNotice, Progress } from '../components/ui'
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

function NotificationRow({ notification }: { notification: NotificationModel }) {
  const author = notification.author
  const handle = author.handle.length > 0 ? author.handle : 'unknown'
  const profileHref = `/profile/${encodeURIComponent(handle)}`
  const subjectHref = notificationSubjectHref(notification)
  const follow = notificationReasonGroup(notification.reason) === 'follow'
  const initial = author.displayName.charAt(0) || handle.charAt(0) || '·'

  return (
    <li className="b-notif" data-unread={notification.isRead ? 'false' : 'true'}>
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
  const notifications = useNotifications()
  const authenticated = status === 'authenticated'
  const unread = notifications.notifications.filter((item) => !item.isRead).length
  const info = notifications.error !== null ? errorInfo(notifications.error) : null

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

      <div className="b-notif__scroll">
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
                <NotificationRow key={notification.id} notification={notification} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
