import { Link, useSearchParams } from 'wouter'
import { FacetText } from '../components/FacetText'
import { PostCard } from '../components/PostCard'
import { RelativeTime } from '../components/RelativeTime'
import { EmptyState, ErrorNotice, Frame, Progress } from '../components/ui'
import { useThread } from '../hooks/useBskyQueries'
import { useViewerSync } from '../hooks/useViewerSync'
import { errorInfo } from '../lib/errors'
import type { ThreadEntry } from '../lib/types'

function replyHandle(entry: ThreadEntry): string {
  return entry.post.author.handle.length > 0 ? entry.post.author.handle : 'unknown'
}

export default function ThreadView() {
  const [searchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const thread = useThread(uri)
  const entries = thread.data?.entries ?? []
  const focus = entries.find((entry) => entry.role === 'focus')
  const replies = entries.filter((entry) => entry.role === 'reply')
  useViewerSync(entries.map((entry) => entry.post))
  const info = thread.error !== null ? errorInfo(thread.error) : null

  const replyList = (
    <div className="b-thread__replies">
      <p className="b-thread__replies-label">replies</p>
      {replies.length === 0 ? (
        <p className="b-thread__replies-empty">no replies yet</p>
      ) : (
        replies.map((entry) => (
          <article
            key={entry.post.uri}
            className="b-thread__reply"
            data-depth={Math.min(entry.depth, 4)}
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
        ) : thread.isPending && focus === undefined ? (
          <Frame label="thread" meta="loading">
            <p className="mono-label">loading replies</p>
            <Progress indeterminate />
          </Frame>
        ) : focus === undefined ? (
          <EmptyState title="empty thread" hint="the appview returned no posts" />
        ) : (
          <div className="b-thread">
            <PostCard post={focus.post} focused replies={replyList} />
          </div>
        )}
      </div>
    </section>
  )
}
