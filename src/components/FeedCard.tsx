import type { KeyboardEvent } from 'react'
import { useFeedPreview } from '../hooks/useFeedPreview'
import { formatAbsoluteTime } from '../lib/time'
import type { FeedSource } from '../lib/types'
import { DitherImage } from './DitherImage'
import { Tag } from './ui'

export type FeedChoice =
  | {
      kind: 'feed'
      key: string
      uri: string
      name: string
      description: string
      avatar: string | null
      source: FeedSource
    }
  | {
      kind: 'discover'
      key: 'discover'
      name: string
      description: string
      avatar: null
      source: FeedSource
    }
  | {
      kind: 'add'
      key: 'add'
      name: string
      description: string
      avatar: null
      source: null
    }

export interface FeedCardProps {
  choice: FeedChoice
  active: boolean
  focused: boolean
  onSelect: () => void
}

export interface FeedCardBackProps {
  feedName: string
  postIndex: number
  postDate: string
  appview: string
  hint?: string
  onRefresh?: (() => void) | undefined
  refreshing?: boolean | undefined
}

export function FeedCardBack({
  feedName,
  postIndex,
  postDate,
  appview,
  hint = '← feeds',
  onRefresh,
  refreshing = false,
}: FeedCardBackProps) {
  const index = String(Math.max(0, postIndex)).padStart(2, '0')

  return (
    <article
      className="b-frame b-card-back"
      aria-hidden={onRefresh === undefined ? 'true' : undefined}
    >
      <header className="b-frame__head b-card-back__head">
        <span className="b-frame__label mono-label">card back</span>
      </header>
      <div className="b-frame__body b-card-back__body">
        <span className="b-card-back__index">[{index}]</span>
        <span className="b-card-back__feed">{feedName}</span>
        <span className="b-card-back__rule" aria-hidden="true" />
        <span className="b-card-back__date">
          {postDate.length > 0 ? formatAbsoluteTime(postDate) : '—'}
        </span>
        <span className="b-card-back__appview">{appview}</span>
        <span className="b-card-back__hint">{hint}</span>
      </div>
      {onRefresh !== undefined ? (
        <footer className="b-post-card__foot b-card-back__foot">
          <div className="b-post-card__actions">
            <button
              type="button"
              className="b-post-card__action"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'refreshing' : 'refresh'}
            </button>
          </div>
        </footer>
      ) : null}
    </article>
  )
}

function FeedPreview({ source }: { source: FeedSource }) {
  const preview = useFeedPreview(source, true)

  return (
    <section className="b-feed-card__preview" aria-label="recent posts">
      <p className="b-feed-card__preview-label">recent</p>
      {preview.isPending ? (
        <p className="b-feed-card__preview-note">loading skeets</p>
      ) : preview.posts.length === 0 ? (
        <p className="b-feed-card__preview-note">no visible skeets</p>
      ) : (
        <ol className="b-feed-card__preview-list">
          {preview.posts.map((post) => (
            <li key={post.uri} className="b-feed-card__post">
              <span className="b-feed-card__post-author">
                @{post.author.handle.length > 0 ? post.author.handle : 'unknown'}
              </span>
              <span className="b-feed-card__post-text">
                {post.text.length > 0 ? post.text : '[no text]'}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function FeedCard({ choice, active, focused, onSelect }: FeedCardProps) {
  const initial = (choice.name.length > 0 ? choice.name : '?').slice(0, 1).toUpperCase()

  return (
    <article
      className="b-frame b-feed-card"
      data-kind={choice.kind}
      data-active={active ? 'true' : 'false'}
      aria-label={choice.kind === 'add' ? 'add feed' : `open ${choice.name}`}
      onClick={onSelect}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect()
      }}
    >
      <header className="b-frame__head b-feed-card__head">
        <span className="b-frame__label mono-label">
          {choice.kind === 'add' ? 'action' : 'feed'}
        </span>
        <span className="b-frame__meta">{active ? 'active' : 'enter'}</span>
      </header>

      <div className="b-frame__body b-feed-card__body">
        {choice.kind === 'add' ? (
          <div className="b-feed-card__add">
            <span className="b-feed-card__add-mark" aria-hidden="true">
              +
            </span>
            <span className="b-feed-card__add-title">add feed</span>
            <span className="b-feed-card__add-note">open a generator or paste an at-uri</span>
          </div>
        ) : (
          <>
            <div className="b-feed-card__identity">
              <span className="b-feed-card__avatar">
                <DitherImage
                  src={choice.avatar}
                  alt={`avatar of ${choice.name}`}
                  fallback={initial}
                />
              </span>
              <span className="b-feed-card__names">
                <span className="b-feed-card__name">{choice.name}</span>
                <span className="b-feed-card__kind">
                  <Tag tone={active ? 'accent' : 'default'}>
                    {choice.kind === 'discover' ? 'discover' : 'pinned'}
                  </Tag>
                </span>
              </span>
            </div>

            {choice.description.length > 0 ? (
              <p className="b-feed-card__description">{choice.description}</p>
            ) : null}

            {focused ? <FeedPreview source={choice.source} /> : null}
          </>
        )}
      </div>
    </article>
  )
}
