// biome-ignore-all lint/a11y/noNoninteractiveTabindex: replies are a focusable keyboard list
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'wouter'
import { FacetText } from '../components/FacetText'
import { PostCard } from '../components/PostCard'
import { RelativeTime } from '../components/RelativeTime'
import { EmptyState, ErrorNotice, Frame, Progress } from '../components/ui'
import { useThread } from '../hooks/useBskyQueries'
import { useViewerSync } from '../hooks/useViewerSync'
import { errorInfo } from '../lib/errors'
import { scrollPostBody } from '../lib/scroll'
import type { ThreadEntry } from '../lib/types'
import { useUiStore } from '../lib/ui'

function replyHandle(entry: ThreadEntry): string {
  return entry.post.author.handle.length > 0 ? entry.post.author.handle : 'unknown'
}

let hasAppHistory = false

if (typeof window !== 'undefined') {
  window.addEventListener('pushState', () => {
    hasAppHistory = true
  })
}

export default function ThreadView() {
  const [, navigate] = useLocation()
  const [searchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const [focusedReply, setFocusedReply] = useState<number | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const replyRefs = useRef<(HTMLElement | null)[]>([])
  const thread = useThread(uri)
  const entries = thread.data?.entries ?? []
  const focus = entries.find((entry) => entry.role === 'focus')
  const openingPost = useUiStore((state) => state.openingPost)
  const focusPost = focus?.post ?? (openingPost?.uri === uri ? openingPost : null)
  const replies = entries.filter((entry) => entry.role === 'reply')
  useViewerSync(entries.map((entry) => entry.post))
  const info = thread.error !== null ? errorInfo(thread.error) : null
  const loadingReplies = (
    <div className="b-thread__replies">
      <p className="b-thread__replies-label">replies</p>
      <p className="b-thread__replies-empty">loading replies</p>
    </div>
  )

  useEffect(() => {
    setFocusedReply(null)
  }, [uri])

  useEffect(() => {
    const handleScrollKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const isPage = event.key === 'PageDown' || event.key === 'PageUp'
      const isShiftArrow = event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      if (!isPage && !isShiftArrow) return
      if (event.target instanceof HTMLElement) {
        if (event.target.isContentEditable) return
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      }
      if (useUiStore.getState().themeMenuOpen) return
      if (document.querySelector('dialog[open]') !== null) return
      const direction = event.key === 'PageUp' || event.key === 'ArrowUp' ? -1 : 1
      if (scrollPostBody(document.querySelector('.b-thread > .b-post-card'), direction)) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleScrollKey)
    return () => {
      window.removeEventListener('keydown', handleScrollKey)
    }
  }, [])

  useEffect(() => {
    if (focusedReply !== null) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.shiftKey) return
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'j' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'k'
      ) {
        return
      }
      if (event.target instanceof HTMLElement) {
        if (event.target.isContentEditable) return
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      }
      if (useUiStore.getState().themeMenuOpen) return
      if (document.querySelector('dialog[open]') !== null) return

      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        if (hasAppHistory) {
          window.history.back()
        } else {
          navigate('/feed')
        }
        return
      }

      const first = replyRefs.current[0]
      if (first === null || first === undefined) return
      event.preventDefault()
      first.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [focusedReply, replies.length])

  const focusNextReply = (index: number) => {
    const next = replyRefs.current[index + 1]
    if (next !== null && next !== undefined) next.focus()
  }

  const focusPreviousReply = (index: number) => {
    if (index === 0) {
      mainRef.current?.focus()
      return
    }
    const previous = replyRefs.current[index - 1]
    if (previous !== null && previous !== undefined) previous.focus()
  }

  const handleReplyKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusNextReply(index)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusPreviousReply(index)
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    if ((event.target as HTMLElement).closest('a, button') !== null) return
    const entry = replies[index]
    if (entry === undefined) return
    event.preventDefault()
    navigate(`/thread?uri=${encodeURIComponent(entry.post.uri)}`)
  }

  const replyList = (
    <div className="b-thread__replies">
      <p className="b-thread__replies-label">replies</p>
      {replies.length === 0 ? (
        <p className="b-thread__replies-empty">no replies yet</p>
      ) : (
        replies.map((entry, index) => (
          <article
            key={entry.post.uri}
            ref={(node) => {
              replyRefs.current[index] = node
            }}
            className="b-thread__reply"
            data-depth={Math.min(entry.depth, 4)}
            data-focused={focusedReply === index ? 'true' : 'false'}
            tabIndex={0}
            onFocus={() => {
              setFocusedReply(index)
            }}
            onBlur={(event) => {
              const next = event.relatedTarget
              if (next instanceof Node && mainRef.current?.contains(next)) return
              setFocusedReply(null)
            }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('a, button') !== null) return
              event.currentTarget.focus()
            }}
            onKeyDown={(event) => {
              handleReplyKeyDown(event, index)
            }}
          >
            <div className="b-thread__reply-head">
              <Link
                href={`/profile/${encodeURIComponent(replyHandle(entry))}`}
                className="b-thread__reply-author"
              >
                @{replyHandle(entry)}
              </Link>
              <RelativeTime iso={entry.post.indexedAt} />
            </div>
            {entry.post.text.length > 0 ? (
              <FacetText
                text={entry.post.text}
                facets={entry.post.facets}
                className="b-thread__reply-text"
              />
            ) : (
              <span className="b-thread__reply-text">[no text]</span>
            )}
            <Link
              href={`/thread?uri=${encodeURIComponent(entry.post.uri)}`}
              className="b-thread__reply-open"
            >
              open thread
            </Link>
          </article>
        ))
      )}
    </div>
  )

  return (
    <section className="b-view">
      <h1 className="visually-hidden">thread</h1>
      <div className="b-view__body b-view__body--thread">
        {uri.length === 0 ? (
          <EmptyState title="no thread selected" hint="open a card or paste an at-uri" />
        ) : info !== null ? (
          <ErrorNotice title={info.title} message={info.detail} onRetry={thread.retry} />
        ) : focusPost === null ? (
          thread.isPending ? (
            <Frame label="thread" meta="loading">
              <p className="mono-label">loading replies</p>
              <Progress indeterminate />
            </Frame>
          ) : (
            <EmptyState title="empty thread" hint="the appview returned no posts" />
          )
        ) : (
          <div
            ref={mainRef}
            className="b-thread"
            tabIndex={-1}
            onFocusCapture={(event) => {
              if (!(event.target instanceof HTMLElement)) return
              if (event.target.closest('.b-thread__reply') === null) setFocusedReply(null)
            }}
          >
            <PostCard
              post={focusPost}
              focused={focusedReply === null}
              replies={thread.isPending && focus === undefined ? loadingReplies : replyList}
            />
          </div>
        )}
      </div>
    </section>
  )
}
