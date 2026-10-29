import { Link } from 'wouter'
import { useActionStore } from '../lib/actionStore'
import { useAuthStore } from '../lib/auth'
import type { PostModel } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { DitherImage } from './DitherImage'
import { Embeds } from './Embeds'
import { FacetText } from './FacetText'
import { RelativeTime } from './RelativeTime'
import { Tag } from './ui'

export interface PostCardProps {
  post: PostModel
  index?: number
  focused?: boolean
  eyebrow?: string
}

export function PostCard({ post, index = 0, focused = false, eyebrow }: PostCardProps) {
  const handle = post.author.handle.length > 0 ? post.author.handle : 'unknown'
  const displayName = post.author.displayName.length > 0 ? post.author.displayName : handle
  const initial = (displayName.length > 0 ? displayName : '?').slice(0, 1).toUpperCase()
  const profileHref = `/profile/${encodeURIComponent(handle)}`
  const threadHref = `/thread?uri=${encodeURIComponent(post.uri)}`

  const authed = useAuthStore((state) => state.status === 'authenticated')
  const entry = useActionStore((state) => state.byUri[post.uri])
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)

  const reasonLabels: string[] = []
  if (post.reason !== null) {
    if (post.reason.type === 'repost') {
      const by = post.reason.by.handle.length > 0 ? post.reason.by.handle : 'unknown'
      reasonLabels.push(`reposted by @${by}`)
    } else {
      reasonLabels.push('pinned')
    }
  }
  if (post.isReply) reasonLabels.push('reply')

  const liked = entry?.likeUri != null
  const reposted = entry?.repostUri != null
  const pending = entry?.pending != null
  const error = entry?.error ?? null
  const likeCount = post.likeCount + (entry?.likeDelta ?? 0)
  const repostCount = post.repostCount + (entry?.repostDelta ?? 0)

  const classes = ['b-frame', 'b-post-card']
  if (focused) classes.push('b-post-card--focused')

  return (
    <article className={classes.join(' ')}>
      <header className="b-frame__head b-post-card__head">
        <span className="b-post-card__head-left">
          <span className="b-post-card__index">
            [{String(Math.max(0, index)).padStart(2, '0')}]
          </span>
          {eyebrow !== undefined && eyebrow.length > 0 ? <Tag tone="accent">{eyebrow}</Tag> : null}
          {reasonLabels.map((label) => (
            <Tag key={label} tone="default">
              {label}
            </Tag>
          ))}
        </span>
        <span className="b-post-card__head-right">
          <RelativeTime iso={post.indexedAt} />
        </span>
      </header>

      <div className="b-frame__body b-post-card__body">
        <div className="b-post-card__author">
          <Link href={profileHref} className="b-post-card__avatar">
            <DitherImage src={post.author.avatar} alt={`avatar of @${handle}`} fallback={initial} />
          </Link>
          <span className="b-post-card__identity">
            <Link href={profileHref} className="b-post-card__name">
              <span>{displayName}</span>
            </Link>
            <span className="b-post-card__handle">@{handle}</span>
          </span>
        </div>

        {post.text.length > 0 ? (
          <FacetText text={post.text} facets={post.facets} className="b-post-card__text" />
        ) : (
          <span className="b-post-card__empty-text">[no text]</span>
        )}

        {post.labels.length > 0 ? (
          <div className="b-post-card__labels">
            {post.labels.map((label) => (
              <Tag key={label} tone="warn" title={label}>
                {label}
              </Tag>
            ))}
          </div>
        ) : null}

        {post.embed !== null ? <Embeds embed={post.embed} /> : null}
      </div>

      <footer className="b-post-card__foot">
        <div className="b-post-card__actions">
          <Link href={threadHref} className="b-post-card__action">
            re {post.replyCount}
          </Link>
          <button
            type="button"
            className="b-post-card__action"
            data-kind="like"
            aria-pressed={liked}
            aria-label={`like, ${likeCount}`}
            title={error ?? undefined}
            disabled={pending}
            onClick={() => {
              if (!authed) {
                openDialog('login')
                return
              }
              void useActionStore.getState().toggleLike(post)
            }}
          >
            like {likeCount}
          </button>
          <button
            type="button"
            className="b-post-card__action"
            data-kind="repost"
            aria-pressed={reposted}
            aria-label={`repost, ${repostCount}`}
            title={error ?? undefined}
            disabled={pending}
            onClick={() => {
              if (!authed) {
                openDialog('login')
                return
              }
              void useActionStore.getState().toggleRepost(post)
            }}
          >
            rt {repostCount}
          </button>
          <button
            type="button"
            className="b-post-card__action"
            onClick={() => {
              if (!authed) {
                openDialog('login')
                return
              }
              openCompose({ mode: 'reply', post })
            }}
          >
            reply
          </button>
          <button
            type="button"
            className="b-post-card__action"
            onClick={() => {
              if (!authed) {
                openDialog('login')
                return
              }
              openCompose({ mode: 'quote', post })
            }}
          >
            quote
          </button>
        </div>
      </footer>
    </article>
  )
}
