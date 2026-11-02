import { useQueryClient } from '@tanstack/react-query'
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useLocation } from 'wouter'
import { isEditableTarget, isInteractiveTarget } from '../hooks/useHotkeys'
import { useTopComments } from '../hooks/useTopComments'
import { displayedCount, useActionStore } from '../lib/actionStore'
import { deletePost, type FeedFeedbackEvent } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { focusOwningDeck } from '../lib/deckFocus'
import { errorInfo } from '../lib/errors'
import { characterShortcutAllowed } from '../lib/keymap'
import { postWebUrl } from '../lib/postUrl'
import { invalidateNonFeedQueries } from '../lib/queries'
import { useSettings } from '../lib/store'
import type { PostModel } from '../lib/types'
import { uiOwnsKeyboard, useUiStore } from '../lib/ui'
import { Avatar } from './Avatar'
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
  onFeedback?: (event: FeedFeedbackEvent) => Promise<void>
  onDismiss?: () => void
  onOpen?: () => void
}

function mediaWord(embed: PostModel['embed']): string {
  if (embed === null) return 'media'
  if (embed.type === 'video') return 'video'
  if (embed.type === 'images') return 'image'
  if (embed.type === 'recordWithMedia') return mediaWord(embed.media)
  return 'media'
}

/**
 * Whether revealing a label would actually uncover media. Text-only quotes,
 * unavailable or unknown embeds, empty grids and thumbless external cards have
 * nothing to hide, so they must never offer a reveal control.
 */
function concealableMedia(embed: PostModel['embed']): boolean {
  if (embed === null) return false
  switch (embed.type) {
    case 'images':
      return embed.images.length > 0
    case 'video':
      return true
    case 'external':
      return embed.thumb !== null && embed.thumb.length > 0
    case 'recordWithMedia':
      return concealableMedia(embed.media)
    default:
      return false
  }
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

/** how long `d` stays armed before the confirm expires */
const DELETE_ARM_MS = 4000

export function PostCard({
  post,
  index,
  focused = false,
  eyebrow,
  replies,
  showReplyContext = true,
  onFeedback,
  onDismiss,
  onOpen,
}: PostCardProps) {
  const [, navigate] = useLocation()
  const quotedUri = quotedPostUri(post)
  const handle = post.author.handle.length > 0 ? post.author.handle : 'unknown'
  const displayName = post.author.displayName.length > 0 ? post.author.displayName : handle
  const profileHref = `/profile/${encodeURIComponent(handle)}`
  const threadHref = `/thread?uri=${encodeURIComponent(post.uri)}`

  const authed = useAuthStore((state) => state.status === 'authenticated')
  const accountDid = useAuthStore((state) => state.account?.did ?? null)
  const queryClient = useQueryClient()
  const cardRef = useRef<HTMLElement>(null)
  // a control in the top bar or another card keeps its own keys: only this
  // card's own controls may lose their keys to its shortcuts
  const ownsOutsideCard = (target: EventTarget | null): boolean =>
    isInteractiveTarget(target) &&
    !(target instanceof Node && cardRef.current?.contains(target) === true)
  const [inView, setInView] = useState(false)
  // a labelled post hides its media until the reader asks for it
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    setRevealed(false)
  }, [post.uri])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // a successful write replaces the card's actions with a local result
  const [deleted, setDeleted] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [feedbackPending, setFeedbackPending] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // a new array per render would re-run every media consumer
  const media = useMemo(() => mediaItems(post.embed), [post.embed])
  // only media that can actually be hidden is concealed; a text-only quote
  // under a label keeps its text, links and focus
  const concealable = concealableMedia(post.embed)
  const mediaConcealed = post.labels.length > 0 && !revealed && concealable
  // labelled media stays closed until the reader asks for it; the badges obey
  // the same rule, because a key that is refused must not advertise itself
  const mediaReady = post.labels.length === 0 || revealed
  // the overlay only decorates the card the deck has focused, and only with
  // actions this state can actually run
  const mediaHints: string[] = []
  if (focused) {
    if (mediaReady && media.length > 0) mediaHints.push('card-media')
    if (mediaReady && post.embed !== null && post.embed.type === 'video') {
      mediaHints.push('card-video')
    }
    if (quotedUri !== null) mediaHints.push('card-quoted')
  }
  const dismissTimerRef = useRef<number | null>(null)
  const copyTimerRef = useRef<number | null>(null)
  const deleteArmTimerRef = useRef<number | null>(null)
  // the primary delete control keeps its DOM node across arm, confirm and
  // cancel; cancel returns focus to it explicitly
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const clearDeleteArmTimer = useCallback(() => {
    if (deleteArmTimerRef.current !== null) {
      window.clearTimeout(deleteArmTimerRef.current)
      deleteArmTimerRef.current = null
    }
  }, [])
  const cancelDelete = useCallback(() => {
    clearDeleteArmTimer()
    setConfirmingDelete(false)
  }, [clearDeleteArmTimer])
  // the visible cancel control clears the pending arm and returns focus to the
  // primary button it disarmed
  const cancelArmedDelete = useCallback(() => {
    cancelDelete()
    deleteButtonRef.current?.focus()
  }, [cancelDelete])
  // a delete waits 4s for its confirm, then forgets the arm
  const armDelete = useCallback(() => {
    clearDeleteArmTimer()
    setConfirmingDelete(true)
    deleteArmTimerRef.current = window.setTimeout(() => {
      deleteArmTimerRef.current = null
      setConfirmingDelete(false)
    }, DELETE_ARM_MS)
  }, [clearDeleteArmTimer])
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
    async (kind: FeedFeedbackEvent) => {
      if (!authed) {
        openDialog('login')
        return
      }
      // one submission at a time; the operator hears about it once
      if (feedbackSent || feedbackPending || onFeedback === undefined) return
      // the pressed control is about to be disabled or removed; the deck takes
      // keyboard ownership before that happens
      focusOwningDeck(cardRef.current)
      setFeedbackPending(true)
      setFeedbackError(null)
      try {
        await onFeedback(kind)
        if (kind === 'more') setFeedbackSent(true)
        // dismissal waits for the operator to accept the less signal
        if (kind === 'less' && onDismiss !== undefined) {
          setLeaving(true)
          dismissTimerRef.current = window.setTimeout(onDismiss, 240)
        }
      } catch (caught) {
        setFeedbackError(errorInfo(caught).detail)
      } finally {
        setFeedbackPending(false)
      }
    },
    [authed, openDialog, onDismiss, onFeedback, feedbackSent, feedbackPending],
  )

  useEffect(() => {
    cancelDelete()
    setDeleted(false)
    setDeleteError(null)
    setLeaving(false)
    setFeedbackSent(false)
    setFeedbackPending(false)
    setFeedbackError(null)
    setCopyState('idle')
  }, [post.uri, own, cancelDelete])

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      clearDeleteArmTimer()
    }
  }, [clearDeleteArmTimer])

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
      // an IME composition owns its keystrokes; never treat them as shortcuts
      if (event.isComposing) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // an editable field owns its keys, and so does any interactive control
      // outside this card; a link inside it keeps its own activation too
      if (isEditableTarget(event.target)) return
      if (ownsOutsideCard(event.target)) return
      if (event.target instanceof HTMLElement && event.target.closest('a') !== null) return

      if (uiOwnsKeyboard()) return
      if (document.querySelector('dialog[open]') !== null) return
      // every card shortcut is a bare printable key; the opt-out leaves Esc
      // and a confirming Enter alone
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return

      // a deleted card mutates and opens nothing; only the copy affordance
      // remains, matching the visible footer
      if (deleted) {
        if (event.key === 'y') {
          event.preventDefault()
          void copyLink()
        }
        return
      }

      // x is the keyboard path to labelled media: reveal first, then v and m
      if (event.key === 'x' && !revealed && concealable) {
        event.preventDefault()
        setRevealed(true)
        return
      }

      if (event.key === 'v' && mediaReady && cardRef.current !== null) {
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

      if (event.key === 'm' && mediaReady && media.length > 0) {
        event.preventDefault()
        setMediaOpen(true)
        return
      }

      // o opens the quoted post; 0 stays as a one-release alias
      if ((event.key === 'o' || event.key === '0') && quotedUri !== null) {
        event.preventDefault()
        navigate(`/thread?uri=${encodeURIComponent(quotedUri)}`)
        return
      }

      if (event.key === 'y') {
        event.preventDefault()
        void copyLink()
        return
      }

      const ui = useUiStore.getState()
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
          void feedbackAction('more')
          break
        case '-':
          if (onFeedback === undefined) break
          event.preventDefault()
          void feedbackAction('less')
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    focused,
    post,
    feedbackAction,
    copyLink,
    navigate,
    quotedUri,
    replies,
    media.length,
    mediaReady,
    deleted,
    concealable,
  ])

  const confirmDelete = useCallback(async () => {
    if (deleting) return
    // the confirm IS the second press; the arm timer must not race the write
    clearDeleteArmTimer()
    // the confirming control is disabled for the write, so the deck owns
    // keyboard focus before that happens
    focusOwningDeck(cardRef.current)
    setDeleting(true)
    setDeleteError(null)

    try {
      await deletePost(post.uri)
      await invalidateNonFeedQueries(queryClient)
      // a successful write leaves a local result instead of the actions
      setConfirmingDelete(false)
      setDeleted(true)
    } catch (error) {
      setDeleteError(errorInfo(error).detail)
      // a failed confirm stays armed only for another 4s
      armDelete()
    } finally {
      setDeleting(false)
    }
  }, [deleting, post.uri, queryClient, clearDeleteArmTimer, armDelete])

  useEffect(() => {
    if (!focused || !own || deleted) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.isComposing) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // an editable field owns its keys, and so does any interactive control
      // outside this card; a link inside it keeps its own activation too
      if (isEditableTarget(event.target)) return
      if (ownsOutsideCard(event.target)) return
      if (event.target instanceof HTMLElement && event.target.closest('a') !== null) return

      if (uiOwnsKeyboard()) return
      if (document.querySelector('dialog[open]') !== null) return
      // every card shortcut is a bare printable key; the opt-out leaves Esc
      // and a confirming Enter alone
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return

      // esc disarms without deleting; only an armed card claims it
      if (event.key === 'Escape') {
        if (!confirmingDelete) return
        event.preventDefault()
        cancelDelete()
        return
      }

      // enter confirms an armed delete; d arms and then confirms
      if (event.key !== 'd' && !(confirmingDelete && event.key === 'Enter')) return

      event.preventDefault()
      if (confirmingDelete) {
        void confirmDelete()
      } else {
        armDelete()
      }
    }

    // capture: an armed delete must confirm before the deck's bubble-phase
    // enter/space activation can open the card
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [focused, own, deleted, confirmingDelete, confirmDelete, armDelete, cancelDelete])

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

  // a card with no index, eyebrow or reason reads better with no head band at
  // all; the timestamp moves down beside the author instead of floating alone
  const hasHead =
    index !== undefined || (eyebrow !== undefined && eyebrow.length > 0) || reasonLabels.length > 0

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

  // the card opens its thread on a plain click; anything that owns its own
  // click, including the comment rows and the media, keeps it. a deleted card
  // has nowhere to open.
  const handleCardClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (onOpen === undefined || deleted || event.defaultPrevented) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (
      target.closest(
        'a, button, input, textarea, select, summary, label, dialog, [role="button"], [role="link"], [contenteditable="true"], .b-post-card__comments, .b-post-card__media, .b-post-card__foot',
      ) !== null
    ) {
      return
    }
    onOpen()
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the deck owns keyboard activation
    <article
      ref={cardRef}
      className={classes.join(' ')}
      onClick={handleCardClick}
      data-clickable={onOpen !== undefined && !deleted ? 'true' : undefined}
      aria-busy={deleting || feedbackPending ? true : undefined}
    >
      <div className="b-frame__body b-post-card__body">
        {hasHead ? (
          <div className="b-post-card__meta">
            {index !== undefined ? (
              <span className="b-post-card__index">
                [{String(Math.max(0, index)).padStart(2, '0')}]
              </span>
            ) : null}
            {eyebrow !== undefined && eyebrow.length > 0 ? (
              <Tag tone="accent">{eyebrow}</Tag>
            ) : null}
            {reasonLabels.map((label) => (
              <Tag key={label} tone="default">
                {label}
              </Tag>
            ))}
          </div>
        ) : null}

        <div className="b-post-card__author">
          <Link href={profileHref} className="b-post-card__avatar">
            <Avatar src={post.author.avatar} alt={`avatar of @${handle}`} name={displayName} />
          </Link>
          <span className="b-post-card__identity">
            <Link href={profileHref} className="b-post-card__name">
              <span>{displayName}</span>
            </Link>
            <span className="b-post-card__handle">@{handle}</span>
          </span>
          <span className="b-post-card__time">
            <RelativeTime iso={post.indexedAt} />
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

        {post.embed !== null ? (
          <div
            className="b-post-card__media"
            data-spoil={mediaConcealed ? 'true' : undefined}
            data-keyhint={mediaHints.length === 0 ? undefined : mediaHints.join(' ')}
          >
            <Embeds embed={post.embed} concealed={mediaConcealed} />
            {mediaConcealed ? (
              <button
                type="button"
                className="b-spoil"
                aria-label={`show ${mediaWord(post.embed)} behind the ${post.labels.join(' ')} label`}
                onClick={(event) => {
                  // revealing media must never follow the embed's link
                  event.preventDefault()
                  event.stopPropagation()
                  setRevealed(true)
                }}
              >
                show {mediaWord(post.embed)}
              </button>
            ) : null}
          </div>
        ) : null}

        {replies}

        {replies === undefined && inView && post.replyCount > 0 ? (
          <section className="b-post-card__comments" aria-label="top comments">
            <p className="b-post-card__comments-label">top comments</p>
            {topComments.isPending ? (
              <p className="b-post-card__comments-note">loading comments</p>
            ) : topComments.error !== null && topComments.comments.length === 0 ? (
              <p className="b-post-card__comments-note">comments unavailable</p>
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
          {deleted ? (
            <span className="b-post-card__feedback-sent" role="status">
              post deleted
            </span>
          ) : authed ? (
            <>
              <Link href={threadHref} className="b-post-card__action">
                re {post.replyCount}
              </Link>
              <button
                type="button"
                className="b-post-card__action"
                data-kind="like"
                data-keyhint={focused ? 'card-like' : undefined}
                aria-pressed={liked}
                aria-label={`like, ${likeCount}`}
                aria-busy={pending ? true : undefined}
                disabled={pending}
                onClick={() => {
                  focusOwningDeck(cardRef.current)
                  void useActionStore.getState().toggleLike(post)
                }}
              >
                like {likeCount}
              </button>
              <button
                type="button"
                className="b-post-card__action"
                data-kind="repost"
                data-keyhint={focused ? 'card-repost' : undefined}
                aria-pressed={reposted}
                aria-label={`repost, ${repostCount}`}
                aria-busy={pending ? true : undefined}
                disabled={pending}
                onClick={() => {
                  focusOwningDeck(cardRef.current)
                  void useActionStore.getState().toggleRepost(post)
                }}
              >
                rt {repostCount}
              </button>
              <button
                type="button"
                className="b-post-card__action"
                data-keyhint={focused ? 'card-reply' : undefined}
                onClick={openReplyCompose}
              >
                reply
              </button>
              <button
                type="button"
                className="b-post-card__action"
                data-keyhint={focused ? 'card-quote' : undefined}
                onClick={openQuoteCompose}
              >
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
                      data-keyhint={focused ? 'card-more' : undefined}
                      title="more like this · +"
                      aria-label="more like this"
                      aria-busy={feedbackPending ? true : undefined}
                      disabled={feedbackPending}
                      onClick={() => {
                        void feedbackAction('more')
                      }}
                    >
                      more
                    </button>
                    <button
                      type="button"
                      className="b-post-card__action"
                      data-keyhint={focused ? 'card-fewer' : undefined}
                      title="less like this · -"
                      aria-label="less like this"
                      aria-busy={feedbackPending ? true : undefined}
                      disabled={feedbackPending}
                      onClick={() => {
                        void feedbackAction('less')
                      }}
                    >
                      less
                    </button>
                  </>
                )
              ) : null}
              {own ? (
                <>
                  <button
                    ref={deleteButtonRef}
                    type="button"
                    className="b-post-card__action b-post-card__action--danger"
                    data-keyhint={focused ? 'card-delete' : undefined}
                    title="delete · d"
                    aria-busy={deleting ? true : undefined}
                    disabled={deleting}
                    onClick={() => {
                      // one node arms and then confirms; the second press on
                      // the armed control is the confirm
                      if (confirmingDelete) {
                        void confirmDelete()
                        return
                      }
                      armDelete()
                    }}
                  >
                    {confirmingDelete ? (deleting ? 'deleting' : 'confirm delete') : 'delete'}
                  </button>
                  {confirmingDelete ? (
                    <button
                      type="button"
                      className="b-post-card__action"
                      disabled={deleting}
                      onClick={cancelArmedDelete}
                    >
                      cancel
                    </button>
                  ) : null}
                  {confirmingDelete ? (
                    <span
                      className="visually-hidden"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      delete armed, press again to confirm
                    </span>
                  ) : null}
                </>
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
            data-keyhint={focused ? 'card-copy' : undefined}
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
        {error !== null ? (
          <p className="b-post-card__action-error" role="alert">
            {error}
          </p>
        ) : null}
        {feedbackError !== null ? (
          <p className="b-post-card__action-error" role="alert">
            {feedbackError}
          </p>
        ) : null}
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
