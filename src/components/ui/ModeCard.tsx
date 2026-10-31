import { useId } from 'react'
import { FrameBody, FrameHead } from './Frame'

export interface ModeCardProps {
  label: string
  name: string
  description: string
  active: boolean
  /**
   * Pre-formatted card or result count. `null` hides the line entirely, which
   * is how a consumer says it has no count to show yet.
   */
  countLabel: string | null
  activeHint: string
  onSelect: () => void
}

/**
 * One mode choice inside a deck. Presentation only: the owning view decides
 * which modes exist, what they count and what selecting one does.
 */
export function ModeCard({
  label,
  name,
  description,
  active,
  countLabel,
  activeHint,
  onSelect,
}: ModeCardProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  const countId = `${id}-count`
  const describedBy = countLabel === null ? descriptionId : `${descriptionId} ${countId}`

  return (
    <button
      type="button"
      className="b-frame b-mode-card"
      data-active={active ? 'true' : 'false'}
      aria-label={`show ${name}`}
      aria-pressed={active}
      aria-describedby={describedBy}
      onClick={onSelect}
    >
      <FrameHead label={label} meta={active ? 'active' : 'enter'} />
      <FrameBody className="b-mode-card__body">
        <span className="b-mode-card__title">{name}</span>
        <p className="b-mode-card__description" id={descriptionId}>
          {description}
        </p>
        {countLabel === null ? null : (
          <span className="b-mode-card__count" id={countId}>
            {countLabel}
          </span>
        )}
        <span className="b-mode-card__rule" aria-hidden="true" />
        <span className="b-mode-card__hint">{active ? activeHint : 'select mode'}</span>
      </FrameBody>
    </button>
  )
}
