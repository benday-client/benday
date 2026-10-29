import { Link } from 'wouter'
import { postWebUrl } from '../lib/postUrl'
import type { PostModel } from '../lib/types'
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

const METRICS = [
  { key: 'replies', short: 're' },
  { key: 'reposts', short: 'rt' },
  { key: 'likes', short: 'like' },
  { key: 'quotes', short: 'qt' },
] as const

export function PostCard({ post, index = 0, focused = false, eyebrow }: PostCardProps) {
  const handle = post.author.handle.length > 0 ? post.author.handle : 'unknown'
  const displayName = post.author.displayName.length > 0 ? post.author.displayName : handle
  const initial = (displayName.length > 0 ? displayName : '?').slice(0, 1).toUpperCase()
  const profileHref = `/profile/${encodeURIComponent(handle)}`
  const threadHref = `/thread?uri=${encodeURIComponent(post.uri)}`

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

  const counts: Record<(typeof METRICS)[number]['key'], number> = {
    replies: post.replyCount,
    reposts: post.repostCount,
    likes: post.likeCount,
    quotes: post.quoteCount,
  }

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
        <div className="b-post-card__metrics">
          {METRICS.map((metric) => (
            <span key={metric.key} className="b-post-card__metric">
              {metric.short} {counts[metric.key]}
            </span>
          ))}
        </div>
        <div className="b-post-card__actions">
          <Link href={threadHref} className="b-post-card__action">
            <span>thread</span>
          </Link>
          <a
            className="b-post-card__action"
            href={postWebUrl(post)}
            target="_blank"
            rel="noreferrer noopener"
          >
            bsky ↗
          </a>
        </div>
      </footer>
    </article>
  )
}
