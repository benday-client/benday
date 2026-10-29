import { useLocation, useSearchParams } from 'wouter'
import { Deck } from '../components/Deck'
import { PostCard } from '../components/PostCard'
import { EmptyState, ErrorNotice } from '../components/ui'
import { useThread } from '../hooks/useBskyQueries'
import { errorInfo } from '../lib/errors'
import type { ThreadEntry } from '../lib/types'

function entryEyebrow(entry: ThreadEntry): string {
  if (entry.role === 'focus') return 'focus'
  return `${entry.role} ${Math.abs(entry.depth)}`
}

export default function ThreadView() {
  const [, navigate] = useLocation()
  const [searchParams] = useSearchParams()
  const uri = (searchParams.get('uri') ?? '').trim()
  const thread = useThread(uri)
  const entries = thread.data?.entries ?? []
  const focusIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.role === 'focus'),
  )
  const info = thread.error !== null ? errorInfo(thread.error) : null

  return (
    <section className="b-view">
      <header className="b-view__head">
        <div className="b-view__heading">
          <p className="b-view__kicker mono-label">{'view // thread'}</p>
          <h1 className="b-view__title">thread</h1>
        </div>
        <p className="b-view__meta">{`${entries.length} cards`}</p>
      </header>
      <div className="b-view__body">
        {uri.length === 0 ? (
          <EmptyState title="no thread selected" hint="open a card or paste an at-uri" />
        ) : info !== null ? (
          <ErrorNotice title={info.title} message={info.detail} onRetry={thread.retry} />
        ) : (
          <Deck
            items={entries}
            getKey={(entry) => entry.post.uri}
            renderItem={(entry, index, focused) => (
              <PostCard
                post={entry.post}
                index={index}
                focused={focused}
                eyebrow={entryEyebrow(entry)}
              />
            )}
            onActivate={(entry) => navigate(`/thread?uri=${encodeURIComponent(entry.post.uri)}`)}
            pending={thread.isPending}
            label="thread cards"
            initialIndex={focusIndex}
            empty={<EmptyState title="empty thread" hint="the appview returned no posts" />}
          />
        )}
      </div>
    </section>
  )
}
