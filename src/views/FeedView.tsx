import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { Button, EmptyState, ErrorNotice, Frame, TextInput } from '../components/ui'
import { usePostFeed } from '../hooks/useBskyQueries'
import { usePinnedFeeds } from '../hooks/usePinnedFeeds'
import { useViewerSync } from '../hooks/useViewerSync'
import { capabilitiesFor } from '../lib/appviews'
import { errorInfo } from '../lib/errors'
import { useSettings } from '../lib/store'

export default function FeedView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const [draft, setDraft] = useState(uri)

  useEffect(() => {
    setDraft(uri)
  }, [uri])

  const appView = useSettings((state) => state.appView)
  const supported = capabilitiesFor(appView).feeds
  const pinned = usePinnedFeeds()
  const feed = usePostFeed({ kind: 'feed', uri: supported ? uri : '' })
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
  }

  return (
    <section className="b-view">
      <h1 className="visually-hidden">feed</h1>
      <div className="b-view__tools">
        <form className="b-view__form" onSubmit={handleSubmit}>
          <TextInput
            label="feed at-uri"
            placeholder="at://…/app.bsky.feed.generator/…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="solid">
            open
          </Button>
        </form>

        {pinned.feeds.length > 0 || pinned.isPending ? (
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
          </fieldset>
        ) : null}
      </div>
      <div className="b-view__body">
        {!supported ? (
          <Frame label="feeds unavailable" tone="accent" className="b-view__warning">
            <p>this appview does not expose custom feeds. switch appviews in the top bar.</p>
          </Frame>
        ) : uri.length === 0 ? (
          <EmptyState
            title="no feed loaded"
            hint="pick a pinned feed or paste a feed generator at-uri"
          />
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
            label="feed cards"
            stateKey={`feed:${uri}`}
            empty={<EmptyState title="no feed cards" hint="the feed generator returned nothing" />}
          />
        )}
      </div>
    </section>
  )
}
