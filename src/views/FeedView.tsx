import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { Button, Dialog, EmptyState, ErrorNotice, Frame, TextInput } from '../components/ui'
import { usePostFeed } from '../hooks/useBskyQueries'
import { usePinnedFeeds } from '../hooks/usePinnedFeeds'
import { useViewerSync } from '../hooks/useViewerSync'
import { capabilitiesFor } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { errorInfo } from '../lib/errors'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'

export default function FeedView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const [draft, setDraft] = useState(uri)
  const addOpen = useUiStore((state) => state.dialog === 'feed-add')
  const authenticated = useAuthStore((state) => state.status === 'authenticated')
  const openDialog = useUiStore((state) => state.openDialog)
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
  const showingCustom = authenticated && uri.length > 0
  const source = showingCustom ? ({ kind: 'feed', uri } as const) : ({ kind: 'discover' } as const)
  const feed = usePostFeed(source)
  const posts = feed.data ?? []
  useViewerSync(posts)
  const info = feed.error !== null ? errorInfo(feed.error) : null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = draft.trim()
    if (next.length > 0) {
      setSearchParams({ uri: next }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
    closeDialog()
  }

  return (
    <section className="b-view">
      <h1 className="visually-hidden">feeds</h1>
      {authenticated ? (
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
                  data-active={item.uri === uri ? 'true' : 'false'}
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
        {!supported ? (
          <Frame label="feeds unavailable" tone="accent" className="b-view__warning">
            <p>this appview does not expose custom feeds. switch appviews in the top bar.</p>
          </Frame>
        ) : info !== null && posts.length === 0 ? (
          <ErrorNotice title={info.title} message={info.detail} onRetry={feed.retry} />
        ) : (
          <Deck
            items={posts}
            getKey={(post) => post.uri}
            renderItem={(post, index, focused) => (
              <PostCard post={post} index={index} focused={focused} />
            )}
            onActivate={(post) => navigate(`/thread?uri=${encodeURIComponent(post.uri)}`)}
            pending={feed.isPending}
            hasMore={feed.hasMore}
            loadingMore={feed.isLoadingMore}
            onLoadMore={feed.loadMore}
            label={showingCustom ? 'feed cards' : 'discover cards'}
            stateKey={showingCustom ? `feed:${uri}` : 'discover'}
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
