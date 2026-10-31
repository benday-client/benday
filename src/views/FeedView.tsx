import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { FeedCard, FeedCardBack, FeedCardBackButton, type FeedChoice } from '../components/FeedCard'
import { PostCard } from '../components/PostCard'
import { SignedOutCard } from '../components/SignedOutCard'
import {
  Button,
  Dialog,
  EmptyState,
  ErrorNotice,
  Frame,
  Progress,
  TextInput,
} from '../components/ui'
import { useFeedGenerator, usePostFeed } from '../hooks/useBskyQueries'
import { isEditableTarget, isImeComposing } from '../hooks/useHotkeys'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePinnedFeeds } from '../hooks/usePinnedFeeds'
import { useViewerSync } from '../hooks/useViewerSync'
import { type FeedFeedbackEvent, sendFeedFeedback } from '../lib/actions'
import { capabilitiesFor } from '../lib/appviews'
import { DISCOVER_FEED_URI } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { focusDeckAfterSwap } from '../lib/deckFocus'
import { type ErrorInfo, errorInfo } from '../lib/errors'
import { feedbackTargetFor } from '../lib/feedFeedback'
import { chooseFeedUri } from '../lib/feedSelection'
import { bindingFor, characterShortcutAllowed, matchesBinding } from '../lib/keymap'
import { useSettings } from '../lib/store'
import type { PostModel } from '../lib/types'
import { uiOwnsKeyboard, useUiStore } from '../lib/ui'

/** A first-page failure captured across its own retry, so the notice stays put. */
interface FeedFailure {
  key: string
  info: ErrorInfo
}

export default function FeedView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const [draft, setDraft] = useState(uri)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [feedsMode, setFeedsMode] = useState(false)
  const [dealMode, setDealMode] = useState<'posts' | 'feeds' | null>(null)
  const dealTimerRef = useRef<number | null>(null)
  // a press that already asked for a refresh, before react-query has a chance
  // to report the request it started
  const refreshPendingRef = useRef(false)
  const fetchingRef = useRef(false)
  const wide = useMediaQuery('(min-width: 900px)')
  const addOpen = useUiStore((state) => state.dialog === 'feed-add')
  const authenticated = useAuthStore((state) => state.status === 'authenticated')
  const viewerDid = useAuthStore((state) => state.account?.did ?? null)
  const openDialog = useUiStore((state) => state.openDialog)
  const openPost = useUiStore((state) => state.openPost)
  const openThread = (post: PostModel) => {
    openPost(post)
    navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)
  }
  const closeDialog = useUiStore((state) => state.closeDialog)

  const viewRef = useRef<HTMLElement | null>(null)
  const swapFocusRef = useRef<(() => void) | null>(null)
  // the deck that replaced the one we were on owns the keyboard next
  const focusDeck = () => {
    swapFocusRef.current?.()
    swapFocusRef.current = focusDeckAfterSwap(viewRef.current)
  }

  useEffect(() => {
    setDraft(uri)
  }, [uri])

  useEffect(() => {
    return () => {
      swapFocusRef.current?.()
      if (dealTimerRef.current !== null) window.clearTimeout(dealTimerRef.current)
      if (useUiStore.getState().dialog === 'feed-add') closeDialog()
    }
  }, [closeDialog])

  const appView = useSettings((state) => state.appView)
  const supported = capabilitiesFor(appView).feeds
  const pinned = usePinnedFeeds()
  const activeUri = chooseFeedUri(uri, authenticated, pinned.feeds)
  const showingCustom = activeUri.length > 0
  // a failed preference read is not an empty preference list: while the pinned
  // set is unresolved the feed choice is unknown, so nothing is fetched
  const [pinnedFailure, setPinnedFailure] = useState<Error | null>(null)
  const pinnedFailureShown = pinned.error ?? (pinned.isPending ? pinnedFailure : null)
  const pinnedUnresolved =
    authenticated && uri.length === 0 && (pinned.isPending || pinned.error !== null)
  // the first load shows labelled progress; a failure keeps the deck mounted
  // with its own error so the switcher, peeks and retry stay reachable
  const pinnedFirstLoad = pinnedUnresolved && pinnedFailureShown === null
  const pinnedBlocked = pinnedUnresolved && pinnedFailureShown !== null
  const source = showingCustom
    ? ({ kind: 'feed', uri: activeUri } as const)
    : ({ kind: 'discover' } as const)
  const feed = usePostFeed(source, !pinnedUnresolved)
  const feedKey = JSON.stringify([appView.host, viewerDid ?? 'anonymous', activeUri || 'discover'])
  const [feedFailure, setFeedFailure] = useState<FeedFailure | null>(null)
  // Refresh is a read, so one explicit press is enough. It drops the loaded
  // pages and reloads exactly the first one; a press while that is already in
  // flight has nothing to add, and nothing else refreshes implicitly.
  const refreshFeed = useCallback(() => {
    if (pinnedUnresolved) return
    if (refreshPendingRef.current || fetchingRef.current) return
    refreshPendingRef.current = true
    // an explicit refresh starts a clean deck, including rows dismissed locally
    setDismissed(new Set())
    feed.retry()
  }, [feed.retry, pinnedUnresolved])
  useEffect(() => {
    fetchingRef.current = feed.isFetching
    if (!feed.isFetching) refreshPendingRef.current = false
  }, [feed.isFetching])
  const fetchedPosts = feed.data ?? []
  const posts = pinnedUnresolved ? [] : fetchedPosts
  const visiblePosts = posts.filter((post) => !dismissed.has(post.uri))
  // feedback reaches the feed generator service that served the cards. the
  // discover generator's view names its service did; a pinned feed carries it
  // from its own generator metadata. no did means no service to address.
  const discoverGenerator = useFeedGenerator(source.kind === 'discover' ? DISCOVER_FEED_URI : '')
  const feedbackTarget = feedbackTargetFor(source, pinned.feeds, discoverGenerator)
  useViewerSync(posts)
  const info = pinnedUnresolved || feed.error === null ? null : errorInfo(feed.error)
  // a retry drops the failed page before its replacement arrives, so the shown
  // failure is captured while that same request has nothing else to report
  const capturedFailure =
    feedFailure !== null && feedFailure.key === feedKey && posts.length === 0 && feed.isFetching
      ? feedFailure.info
      : null
  const shownInfo = info ?? capturedFailure
  const retryFeed = () => {
    if (info !== null) setFeedFailure({ key: feedKey, info })
    refreshFeed()
  }
  const retryPinned = () => {
    pinned.reload()
  }
  const feedHasData = feed.data !== null
  useEffect(() => {
    if (feedHasData && !pinnedUnresolved) setFeedFailure(null)
  }, [feedHasData, pinnedUnresolved])
  // a shown failure stays visible through an automatic reread too
  useEffect(() => {
    if (pinned.error !== null) setPinnedFailure(pinned.error)
  }, [pinned.error])
  useEffect(() => {
    if (!pinned.isPending && pinned.error === null) setPinnedFailure(null)
  }, [pinned.isPending, pinned.error])

  useEffect(() => {
    setDismissed(new Set())
    setFeedFailure(null)
    setPinnedFailure(null)
    refreshPendingRef.current = false
  }, [activeUri, appView.host, viewerDid])

  const dismissPost = (postUri: string) => {
    setDismissed((current) => {
      if (current.has(postUri)) return current
      const next = new Set(current)
      next.add(postUri)
      return next
    })
  }

  const canPickFeeds = authenticated && wide && supported
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
      if (showingFeeds || pinnedUnresolved) return
      event.preventDefault()
      refreshFeed()
    }

    window.addEventListener('keydown', handleRefreshKey)
    return () => {
      window.removeEventListener('keydown', handleRefreshKey)
    }
  }, [refreshBinding, refreshFeed, showingFeeds, pinnedUnresolved])

  useEffect(() => {
    if (!canPickFeeds) setFeedsMode(false)
  }, [canPickFeeds])

  const feedChoices: FeedChoice[] = []
  // a failed preference read must not read as an empty preference list
  if (authenticated && !pinned.isPending && pinned.error === null) {
    if (pinned.feeds.length > 0) {
      for (const item of pinned.feeds) {
        feedChoices.push({
          kind: 'feed',
          key: item.uri,
          uri: item.uri,
          name: item.name,
          description: item.description,
          avatar: item.avatar,
          source: { kind: 'feed', uri: item.uri },
        })
      }
    } else {
      feedChoices.push({
        kind: 'discover',
        key: 'discover',
        name: 'discover',
        description: 'what is hot across bluesky',
        avatar: null,
        source: { kind: 'discover' },
      })
    }
    feedChoices.push({
      kind: 'add',
      key: 'add',
      name: 'add feed',
      description: 'open a generator or paste an at-uri',
      avatar: null,
      source: null,
    })
  }

  const activeFeedIndex = feedChoices.findIndex((choice) => {
    if (choice.kind === 'feed') return choice.uri === activeUri
    if (choice.kind === 'discover') return activeUri.length === 0
    return false
  })
  const activeFeedName =
    activeFeedIndex >= 0
      ? (feedChoices[activeFeedIndex]?.name ?? 'feed')
      : activeUri.length > 0
        ? (activeUri.split('/').at(-1) ?? 'custom feed')
        : 'discover'

  const playDeal = (mode: 'posts' | 'feeds') => {
    setDealMode(mode)
    if (dealTimerRef.current !== null) window.clearTimeout(dealTimerRef.current)
    dealTimerRef.current = window.setTimeout(() => {
      setDealMode(null)
      dealTimerRef.current = null
    }, 900)
  }

  const switchMode = (next: boolean) => {
    setFeedsMode(next)
    playDeal(next ? 'feeds' : 'posts')
    focusDeck()
  }

  const selectFeed = (choice: FeedChoice) => {
    if (choice.kind === 'add') {
      setDraft('')
      openDialog('feed-add')
      return
    }
    if (choice.kind === 'discover') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ uri: choice.uri }, { replace: true })
    }
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = draft.trim()
    // a blank is not a feed: the dialog stays open and the url is untouched
    if (next.length === 0) return
    setSearchParams({ uri: next }, { replace: true })
    if (feedsMode) {
      switchMode(false)
    } else {
      setFeedsMode(false)
      focusDeck()
    }
    closeDialog()
  }

  return (
    <section className="b-view" ref={viewRef}>
      <h1 className="visually-hidden">feeds</h1>
      {authenticated && !wide ? (
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
            <button
              type="button"
              className="b-pinned-add"
              onClick={() => {
                setDraft('')
                openDialog('feed-add')
              }}
            >
              + add
            </button>
          </fieldset>
          <button
            type="button"
            className="b-pinned-add b-view__refresh"
            onClick={refreshFeed}
            disabled={feed.isFetching || pinnedUnresolved}
            aria-label="refresh feed"
          >
            {feed.isFetching ? 'refreshing' : 'refresh'}
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
              renderItem={(choice, _index, focused) => (
                <FeedCard
                  choice={choice}
                  active={
                    choice.kind === 'feed'
                      ? choice.uri === activeUri
                      : choice.kind === 'discover'
                        ? activeUri.length === 0
                        : false
                  }
                  focused={focused}
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
                  appview={appView.label}
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
                    hint="add a feed to get started"
                    action={
                      <Button
                        variant="ghost"
                        onClick={() => {
                          openDialog('feed-add')
                        }}
                      >
                        add a feed
                      </Button>
                    }
                  />
                )
              }
            />
          </div>
        ) : authenticated && !supported ? (
          <Frame label="feeds unavailable" tone="accent" className="b-view__warning">
            <p>this appview does not expose custom feeds. switch appviews in the top bar.</p>
          </Frame>
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
                  onOpen={() => {
                    openThread(post)
                  }}
                  {...(feedbackTarget !== null
                    ? {
                        onFeedback: (event: FeedFeedbackEvent) =>
                          sendFeedFeedback(
                            feedbackTarget.feed,
                            feedbackTarget.generatorDid,
                            post,
                            event,
                          ),
                        onDismiss: () => {
                          dismissPost(post.uri)
                        },
                      }
                    : {})}
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
                : !authenticated
                  ? {
                      onExitStart: () => {
                        openDialog('login')
                      },
                    }
                  : {})}
              leadingPeekInteractive={canPickFeeds || !authenticated}
              leadingPeek={
                canPickFeeds ? (
                  <FeedCardBack
                    feedName={activeFeedName}
                    postIndex={0}
                    postDate={posts[0]?.indexedAt ?? ''}
                    appview={appView.label}
                    onOpen={() => {
                      switchMode(true)
                    }}
                    onRefresh={pinnedUnresolved ? undefined : refreshFeed}
                    refreshing={feed.isFetching}
                  />
                ) : !authenticated ? (
                  <SignedOutCard
                    onSignIn={() => {
                      openDialog('login')
                    }}
                  />
                ) : undefined
              }
              pending={feed.isPending && shownInfo === null}
              hasMore={feed.hasMore}
              loadingMore={feed.isLoadingMore}
              loadMoreError={feed.loadMoreError}
              onLoadMore={feed.loadMore}
              onRetryLoadMore={feed.retryLoadMore}
              label={showingCustom || pinnedUnresolved ? 'feed cards' : 'discover cards'}
              {...(pinnedUnresolved
                ? {}
                : {
                    stateKey: JSON.stringify([
                      appView.host,
                      viewerDid ?? 'anonymous',
                      activeUri || 'discover',
                    ]),
                  })}
              empty={
                pinnedBlocked && pinnedFailureShown !== null ? (
                  <ErrorNotice
                    title="could not load pinned feeds"
                    message={pinnedFailureShown.message}
                    onRetry={retryPinned}
                    retrying={pinned.isPending}
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
                    title={showingCustom ? 'no feed cards' : 'no signal'}
                    hint={
                      showingCustom
                        ? 'the feed generator returned nothing'
                        : 'the discover feed returned nothing'
                    }
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

      <Dialog open={addOpen} title="add feed" onClose={closeDialog} className="b-feed-dialog">
        <form className="b-feed-add" onSubmit={handleSubmit}>
          <TextInput
            label="feed at-uri"
            placeholder="at://…/app.bsky.feed.generator/…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <div className="b-feed-add__actions">
            <Button variant="ghost" type="button" onClick={closeDialog}>
              cancel
            </Button>
            <Button type="submit" variant="solid" disabled={draft.trim().length === 0}>
              open feed
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}
