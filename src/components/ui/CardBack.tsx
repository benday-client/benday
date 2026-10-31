import type { ReactNode } from 'react'
import { FrameBody, FrameHead } from './Frame'

/** The nonnegative `[NN]` index every card back starts with. */
export function cardBackIndex(count: number): string {
  return `[${String(Math.max(0, count)).padStart(2, '0')}]`
}

export interface CardBackOpenAction {
  label: string
  onClick: () => void
}

export interface CardBackProps {
  label: string
  meta?: string | undefined
  index: ReactNode
  title: ReactNode
  date?: string | undefined
  detail?: string | undefined
  hint: string
  footer?: ReactNode
  /** Makes the back one native button over this content, leaving `footer` outside it. */
  openAction?: CardBackOpenAction | undefined
  className?: string | undefined
  ariaHidden?: boolean | undefined
}

export interface CardBackButtonProps
  extends Omit<CardBackProps, 'footer' | 'openAction' | 'className' | 'ariaHidden'> {
  ariaLabel: string
  onClick: () => void
}

interface CardBackContentProps {
  label: string
  meta: string | undefined
  index: ReactNode
  title: ReactNode
  date: string | undefined
  detail: string | undefined
  hint: string
  inline: boolean
}

function CardBackContent({
  label,
  meta,
  index,
  title,
  date,
  detail,
  hint,
  inline,
}: CardBackContentProps) {
  return (
    <>
      <FrameHead
        className="b-card-back__head"
        label={label}
        meta={meta}
        as={inline ? 'span' : 'header'}
      />
      <FrameBody className="b-card-back__body" as={inline ? 'span' : 'div'}>
        <span className="b-card-back__index">{index}</span>
        <span className="b-card-back__feed">{title}</span>
        <span className="b-card-back__rule" aria-hidden="true" />
        {date === undefined ? null : <span className="b-card-back__date">{date}</span>}
        {detail === undefined ? null : <span className="b-card-back__appview">{detail}</span>}
        <span className="b-card-back__hint">{hint}</span>
      </FrameBody>
    </>
  )
}

/**
 * The back of a card. Without `openAction` it is decorative article content and
 * a footer (an explicit refresh, say) can sit inside it. With `openAction` the
 * content becomes one native button while the footer stays its sibling, so the
 * footer's own controls never nest inside a button.
 */
export function CardBack({
  label,
  meta,
  index,
  title,
  date,
  detail,
  hint,
  footer,
  openAction,
  className,
  ariaHidden,
}: CardBackProps) {
  const classes = ['b-frame', 'b-card-back']
  if (className !== undefined) classes.push(className)
  const name = classes.join(' ')
  const hidden = ariaHidden === true ? 'true' : undefined

  const content = (
    <CardBackContent
      label={label}
      meta={meta}
      index={index}
      title={title}
      date={date}
      detail={detail}
      hint={hint}
      inline={openAction !== undefined}
    />
  )

  if (openAction === undefined) {
    return (
      <article className={name} aria-hidden={hidden}>
        {content}
        {footer === undefined ? null : footer}
      </article>
    )
  }

  return (
    <article className={name} aria-hidden={hidden}>
      <button
        type="button"
        className="b-card-back__surface"
        aria-label={openAction.label}
        onClick={openAction.onClick}
      >
        {content}
      </button>
      {footer === undefined ? null : footer}
    </article>
  )
}

/** A card back that is itself one native button and therefore cannot carry a footer. */
export function CardBackButton({
  label,
  meta,
  index,
  title,
  date,
  detail,
  hint,
  ariaLabel,
  onClick,
}: CardBackButtonProps) {
  return (
    <button
      type="button"
      className="b-frame b-card-back b-card-back--button"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <CardBackContent
        label={label}
        meta={meta}
        index={index}
        title={title}
        date={date}
        detail={detail}
        hint={hint}
        inline
      />
    </button>
  )
}
