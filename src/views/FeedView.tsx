import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { FeedCard, FeedCardBack, type FeedChoice } from '../components/FeedCard'
import { PostCard } from '../components/PostCard'
import {
  Button,
  Dialog,
  EmptyState,
  ErrorNotice,
  Frame,
  Progress,
  TextInput,
} from '../components/ui'
import { usePostFeed } from '../hooks/useBskyQueries'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePinnedFeeds } from '../hooks/usePinnedFeeds'
import { useViewerSync } from '../hooks/useViewerSync'
import { capabilitiesFor } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { errorInfo } from '../lib/errors'
import { chooseFeedUri } from '../lib/feedSelection'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'

export default function FeedView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const [draft, setDraft] = useState(uri)
  const [feedsMode, setFeedsMode] = useState(false)
  const wide = useMediaQuery('(min-width: 900px)')
  const addOpen = useUiStore((state) => state.dialog === 'feed-add')
  const authenticated = useAuthStore((state) => state.status === 'authenticated')
  const openDialog = useUiStore((state) => state.openDialog)
  const openPost = useUiStore((state) => state.openPost)
  const closeDialog = useUiStore((state) => state.closeDialog)

  useEffect(() => {
    setDraft(uri)
  }, [uri])

  useEffect(() => {
    return () => {
      if (useUiStore.getState().dialog === 'feed-add') closeDialog()
    }
  }, [closeDialog])

  const appView = useSettings((state) => state.appView)
  const supported = capabilitiesFor(appView).feeds
  const pinned = usePinnedFeeds()
  const activeUri = chooseFeedUri(uri, authenticated, pinned.feeds)
  const showingCustom = activeUri.length > 0
  const waitingForPinned = authenticated && uri.length === 0 && pinned.isPending
  const source = showingCustom
    ? ({ kind: 'feed', uri: activeUri } as const)
    : ({ kind: 'discover' } as const)
  const feed = usePostFeed(source, !waitingForPinned)
  const posts = feed.data ?? []
  useViewerSync(posts)
  const info = feed.error !== null ? errorInfo(feed.error) : null

  const canPickFeeds = authenticated && wide && supported
  const showingFeeds = feedsMode && canPickFeeds

  useEffect(() => {
    if (!canPickFeeds) setFeedsMode(false)
  }, [canPickFeeds])

  const feedChoices: FeedChoice[] = []
  if (authenticated && !pinned.isPending) {
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
  const peekChoice =
    activeFeedIndex >= 0
      ? feedChoices[activeFeedIndex]
      : feedChoices.find((choice) => choice.kind !== 'add')
  const activeFeedName =
    activeFeedIndex >= 0
      ? (feedChoices[activeFeedIndex]?.name ?? 'feed')
      : activeUri.length > 0
        ? (activeUri.split('/').at(-1) ?? 'custom feed')
        : 'discover'

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
    setFeedsMode(false)
  }

  useEffect(() => {
    if (!showingFeeds) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return
      const ui = useUiStore.getState()
      if (ui.dialog !== null || ui.compose !== null || ui.themeMenuOpen) return
      event.preventDefault()
      setFeedsMode(false)
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [showingFeeds])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = draft.trim()
    if (next.length > 0) {
      setSearchParams({ uri: next }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
    setFeedsMode(false)
    closeDialog()
  }

  return (
    <section className="b-view">
      <h1 className="visually-hidden">feeds</h1>
      {authenticated && !wide ? (
        <div className="b-view__tools">
          <fieldset className="b-view__pinned">
            <legend className="mono-label">pinned</legend>
            {pinned.isPending ? (
              <span className="b-view__pinned-note">loading</span>
            ) : (
              pinned.feeds.map((item) => (
                <button
                  key={item.uri}
                  type="button"
                  className="b-pinned-feed"
                  data-active={item.uri === activeUri ? 'true' : 'false'}
                  onClick={() => {
                    setSearchParams({ uri: item.uri }, { replace: true })
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
        </div>
      ) : null}
      <div className="b-view__body">
        {showingFeeds ? (
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
              setFeedsMode(false)
            }}
            pending={pinned.isPending}
            initialIndex={Math.max(activeFeedIndex, 0)}
            label="feed cards"
            empty={<EmptyState title="no feeds" hint="add a feed to get started" />}
          />
        ) : authenticated && !supported ? (
          <Frame label="feeds unavailable" tone="accent" className="b-view__warning">
            <p>this appview does not expose custom feeds. switch appviews in the top bar.</p>
          </Frame>
        ) : waitingForPinned ? (
          <Frame label="pinned feeds" meta="loading">
            <p className="mono-label">loading pinned feeds</p>
            <Progress indeterminate />
          </Frame>
        ) : info !== null && posts.length === 0 ? (
          <ErrorNotice title={info.title} message={info.detail} onRetry={feed.retry} />
        ) : (
          <Deck
            key="posts-deck"
            items={posts}
            getKey={(post) => post.uri}
            renderItem={(post, index, focused) => (
              <PostCard post={post} index={index} focused={focused} />
            )}
            onActivate={(post) => {
              openPost(post)
              navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)
            }}
            {...(canPickFeeds
              ? {
                  onExitStart: () => {
                    setFeedsMode(true)
                  },
                }
              : {})}
            leadingPeek={
              canPickFeeds && peekChoice !== undefined ? (
                <FeedCardBack
                  feedName={activeFeedName}
                  postIndex={0}
                  postDate={posts[0]?.indexedAt ?? ''}
                  appview={appView.label}
                />
              ) : undefined
            }
            pending={feed.isPending}
            hasMore={feed.hasMore}
            loadingMore={feed.isLoadingMore}
            loadMoreError={feed.loadMoreError}
            onLoadMore={feed.loadMore}
            onRetryLoadMore={feed.retryLoadMore}
            label={showingCustom ? 'feed cards' : 'discover cards'}
            stateKey={showingCustom ? `feed:${activeUri}` : 'discover'}
            empty={
              <EmptyState
                title={showingCustom ? 'no feed cards' : 'no signal'}
                hint={
                  showingCustom
                    ? 'the feed generator returned nothing'
                    : 'the discover feed returned nothing'
                }
              />
            }
          />
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
            <Button type="submit" variant="solid">
              open feed
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}
