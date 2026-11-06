import { formatAbsoluteTime } from '../lib/time'
import { Avatar } from './Avatar'
import { CardBack, CardBackButton, cardBackIndex, FrameBody, FrameHead } from './ui'

/** One pinned feed: its avatar, name and description, in the account's order. */
export interface FeedChoice {
  key: string
  uri: string
  name: string
  description: string
  avatar: string | null
}

export interface FeedCardProps {
  choice: FeedChoice
  active: boolean
  onSelect: () => void
}

export interface FeedCardBackProps {
  feedName: string
  postIndex: number
  postDate: string
  hint?: string
  /** makes the back's content one native button, leaving its footer outside it */
  onOpen?: (() => void) | undefined
  onRefresh?: (() => void) | undefined
  refreshing?: boolean | undefined
}

/** A peek back that is one whole native button, so it cannot carry a footer. */
export interface FeedCardBackButtonProps {
  feedName: string
  postIndex: number
  postDate: string
  hint?: string
  onOpen: () => void
}

export function FeedCardBack({
  feedName,
  postIndex,
  postDate,
  hint = '← feeds',
  onOpen,
  onRefresh,
  refreshing = false,
}: FeedCardBackProps) {
  return (
    <CardBack
      label="card back"
      index={cardBackIndex(postIndex)}
      title={feedName}
      date={postDate.length > 0 ? formatAbsoluteTime(postDate) : '—'}
      hint={hint}
      ariaHidden={onOpen === undefined && onRefresh === undefined}
      openAction={onOpen === undefined ? undefined : { label: `open ${feedName}`, onClick: onOpen }}
      footer={
        onRefresh === undefined ? undefined : (
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
        )
      }
    />
  )
}

/** The narrow back that returns to the posts deck: one native button. */
export function FeedCardBackButton({
  feedName,
  postIndex,
  postDate,
  hint = '← posts',
  onOpen,
}: FeedCardBackButtonProps) {
  return (
    <CardBackButton
      label="card back"
      index={cardBackIndex(postIndex)}
      title={feedName}
      date={postDate.length > 0 ? formatAbsoluteTime(postDate) : '—'}
      hint={hint}
      ariaLabel={`open ${feedName}`}
      onClick={onOpen}
    />
  )
}

/**
 * One feed choice. The feed's own title is its native open control; clicking
 * the card body anywhere else follows the same destination, and any native
 * control inside the card keeps its own click.
 */
export function FeedCard({ choice, active, onSelect }: FeedCardProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title button owns activation
    <article
      className="b-frame b-feed-card"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      aria-label={`open ${choice.name}`}
      onClick={(event) => {
        // a native control inside the card keeps its own click
        if (event.defaultPrevented) return
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        if (target.closest('a, button, input, select, textarea') !== null) return
        onSelect()
      }}
    >
      <FrameHead className="b-feed-card__head" label="feed" meta={active ? 'active' : 'enter'} />

      <FrameBody className="b-feed-card__body">
        <div className="b-feed-card__identity">
          <span className="b-feed-card__avatar">
            <Avatar src={choice.avatar} alt={`avatar of ${choice.name}`} name={choice.name} />
          </span>
          <span className="b-feed-card__names">
            <button
              type="button"
              className="b-card-back__surface b-feed-card__open"
              onClick={onSelect}
            >
              <span className="b-feed-card__name">{choice.name}</span>
            </button>
          </span>
        </div>

        {choice.description.length > 0 ? (
          <p className="b-feed-card__description">{choice.description}</p>
        ) : null}
      </FrameBody>
    </article>
  )
}
