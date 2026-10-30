import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useTopComments } from '../hooks/useTopComments'
import { displayedCount, useActionStore } from '../lib/actionStore'
import { deletePost, type FeedFeedbackEvent } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { errorInfo } from '../lib/errors'
import { postWebUrl } from '../lib/postUrl'
import { invalidateNonFeedQueries } from '../lib/queries'
import type { PostModel } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { DitherImage } from './DitherImage'
import { Embeds } from './Embeds'
import { FacetText } from './FacetText'
import { MediaViewer, mediaItems } from './MediaViewer'
import { RelativeTime } from './RelativeTime'
import { Tag } from './ui'

export interface PostCardProps {
  post: PostModel
  index?: number
  focused?: boolean
  eyebrow?: string
  replies?: ReactNode
  showReplyContext?: boolean
  onFeedback?: (event: FeedFeedbackEvent) => void
  onDismiss?: () => void
}

function quotedPostUri(post: PostModel): string | null {
  if (post.embed === null) return null
  if (post.embed.type === 'quote') return post.embed.post.uri
  if (post.embed.type === 'recordWithMedia') return post.embed.quote.uri
  return null
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
  showReplyContext = true,
  onFeedback,
  onDismiss,
}: PostCardProps) {
  const [, navigate] = useLocation()
  const quotedUri = quotedPostUri(post)
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
  const [leaving, setLeaving] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const media = mediaItems(post.embed)
  const dismissTimerRef = useRef<number | null>(null)
  const copyTimerRef = useRef<number | null>(null)
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
  const openInlineCompose = useUiStore((state) => state.openInlineCompose)
  const inlineTarget = focused && replies !== undefined

  const openReplyCompose = () => {
    if (!authed) {
      openDialog('login')
      return
    }
    if (inlineTarget) {
      openInlineCompose({ mode: 'reply', post })
      return
    }
    openCompose({ mode: 'reply', post })
  }

  const openQuoteCompose = () => {
    if (!authed) {
      openDialog('login')
      return
    }
    if (inlineTarget) {
      openInlineCompose({ mode: 'quote', post })
      return
    }
    openCompose({ mode: 'quote', post })
  }

  const copyLink = useCallback(async () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    try {
      await navigator.clipboard.writeText(postWebUrl(post))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopyState('idle')
      copyTimerRef.current = null
    }, 1600)
  }, [post])

  const feedbackAction = useCallback(
    (kind: FeedFeedbackEvent) => {
      if (!authed) {
        openDialog('login')
        return
      }
      if (feedbackSent) return
      if (kind === 'less' && onDismiss !== undefined && !leaving) {
        setLeaving(true)
        dismissTimerRef.current = window.setTimeout(onDismiss, 240)
      }
      onFeedback?.(kind)
      if (kind === 'more') setFeedbackSent(true)
    },
    [authed, openDialog, onDismiss, onFeedback, leaving, feedbackSent],
  )

  useEffect(() => {
    setConfirmingDelete(false)
    setDeleteError(null)
    setLeaving(false)
    setFeedbackSent(false)
    setCopyState('idle')
  }, [post.uri, own])

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    }
  }, [])

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
        if (event.target.closest('a') !== null) return
      }

      const ui = useUiStore.getState()
      if (ui.dialog !== null || ui.compose !== null || ui.inlineCompose !== null) return
      if (document.querySelector('dialog[open]') !== null) return

      if (event.key === 'v' && cardRef.current !== null) {
        const poster = cardRef.current.querySelector<HTMLButtonElement>('.b-video-player__poster')
        if (poster !== null) {
          event.preventDefault()
          poster.click()
          return
        }
        const video = cardRef.current.querySelector<HTMLVideoElement>('.b-video-player__video')
        if (video !== null) {
          event.preventDefault()
          if (video.paused) {
            void video.play().catch(() => {})
          } else {
            video.pause()
          }
          return
        }
      }

      if (event.key === 'm' && media.length > 0) {
        event.preventDefault()
        setMediaOpen(true)
        return
      }

      if (event.key === '0' && quotedUri !== null) {
        event.preventDefault()
        navigate(`/thread?uri=${encodeURIComponent(quotedUri)}`)
        return
      }

      if (event.key === 'y') {
        event.preventDefault()
        void copyLink()
        return
      }

      const authenticated = useAuthStore.getState().status === 'authenticated'
      const interact = (action: () => void) => {
        if (!authenticated) {
          ui.openDialog('login')
          return
        }
        action()
      }
      const inline = focused && replies !== undefined
      const open = (mode: 'reply' | 'quote') => {
        if (inline) {
          ui.openInlineCompose({ mode, post })
          return
        }
        ui.openCompose({ mode, post })
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
          interact(() => open('reply'))
          break
        case 'q':
          event.preventDefault()
          interact(() => open('quote'))
          break
        case '+':
          if (onFeedback === undefined) break
          event.preventDefault()
          feedbackAction('more')
          break
        case '-':
          if (onFeedback === undefined) break
          event.preventDefault()
          feedbackAction('less')
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [focused, post, feedbackAction, copyLink, navigate, quotedUri, replies, media.length])

  const confirmDelete = async () => {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)

    try {
      await deletePost(post.uri)
      await invalidateNonFeedQueries(queryClient)
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
        if (event.target.closest('a') !== null) return
      }

      const ui = useUiStore.getState()
      if (ui.dialog !== null || ui.compose !== null || ui.inlineCompose !== null) return
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
  }, [focused, own, confirmingDelete, deleting, post, quotedUri, navigate, replies])

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
  if (leaving) classes.push('b-post-card--leaving')

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

        {showReplyContext && post.replyContext !== null ? (
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
                  <li
                    key={comment.uri}
                    className="b-post-card__comment"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: the whole reply opens its thread
                    tabIndex={0}
                    onClick={(event) => {
                      const target = event.target
                      if (target instanceof HTMLElement && target.closest('a') !== null) return
                      navigate(`/thread?uri=${encodeURIComponent(comment.uri)}`)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      const target = event.target
                      if (target instanceof HTMLElement && target.closest('a') !== null) return
                      event.preventDefault()
                      navigate(`/thread?uri=${encodeURIComponent(comment.uri)}`)
                    }}
                  >
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
          {authed ? (
            <>
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
                  void useActionStore.getState().toggleRepost(post)
                }}
              >
                rt {repostCount}
              </button>
              <button type="button" className="b-post-card__action" onClick={openReplyCompose}>
                reply
              </button>
              <button type="button" className="b-post-card__action" onClick={openQuoteCompose}>
                quote
              </button>
              {onFeedback !== undefined ? (
                feedbackSent ? (
                  <span className="b-post-card__feedback-sent" role="status">
                    feedback sent to the feed operator
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="b-post-card__action"
                      title="more like this · +"
                      aria-label="more like this"
                      onClick={() => {
                        feedbackAction('more')
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
                        feedbackAction('less')
                      }}
                    >
                      less
                    </button>
                  </>
                )
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
            </>
          ) : null}
          <button
            type="button"
            className="b-post-card__action"
            data-state={copyState}
            title="copy bsky.app link · y"
            aria-live="polite"
            onClick={() => {
              void copyLink()
            }}
          >
            {copyState === 'copied'
              ? 'copied'
              : copyState === 'failed'
                ? 'copy failed'
                : 'copy link'}
          </button>
        </div>
      </footer>
      <MediaViewer
        open={mediaOpen}
        items={media}
        onClose={() => {
          setMediaOpen(false)
        }}
      />
    </article>
  )
}
