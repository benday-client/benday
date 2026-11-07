// biome-ignore-all lint/a11y/noNoninteractiveTabindex: replies are a focusable keyboard list
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'wouter'
import { FacetText } from '../components/FacetText'
import { InlineComposer } from '../components/InlineComposer'
import { PostCard } from '../components/PostCard'
import { RelativeTime } from '../components/RelativeTime'
import { EmptyState, ErrorNotice, Frame, Progress } from '../components/ui'
import { useThread } from '../hooks/useBskyQueries'
import { isEditableTarget, isImeComposing, isInteractiveTarget } from '../hooks/useHotkeys'
import { useRetainedError } from '../hooks/useRetainedError'
import { useViewerSync } from '../hooks/useViewerSync'
import { useAuthStore } from '../lib/auth'
import { errorInfo } from '../lib/errors'
import { goBackOrFallback, THREAD_FALLBACK_VIEW } from '../lib/history'
import { characterShortcutAllowed } from '../lib/keymap'
import { scrollCardBody, scrollThreadPage } from '../lib/scroll'
import { useSettings } from '../lib/store'
import type { PostModel, ThreadEntry } from '../lib/types'
import { uiOwnsKeyboard, useUiStore } from '../lib/ui'

function replyHandle(entry: ThreadEntry): string {
  return entry.post.author.handle.length > 0 ? entry.post.author.handle : 'unknown'
}

/**
 * The post `p` walks up to: the direct parent of the focused reply, or of the
 * focus post when no reply is selected. A selected reply never falls back to
 * the focus post, so the key cannot skip a level.
 */
export function threadParentTarget(
  focusPost: PostModel | null,
  focusedReplyPost: PostModel | null,
): string | null {
  const source = focusedReplyPost ?? focusPost
  return source?.replyParent?.uri ?? null
}

export default function ThreadView() {
  const [, navigate] = useLocation()
  const [searchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const [focusedReply, setFocusedReply] = useState<number | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  // a control outside this thread keeps its own Enter/Space/arrow behaviour;
  // inside it the existing link and button exceptions still apply
  const interactiveOutsideThread = (target: EventTarget | null): boolean => {
    if (!isInteractiveTarget(target)) return false
    const root = mainRef.current
    return root === null || !(target instanceof Node) || !root.contains(target)
  }
  const replyRefs = useRef<(HTMLElement | null)[]>([])
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const thread = useThread(uri)
  const requestKey = `${viewerDid ?? 'anonymous'}\u0000${uri}`
  const entries = thread.data?.entries ?? []
  const focus = entries.find((entry) => entry.role === 'focus')
  const openingPost = useUiStore((state) => state.openingPost)
  const inlineCompose = useUiStore((state) => state.inlineCompose)
  const closeInlineCompose = useUiStore((state) => state.closeInlineCompose)
  const focusPost = focus?.post ?? (openingPost?.uri === uri ? openingPost : null)
  const replies = entries.filter((entry) => entry.role === 'reply')
  const replyIndexByUri = new Map(replies.map((entry, index) => [entry.post.uri, index] as const))
  const parentTargetOf = (index: number): number | 'focus' | null => {
    const entry = replies[index]
    if (entry === undefined) return null
    const parentUri = entry.post.replyParent?.uri ?? null
    if (parentUri !== null) {
      if (parentUri === focusPost?.uri) return 'focus'
      const parentIndex = replyIndexByUri.get(parentUri)
      if (parentIndex !== undefined) return parentIndex
    }
    // cached threads and fixtures can omit replyParent; pre-order depth still
    // identifies the nearest ancestor
    if (entry.depth <= 1) return 'focus'
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = replies[cursor]
      if (candidate !== undefined && candidate.depth === entry.depth - 1) return cursor
    }
    return null
  }
  const focusedReplyPost = focusedReply === null ? null : (replies[focusedReply]?.post ?? null)
  useViewerSync(entries.map((entry) => entry.post))
  // tanstack clears the error while a refetch has no data yet; the failure the
  // reader is retrying has to stay on screen while that request runs
  const threadFailure = useRetainedError(
    requestKey,
    thread.data !== null,
    thread.error ?? null,
    thread.isFetching,
  )
  const shownInfo = threadFailure.error === null ? null : errorInfo(threadFailure.error)
  const retryThread = () => {
    threadFailure.retry(thread.retry)
  }
  const loadingReplies = (
    <div className="b-thread__replies">
      <Progress label="loading replies" indeterminate />
    </div>
  )

  useEffect(() => {
    setFocusedReply(null)
    // a request that targets this thread arrived with the route change and must
    // survive the mount so the dock can focus it; one for another thread closes
    const request = useUiStore.getState().inlineCompose
    if (request?.post?.uri !== uri) closeInlineCompose()
  }, [uri, closeInlineCompose])

  useEffect(() => {
    return () => {
      closeInlineCompose()
    }
  }, [closeInlineCompose])

  useEffect(() => {
    if (inlineCompose === null || focusPost === null) return
    if (inlineCompose.post?.uri !== focusPost.uri) closeInlineCompose()
  }, [inlineCompose, focusPost, closeInlineCompose])

  useEffect(() => {
    const handleScrollKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const isPage = event.key === 'PageDown' || event.key === 'PageUp'
      const isShiftArrow = event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      if (!isPage && !isShiftArrow) return
      if (interactiveOutsideThread(event.target)) return
      if (isEditableTarget(event.target)) return
      if (document.querySelector('dialog[open]') !== null) return
      if (uiOwnsKeyboard()) return
      const direction = event.key === 'PageUp' || event.key === 'ArrowUp' ? -1 : 1
      // the thread view owns these keys outright: when nothing can scroll the
      // key must still be consumed instead of extending a text selection
      event.preventDefault()
      scrollCardBody(document.querySelector('.b-thread > .b-post-card'), direction)
      scrollThreadPage(direction)
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
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      if (event.shiftKey) return
      if (event.isComposing) return
      // left is the thread's back key. down enters the replies and walks them
      // in pre-order; at the opened post up is swallowed. p is the only way to
      // open the parent thread.
      const key = event.key
      const isLeave = key === 'ArrowLeft'
      const isTreeKey =
        key === 'ArrowDown' ||
        key === 'ArrowUp' ||
        key === 'j' ||
        key === 'k' ||
        key === 'Home' ||
        key === 'End'
      if (!isLeave && !isTreeKey) return
      if (interactiveOutsideThread(event.target)) return
      if (isEditableTarget(event.target)) return
      if (document.querySelector('dialog[open]') !== null) return
      if (uiOwnsKeyboard()) return

      if (isLeave) {
        if (event.repeat) return
        event.preventDefault()
        goBackOrFallback(navigate, THREAD_FALLBACK_VIEW)
        return
      }

      if (key === 'ArrowUp') {
        // the opened post is the root of this view; up goes nowhere and must not
        // scroll the page or open the parent thread
        if (event.target instanceof HTMLElement && event.target.closest('a, button') !== null) {
          return
        }
        event.preventDefault()
        return
      }

      if (key === 'ArrowDown' || key === 'j') {
        const first = replyRefs.current[0]
        if (first === null || first === undefined) return
        event.preventDefault()
        first.focus()
        return
      }

      if (key === 'k') return

      const target =
        key === 'End' ? replyRefs.current[replyRefs.current.length - 1] : replyRefs.current[0]
      if (target === null || target === undefined) return
      event.preventDefault()
      target.focus()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [focusedReply, replies, navigate, focusPost])

  // p jumps to the thread of the parent post (the focused reply's parent, or
  // the focus post's parent). Escape or left leaves the thread outright; up
  // walks to a parent reply and is swallowed at the focus post.
  useEffect(() => {
    const handleParentKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      if (event.shiftKey || event.repeat) return
      if (event.key !== 'p') return
      if (interactiveOutsideThread(event.target)) return
      if (isEditableTarget(event.target)) return
      if (document.querySelector('dialog[open]') !== null) return
      if (uiOwnsKeyboard()) return
      const parentUri = threadParentTarget(focusPost, focusedReplyPost)
      if (parentUri === null) return
      event.preventDefault()
      navigate(`/thread?uri=${encodeURIComponent(parentUri)}`)
    }

    window.addEventListener('keydown', handleParentKey)
    return () => {
      window.removeEventListener('keydown', handleParentKey)
    }
  }, [focusPost, focusedReplyPost, navigate])

  useEffect(() => {
    const handleReplyNumber = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      if (event.shiftKey || event.repeat) return
      if (!/^[1-9]$/.test(event.key)) return
      if (interactiveOutsideThread(event.target)) return
      if (isEditableTarget(event.target)) return
      if (event.target instanceof HTMLElement && event.target.closest('a, button') !== null) return
      if (document.querySelector('dialog[open]') !== null) return
      if (uiOwnsKeyboard()) return
      const thread = document.querySelector('.b-thread')
      const active = document.activeElement
      if (
        active !== document.body &&
        (!(active instanceof HTMLElement) || thread === null || !thread.contains(active))
      ) {
        return
      }
      const reply = replyRefs.current[Number(event.key) - 1]
      if (reply === null || reply === undefined) return
      event.preventDefault()
      reply.focus()
    }

    window.addEventListener('keydown', handleReplyNumber)
    return () => {
      window.removeEventListener('keydown', handleReplyNumber)
    }
  }, [replies.length])

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
    if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowLeft') {
      if (event.repeat) return
      event.preventDefault()
      goBackOrFallback(navigate, THREAD_FALLBACK_VIEW)
      return
    }
    if (event.key === 'ArrowDown') {
      const next = replyRefs.current[index + 1]
      if (next === null || next === undefined) return
      event.preventDefault()
      next.focus()
      return
    }
    if (event.key === 'ArrowUp') {
      const parent = parentTargetOf(index)
      if (parent === null) return
      event.preventDefault()
      if (parent === 'focus') mainRef.current?.focus()
      else replyRefs.current[parent]?.focus()
      return
    }
    if (event.key === 'j') {
      event.preventDefault()
      focusNextReply(index)
      return
    }
    if (event.key === 'k') {
      event.preventDefault()
      focusPreviousReply(index)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const last = replyRefs.current.length - 1
      replyRefs.current[event.key === 'Home' ? 0 : last]?.focus()
      return
    }
    // enter is the only activation key; space keeps its native page scroll
    if (event.key !== 'Enter') return
    if (event.target instanceof HTMLElement && event.target.closest('a, button') !== null) return
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
              if (
                event.target instanceof HTMLElement &&
                event.target.closest('a, button') !== null
              ) {
                return
              }
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

  const parentUri = focusPost?.replyParent?.uri ?? null
  const parentContext = focusPost?.replyContext ?? null
  const dockRequest =
    inlineCompose !== null &&
    focusPost !== null &&
    inlineCompose.post !== null &&
    inlineCompose.mode !== 'post' &&
    inlineCompose.post.uri === focusPost.uri
      ? inlineCompose
      : null
  useEffect(() => {
    if (dockRequest === null) return
    // the suggestion list and the dock consume their own Escape; an unclaimed
    // Escape anywhere else closes the dock instead of navigating away
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      // an IME owns the key that commits its composition
      if (isImeComposing(event)) return
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      closeInlineCompose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [dockRequest, closeInlineCompose])

  const composeDock =
    dockRequest !== null && dockRequest.post !== null ? (
      <InlineComposer request={dockRequest} onClose={closeInlineCompose} />
    ) : null
  const replyDock = dockRequest !== null ? composeDock : null
  const stacked = parentUri !== null || composeDock !== null

  return (
    <section className="b-view">
      <h1 className="visually-hidden">thread</h1>
      <div className="b-view__body b-view__body--thread">
        {uri.length === 0 ? (
          <EmptyState title="no thread selected" hint="open a card or paste an at-uri" />
        ) : shownInfo !== null ? (
          <ErrorNotice
            title={shownInfo.title}
            message={shownInfo.detail}
            onRetry={retryThread}
            retrying={thread.isFetching}
          />
        ) : focusPost === null ? (
          thread.isPending ? (
            <Frame label="thread" meta="loading">
              <Progress label="loading replies" indeterminate />
            </Frame>
          ) : (
            <EmptyState title="empty thread" hint="the appview returned no posts" />
          )
        ) : (
          <div
            ref={mainRef}
            className={stacked ? 'b-thread b-thread--stack' : 'b-thread'}
            tabIndex={-1}
            data-compose={dockRequest?.mode}
            onFocusCapture={(event) => {
              if (!(event.target instanceof HTMLElement)) return
              if (event.target.closest('.b-thread__reply') === null) setFocusedReply(null)
            }}
          >
            {parentUri !== null ? (
              <div className="b-thread__parent">
                <span className="b-thread__parent-label">in reply to</span>
                <Link
                  href={`/thread?uri=${encodeURIComponent(parentUri)}`}
                  className="b-thread__parent-link"
                >
                  @{parentContext?.author.handle ?? 'parent post'}
                </Link>
                {parentContext !== null && parentContext.text.length > 0 ? (
                  <FacetText
                    text={parentContext.text}
                    facets={parentContext.facets}
                    className="b-thread__parent-text"
                  />
                ) : null}
              </div>
            ) : null}
            <PostCard
              post={focusPost}
              focused={focusedReply === null}
              replies={thread.isPending && focus === undefined ? loadingReplies : replyList}
            />
            {replyDock}
          </div>
        )}
      </div>
    </section>
  )
}
