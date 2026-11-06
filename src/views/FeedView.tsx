import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { FeedCard, FeedCardBack, FeedCardBackButton, type FeedChoice } from '../components/FeedCard'
import { PostCard } from '../components/PostCard'
import { Button, EmptyState, ErrorNotice, Frame, Progress } from '../components/ui'
import { usePostFeed } from '../hooks/useBskyQueries'
import { useDealFlash } from '../hooks/useDealFlash'
import { isEditableTarget, isImeComposing } from '../hooks/useHotkeys'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePinnedFeeds } from '../hooks/usePinnedFeeds'
import { useRetainedError } from '../hooks/useRetainedError'
import { useViewerSync } from '../hooks/useViewerSync'
import { type FeedFeedbackEvent, sendFeedFeedback } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { focusDeckAfterSwap } from '../lib/deckFocus'
import { errorInfo } from '../lib/errors'
import { feedbackTargetFor } from '../lib/feedFeedback'
import { chooseFeedUri } from '../lib/feedSelection'
import { bindingFor, characterShortcutAllowed, matchesBinding } from '../lib/keymap'
import { useSettings } from '../lib/store'
import type { PostModel } from '../lib/types'
import { uiOwnsKeyboard, useUiStore } from '../lib/ui'

/** how long a first refresh press waits for its confirming second press */
const REFRESH_ARM_MS = 5000

export default function FeedView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [feedsMode, setFeedsMode] = useState(false)
  const [dealMode, playDeal] = useDealFlash<'posts' | 'feeds'>()
  const [armed, setArmed] = useState(false)
  // a press that already asked for a refresh, before react-query has a chance
  // to report the request it started
  const refreshPendingRef = useRef(false)
  const fetchingRef = useRef(false)
  const armTimerRef = useRef<number | null>(null)
  const wide = useMediaQuery('(min-width: 900px)')
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const openPost = useUiStore((state) => state.openPost)
  const openThread = useCallback(
    (post: PostModel) => {
      openPost(post)
      navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)
    },
    [navigate, openPost],
  )

  const viewRef = useRef<HTMLElement | null>(null)
  const swapFocusRef = useRef<(() => void) | null>(null)
  // the deck that replaced the one we were on owns the keyboard next
  const focusDeck = () => {
    swapFocusRef.current?.()
    swapFocusRef.current = focusDeckAfterSwap(viewRef.current)
  }

  useEffect(() => {
    return () => {
      swapFocusRef.current?.()
    }
  }, [])

  const pinned = usePinnedFeeds()
  const activeUri = chooseFeedUri(uri, pinned.feeds)
  // a failed preference read is not an empty preference list: while the pinned
  // set is unresolved the feed choice is unknown, so nothing is fetched
  const [pinnedFailure, setPinnedFailure] = useState<Error | null>(null)
  const pinnedFailureShown = pinned.error ?? (pinned.isPending ? pinnedFailure : null)
  const pinnedUnresolved = activeUri.length === 0 && (pinned.isPending || pinned.error !== null)
  // the first load shows labelled progress; a failure keeps the deck mounted
  // with its own error so the switcher, peeks and retry stay reachable
  const pinnedFirstLoad = pinnedUnresolved && pinnedFailureShown === null
  const pinnedBlocked = pinnedUnresolved && pinnedFailureShown !== null
  const source = activeUri.length > 0 ? ({ kind: 'feed', uri: activeUri } as const) : null
  const feed = usePostFeed(source)
  const feedKey = JSON.stringify([viewerDid ?? 'anonymous', activeUri])

  const clearArm = useCallback(() => {
    if (armTimerRef.current !== null) {
      window.clearTimeout(armTimerRef.current)
      armTimerRef.current = null
    }
    setArmed(false)
  }, [])

  // Refresh is a read, so a confirmed press is enough. It drops the loaded
  // pages and reloads exactly the first one; nothing refreshes implicitly.
  const refreshFeed = useCallback(() => {
    if (pinnedUnresolved) return
    clearArm()
    refreshPendingRef.current = true
    // an explicit refresh starts a clean deck, including rows dismissed locally
    setDismissed(new Set())
    feed.retry()
  }, [clearArm, feed.retry, pinnedUnresolved])

  // The first press arms for five seconds; the second inside that window is the
  // confirmation. A fetch already in flight has nothing to confirm.
  const armRefresh = useCallback(() => {
    if (pinnedUnresolved) return
    if (refreshPendingRef.current || fetchingRef.current) return
    if (armed) {
      refreshFeed()
      return
    }
    setArmed(true)
    armTimerRef.current = window.setTimeout(() => {
      armTimerRef.current = null
      setArmed(false)
    }, REFRESH_ARM_MS)
  }, [armed, pinnedUnresolved, refreshFeed])

  useEffect(() => {
    fetchingRef.current = feed.isFetching
    if (!feed.isFetching) refreshPendingRef.current = false
  }, [feed.isFetching])

  // leaving the view cancels a pending confirmation
  useEffect(() => {
    return () => {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    }
  }, [])

  const fetchedPosts = feed.data ?? []
  const posts = pinnedUnresolved ? [] : fetchedPosts
  const visiblePosts = posts.filter((post) => !dismissed.has(post.uri))
  // feedback reaches the generator service that served a pinned feed. no did
  // means no service to address, so the card offers no feedback at all.
  const feedbackTarget = feedbackTargetFor(source, pinned.feeds)
  const feedbackFeed = feedbackTarget?.feed ?? null
  const feedbackDid = feedbackTarget?.generatorDid ?? null
  // memoized by the target values, so an unchanged card keeps the same callback
  // and PostCard.memo skips it on every deck move
  const sendFeedback = useMemo(
    () =>
      feedbackFeed === null || feedbackDid === null
        ? null
        : async (post: PostModel, event: FeedFeedbackEvent) => {
            await sendFeedFeedback(feedbackFeed, feedbackDid, post, event)
          },
    [feedbackFeed, feedbackDid],
  )
  useViewerSync(posts)
  // a retry drops the failed page before its replacement arrives, so the shown
  // failure is captured while that same request has nothing else to report
  const feedFailure = useRetainedError(
    feedKey,
    posts.length > 0,
    feed.error ?? null,
    feed.isFetching,
  )
  const info = pinnedUnresolved || feed.error === null ? null : errorInfo(feed.error)
  const shownInfo = info ?? (feedFailure.error === null ? null : errorInfo(feedFailure.error))
  const retryFeed = () => {
    feedFailure.retry(refreshFeed)
  }
  const retryPinned = () => {
    pinned.reload()
  }
  // a shown failure stays visible through an automatic reread too
  useEffect(() => {
    if (pinned.error !== null) setPinnedFailure(pinned.error)
  }, [pinned.error])
  useEffect(() => {
    if (!pinned.isPending && pinned.error === null) setPinnedFailure(null)
  }, [pinned.isPending, pinned.error])

  useEffect(() => {
    setDismissed(new Set())
    setPinnedFailure(null)
    refreshPendingRef.current = false
    clearArm()
  }, [activeUri, viewerDid, clearArm])

  const dismissPost = useCallback((postUri: string) => {
    setDismissed((current) => {
      if (current.has(postUri)) return current
      const next = new Set(current)
      next.add(postUri)
      return next
    })
  }, [])

  const canPickFeeds = wide
  const showingFeeds = feedsMode && canPickFeeds

  const refreshBinding = bindingFor('refresh')

  useEffect(() => {
    const handleRefreshKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      // an IME owns the key that commits its composition
      if (isImeComposing(event)) return
      if (!matchesBinding(event, refreshBinding)) return
      // a bare character only acts while the character preference is on
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      // a dialog, the composer or the inline dock owns the keyboard
      if (uiOwnsKeyboard()) return
      // a text field or a control owns its own keys
      if (isEditableTarget(event.target)) return
      if (event.target instanceof HTMLElement && event.target.closest('a, button') !== null) {
        return
      }
      if (document.querySelector('dialog[open]') !== null) return
      if (showingFeeds) return
      event.preventDefault()
      armRefresh()
    }

    window.addEventListener('keydown', handleRefreshKey)
    return () => {
      window.removeEventListener('keydown', handleRefreshKey)
    }
  }, [refreshBinding, armRefresh, showingFeeds])

  // an armed confirmation owns Escape so it cancels instead of leaving the feed
  useEffect(() => {
    if (!armed) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      event.preventDefault()
      clearArm()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [armed, clearArm])

  useEffect(() => {
    if (!canPickFeeds) setFeedsMode(false)
  }, [canPickFeeds])

  const feedChoices: FeedChoice[] = []
  // a failed preference read must not read as an empty preference list
  if (!pinned.isPending && pinned.error === null) {
    for (const item of pinned.feeds) {
      feedChoices.push({
        key: item.uri,
        uri: item.uri,
        name: item.name,
        description: item.description,
        avatar: item.avatar,
      })
    }
  }

  const activeFeedIndex = feedChoices.findIndex((choice) => choice.uri === activeUri)
  const activeFeedName =
    activeFeedIndex >= 0
      ? (feedChoices[activeFeedIndex]?.name ?? 'feed')
      : activeUri.length > 0
        ? (activeUri.split('/').at(-1) ?? 'feed')
        : 'feed'

  const switchMode = (next: boolean) => {
    setFeedsMode(next)
    playDeal(next ? 'feeds' : 'posts')
    focusDeck()
  }

  const selectFeed = (choice: FeedChoice) => {
    setSearchParams({ uri: choice.uri }, { replace: true })
    switchMode(false)
  }

  const selectPinned = (next: string) => {
    setSearchParams({ uri: next }, { replace: true })
    focusDeck()
  }

  useEffect(() => {
    if (!showingFeeds) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      if (uiOwnsKeyboard()) return
      // an open native modal keeps Escape for itself
      if (document.querySelector('dialog[open]') !== null) return
      event.preventDefault()
      switchMode(false)
    }

    // capture phase so the feed switcher closes before the app's bubble-phase
    // Escape handling can leave the feed
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [showingFeeds])

  const noFeeds = pinned.error === null && !pinned.isPending && feedChoices.length === 0

  return (
    <section className="b-view" ref={viewRef}>
      <h1 className="visually-hidden">feeds</h1>
      {armed ? (
        <p className="b-view__refresh-note" role="status">
          press R again to refresh
        </p>
      ) : null}
      {!wide ? (
        <div className="b-view__tools b-view__tools--feed">
          <fieldset className="b-view__pinned">
            <legend className="mono-label">pinned</legend>
            {pinned.isPending ? (
              <span className="b-view__pinned-note">loading</span>
            ) : pinned.error !== null ? (
              <button type="button" className="b-pinned-add" onClick={retryPinned}>
                retry pinned
              </button>
            ) : (
              pinned.feeds.map((item) => (
                <button
                  key={item.uri}
                  type="button"
                  className="b-pinned-feed"
                  data-active={item.uri === activeUri ? 'true' : 'false'}
                  aria-pressed={item.uri === activeUri}
                  onClick={() => {
                    selectPinned(item.uri)
                  }}
                >
                  {item.name}
                </button>
              ))
            )}
          </fieldset>
          <button
            type="button"
            className="b-pinned-add b-view__refresh"
            onClick={armRefresh}
            disabled={feed.isFetching || pinnedUnresolved}
            aria-label="refresh feed"
          >
            {armed ? 'refresh again' : feed.isFetching ? 'refreshing' : 'refresh'}
          </button>
        </div>
      ) : null}
      <div className="b-view__body">
        {showingFeeds ? (
          <div
            className="b-deck-stage b-deck-stage--feeds"
            data-deal={dealMode === 'feeds' ? 'true' : undefined}
          >
            <Deck
              key="feeds-deck"
              items={feedChoices}
              getKey={(choice) => choice.key}
              renderItem={(choice) => (
                <FeedCard
                  choice={choice}
                  active={choice.uri === activeUri}
                  onSelect={() => {
                    selectFeed(choice)
                  }}
                />
              )}
              onActivate={selectFeed}
              onExitStart={() => {
                switchMode(false)
              }}
              leadingPeekInteractive
              leadingPeek={
                <FeedCardBackButton
                  feedName="posts"
                  postIndex={0}
                  postDate={posts[0]?.indexedAt ?? ''}
                  onOpen={() => {
                    switchMode(false)
                  }}
                />
              }
              pending={pinned.isPending && pinnedFailureShown === null}
              initialIndex={Math.max(activeFeedIndex, 0)}
              label="feed cards"
              empty={
                pinnedFailureShown !== null ? (
                  <ErrorNotice
                    title="could not load pinned feeds"
                    message={pinnedFailureShown.message}
                    onRetry={retryPinned}
                    retrying={pinned.isPending}
                  />
                ) : (
                  <EmptyState
                    title="no feeds"
                    hint="pin feeds in the bluesky app and they appear here."
                  />
                )
              }
            />
          </div>
        ) : pinnedFirstLoad ? (
          <Frame label="pinned feeds" meta="loading">
            <Progress label="loading pinned feeds" indeterminate />
          </Frame>
        ) : (
          <div
            className="b-deck-stage b-deck-stage--posts"
            data-deal={dealMode === 'posts' ? 'true' : undefined}
          >
            <Deck
              key="posts-deck"
              items={visiblePosts}
              getKey={(post) => post.uri}
              renderItem={(post, index, focused) => (
                <PostCard
                  post={post}
                  index={index}
                  focused={focused}
                  onOpen={openThread}
                  onDismiss={dismissPost}
                  {...(sendFeedback !== null ? { onFeedback: sendFeedback } : {})}
                />
              )}
              onActivate={(post) => {
                openThread(post)
              }}
              {...(canPickFeeds
                ? {
                    onExitStart: () => {
                      switchMode(true)
                    },
                  }
                : {})}
              leadingPeekInteractive={canPickFeeds}
              leadingPeek={
                canPickFeeds ? (
                  <FeedCardBack
                    feedName={activeFeedName}
                    postIndex={0}
                    postDate={posts[0]?.indexedAt ?? ''}
                    onOpen={() => {
                      switchMode(true)
                    }}
                    onRefresh={pinnedUnresolved ? undefined : armRefresh}
                    refreshing={feed.isFetching}
                  />
                ) : undefined
              }
              pending={feed.isPending && shownInfo === null}
              hasMore={feed.hasMore}
              loadingMore={feed.isLoadingMore}
              loadMoreError={feed.loadMoreError}
              onLoadMore={feed.loadMore}
              onRetryLoadMore={feed.retryLoadMore}
              label="posts"
              {...(pinnedUnresolved
                ? {}
                : {
                    stateKey: JSON.stringify([viewerDid ?? 'anonymous', activeUri]),
                  })}
              empty={
                pinnedBlocked && pinnedFailureShown !== null ? (
                  <ErrorNotice
                    title="could not load pinned feeds"
                    message={pinnedFailureShown.message}
                    onRetry={retryPinned}
                    retrying={pinned.isPending}
                  />
                ) : noFeeds || pinnedUnresolved ? (
                  <EmptyState
                    title="no feeds"
                    hint="pin feeds in the bluesky app and they appear here."
                  />
                ) : shownInfo !== null ? (
                  <ErrorNotice
                    title={shownInfo.title}
                    message={shownInfo.detail}
                    onRetry={retryFeed}
                    retrying={feed.isFetching}
                  />
                ) : (
                  <EmptyState
                    title="no feed cards"
                    hint="the feed generator returned nothing"
                    action={
                      <Button variant="ghost" onClick={refreshFeed}>
                        reload
                      </Button>
                    }
                  />
                )
              }
            />
          </div>
        )}
      </div>
    </section>
  )
}
