import { FrameBody, FrameHead, Tag } from './ui'

export interface RefreshCardProps {
  index?: number | undefined
  focused?: boolean | undefined
  refreshing?: boolean | undefined
  label?: string
  onRefresh: () => void
}

/**
 * The deck's explicit refresh card. The footer button is the card's control and
 * the body follows the same refresh; the deck activates both with Enter.
 */
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: the deck owns keyboard activation
    <article
      className={classes.join(' ')}
      aria-label={label}
      onClick={(event) => {
        // the footer's own button keeps its click; a refresh in flight rejects both
        if (refreshing || event.defaultPrevented) return
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        if (target.closest('a, button, input, select, textarea') !== null) return
        onRefresh()
      }}
    >
      <FrameHead
        className="b-post-card__head"
        label={
          <>
            {index === undefined ? null : (
              <span className="b-post-card__index">
                [{String(Math.max(0, index)).padStart(2, '0')}]
              </span>
            )}{' '}
            <Tag tone="accent">action</Tag>
          </>
        }
        meta="enter"
      />

      <FrameBody className="b-post-card__body">
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
      </FrameBody>

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
