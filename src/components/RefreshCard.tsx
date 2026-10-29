import { Tag } from './ui'

export interface RefreshCardProps {
  index?: number | undefined
  focused?: boolean | undefined
  refreshing?: boolean | undefined
  label?: string
  onRefresh: () => void
}

export function RefreshCard({
  index,
  focused = false,
  refreshing = false,
  label = 'refresh feed',
  onRefresh,
}: RefreshCardProps) {
  const classes = ['b-frame', 'b-post-card', 'b-refresh-card']
  if (focused) classes.push('b-post-card--focused')

  return (
    <article className={classes.join(' ')} aria-label={label}>
      <header className="b-frame__head b-post-card__head">
        <span className="b-post-card__head-left">
          {index !== undefined ? (
            <span className="b-post-card__index">
              [{String(Math.max(0, index)).padStart(2, '0')}]
            </span>
          ) : null}
          <Tag tone="accent">action</Tag>
        </span>
        <span className="b-post-card__head-right mono-label">enter</span>
      </header>

      <div className="b-frame__body b-post-card__body">
        <div className="b-post-card__author">
          <span className="b-post-card__avatar b-refresh-card__mark" aria-hidden="true">
            ↻
          </span>
          <span className="b-post-card__identity">
            <span className="b-post-card__name">refresh</span>
            <span className="b-post-card__handle">first page</span>
          </span>
        </div>
        <p className="b-post-card__text">
          {refreshing ? 'refreshing the deck' : 'reload this deck from the first page'}
        </p>
      </div>

      <footer className="b-post-card__foot">
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
    </article>
  )
}
