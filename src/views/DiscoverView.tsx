import { useLocation } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { EmptyState, ErrorNotice } from '../components/ui'
import { usePostFeed } from '../hooks/useBskyQueries'
import { useViewerSync } from '../hooks/useViewerSync'
import { errorInfo } from '../lib/errors'

export default function DiscoverView() {
  const [, navigate] = useLocation()
  const feed = usePostFeed({ kind: 'discover' })
  const posts = feed.data ?? []
  useViewerSync(posts)
  const info = feed.error !== null ? errorInfo(feed.error) : null

  return (
    <section className="b-view">
      <h1 className="visually-hidden">discover</h1>
      <div className="b-view__body">
        {info !== null && posts.length === 0 ? (
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
            label="discover cards"
            empty={<EmptyState title="no signal" hint="the discover feed returned nothing" />}
          />
        )}
      </div>
    </section>
  )
}
