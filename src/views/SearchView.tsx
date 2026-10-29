import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { Button, EmptyState, ErrorNotice, Frame, TextInput } from '../components/ui'
import { usePostFeed } from '../hooks/useBskyQueries'
import { useViewerSync } from '../hooks/useViewerSync'
import { capabilitiesFor } from '../lib/appviews'
import { errorInfo } from '../lib/errors'
import { useSettings } from '../lib/store'

export default function SearchView() {
  const [, navigate] = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim()
  const [draft, setDraft] = useState(query)

  useEffect(() => {
    setDraft(query)
  }, [query])

  const appView = useSettings((state) => state.appView)
  const supported = capabilitiesFor(appView).search
  const feed = usePostFeed({ kind: 'search', query: supported ? query : '' })
  const posts = feed.data ?? []
  useViewerSync(posts)
  const info = feed.error !== null ? errorInfo(feed.error) : null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = draft.trim()
    if (next.length > 0) {
      setSearchParams({ q: next }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
  }

  return (
    <section className="b-view">
      <h1 className="visually-hidden">search</h1>
      <div className="b-view__tools">
        <form className="b-view__form" onSubmit={handleSubmit}>
          <TextInput
            label="query"
            placeholder="words, #tag, @handle"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="solid">
            scan
          </Button>
        </form>
      </div>
      <div className="b-view__body">
        {!supported ? (
          <Frame label="search unavailable" tone="accent" className="b-view__warning">
            <p>this appview does not expose search. switch appviews in the top bar.</p>
          </Frame>
        ) : query.length === 0 ? (
          <EmptyState title="quiet band" hint="type a query to scan the network" />
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
            label="search results"
            empty={
              <EmptyState title="no matches" hint="the search returned nothing for this query" />
            }
          />
        )}
      </div>
    </section>
  )
}
