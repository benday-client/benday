import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { useTopComments } from '../hooks/useTopComments'
import { displayedCount, useActionStore } from '../lib/actionStore'
import { deletePost, type FeedFeedbackEvent } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { errorInfo } from '../lib/errors'
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
  replies?: ReactNode
  onFeedback?: (event: FeedFeedbackEvent) => void
}

function isOwnPostUri(uri: string, did: string): boolean {
  const prefix = `at://${did}/app.bsky.feed.post/`
  if (!uri.startsWith(prefix)) return false
  const rkey = uri.slice(prefix.length)
  return rkey.length > 0 && !rkey.includes('/')
}

export function PostCard({
  post,
  index,
  focused = false,
  eyebrow,
  replies,
  onFeedback,
}: PostCardProps) {
  const handle = post.author.handle.length > 0 ? post.author.handle : 'unknown'
  const displayName = post.author.displayName.length > 0 ? post.author.displayName : handle
  const initial = (displayName.length > 0 ? displayName : '?').slice(0, 1).toUpperCase()
  const profileHref = `/profile/${encodeURIComponent(handle)}`
  const threadHref = `/thread?uri=${encodeURIComponent(post.uri)}`

  const authed = useAuthStore((state) => state.status === 'authenticated')
  const accountDid = useAuthStore((state) => state.account?.did ?? null)
  const queryClient = useQueryClient()
  const cardRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const own =
    authed &&
    accountDid !== null &&
    accountDid === post.author.did &&
    isOwnPostUri(post.uri, accountDid)
  const topComments = useTopComments(
    post.uri,
    replies === undefined && inView && post.replyCount > 0,
  )
  const entry = useActionStore((state) => state.byUri[post.uri])
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)

  useEffect(() => {
    setConfirmingDelete(false)
    setDeleteError(null)
  }, [post.uri, own])

  useEffect(() => {
    const node = cardRef.current
    if (node === null) return

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setInView(true)
        observer.disconnect()
      },
      { root: node.closest('.b-deck'), rootMargin: '200px 0px' },
    )

    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!focused) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLElement) {
        if (event.target.isContentEditable) return
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      }

      const ui = useUiStore.getState()
      if (ui.dialog !== null || ui.compose !== null || ui.themeMenuOpen) return
      if (document.querySelector('dialog[open]') !== null) return

      const authenticated = useAuthStore.getState().status === 'authenticated'
      const interact = (action: () => void) => {
        if (!authenticated) {
          ui.openDialog('login')
          return
        }
        action()
      }

      switch (event.key) {
        case 'f':
          event.preventDefault()
          interact(() => {
            void useActionStore.getState().toggleLike(post)
          })
          break
        case 'b':
          event.preventDefault()
          interact(() => {
            void useActionStore.getState().toggleRepost(post)
          })
          break
        case 'r':
          event.preventDefault()
          interact(() => {
            ui.openCompose({ mode: 'reply', post })
          })
          break
        case 'q':
          event.preventDefault()
          interact(() => {
            ui.openCompose({ mode: 'quote', post })
          })
          break
        case '+':
          if (onFeedback === undefined) break
          event.preventDefault()
          interact(() => {
            onFeedback('more')
          })
          break
        case '-':
          if (onFeedback === undefined) break
          event.preventDefault()
          interact(() => {
            onFeedback('less')
          })
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [focused, post, onFeedback])

  const confirmDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)

    try {
      await deletePost(post.uri)
      await queryClient.invalidateQueries()
      setConfirmingDelete(false)
    } catch (error) {
      setDeleteError(errorInfo(error).detail)
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    if (!focused || !own) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLElement) {
        if (event.target.isContentEditable) return
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      }

      const ui = useUiStore.getState()
      if (ui.dialog !== null || ui.compose !== null || ui.themeMenuOpen) return
      if (document.querySelector('dialog[open]') !== null) return
      if (event.key !== 'd') return

      event.preventDefault()
      if (confirmingDelete) {
        void confirmDelete()
      } else {
        setConfirmingDelete(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [focused, own, confirmingDelete, deleting, post])

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
  const likeCount = displayedCount(
    post.likeCount,
    entry?.likeBaseCount ?? null,
    entry?.likeDelta ?? 0,
  )
  const repostCount = displayedCount(
    post.repostCount,
    entry?.repostBaseCount ?? null,
    entry?.repostDelta ?? 0,
  )

  const classes = ['b-frame', 'b-post-card']
  if (focused) classes.push('b-post-card--focused')

  return (
    <article ref={cardRef} className={classes.join(' ')}>
      <header className="b-frame__head b-post-card__head">
        <span className="b-post-card__head-left">
          {index !== undefined ? (
            <span className="b-post-card__index">
              [{String(Math.max(0, index)).padStart(2, '0')}]
            </span>
          ) : null}
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

        {post.replyContext !== null ? (
          <div className="b-post-card__reply-context">
            <div className="b-post-card__reply-context-head">
              <span>replying to</span>
              <Link
                href={`/thread?uri=${encodeURIComponent(post.replyContext.uri)}`}
                className="b-post-card__reply-context-author"
              >
                @{post.replyContext.author.handle}
              </Link>
            </div>
            {post.replyContext.text.length > 0 ? (
              <FacetText
                text={post.replyContext.text}
                facets={post.replyContext.facets}
                className="b-post-card__reply-context-text"
              />
            ) : (
              <span className="b-post-card__reply-context-text">[no text]</span>
            )}
          </div>
        ) : null}

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

        {replies}

        {replies === undefined && inView && post.replyCount > 0 ? (
          <section className="b-post-card__comments" aria-label="top comments">
            <p className="b-post-card__comments-label">top comments</p>
            {topComments.isPending ? (
              <p className="b-post-card__comments-note">loading comments</p>
            ) : topComments.comments.length === 0 ? (
              <p className="b-post-card__comments-note">no visible comments</p>
            ) : (
              <ul className="b-post-card__comment-list">
                {topComments.comments.map((comment) => (
                  <li key={comment.uri} className="b-post-card__comment">
                    <Link
                      href={`/profile/${encodeURIComponent(comment.author.handle)}`}
                      className="b-post-card__comment-author"
                    >
                      @{comment.author.handle}
                    </Link>
                    <FacetText
                      text={comment.text}
                      facets={comment.facets}
                      className="b-post-card__comment-text"
                    />
                    {comment.likeCount > 0 ? (
                      <span className="b-post-card__comment-likes">like {comment.likeCount}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
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
          {onFeedback !== undefined ? (
            <>
              <button
                type="button"
                className="b-post-card__action"
                title="more like this · +"
                aria-label="more like this"
                onClick={() => {
                  if (!authed) {
                    openDialog('login')
                    return
                  }
                  onFeedback('more')
                }}
              >
                more
              </button>
              <button
                type="button"
                className="b-post-card__action"
                title="less like this · -"
                aria-label="less like this"
                onClick={() => {
                  if (!authed) {
                    openDialog('login')
                    return
                  }
                  onFeedback('less')
                }}
              >
                less
              </button>
            </>
          ) : null}
          {own ? (
            confirmingDelete ? (
              <>
                <button
                  type="button"
                  className="b-post-card__action b-post-card__action--danger"
                  disabled={deleting}
                  title="delete · d"
                  onClick={() => {
                    void confirmDelete()
                  }}
                >
                  {deleting ? 'deleting' : 'confirm delete'}
                </button>
                <button
                  type="button"
                  className="b-post-card__action"
                  disabled={deleting}
                  onClick={() => {
                    setConfirmingDelete(false)
                  }}
                >
                  cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="b-post-card__action b-post-card__action--danger"
                title="delete · d"
                onClick={() => {
                  setConfirmingDelete(true)
                }}
              >
                delete
              </button>
            )
          ) : null}
          {deleteError !== null ? (
            <span className="b-post-card__delete-error" role="alert">
              {deleteError}
            </span>
          ) : null}
        </div>
      </footer>
    </article>
  )
}
