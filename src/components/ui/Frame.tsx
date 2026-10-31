import type { ReactNode } from 'react'

export interface FrameProps {
  label?: string
  meta?: string
  tone?: 'default' | 'accent'
  className?: string
  children: ReactNode
}

export interface FrameHeadProps {
  label?: ReactNode
  meta?: ReactNode
  as?: 'header' | 'span'
  className?: string | undefined
}

/**
 * The shared frame header. Renders nothing when it has nothing to say, so a
 * consumer can drop both nodes instead of branching on its own. `as="span"`
 * keeps a header inside a native button or other phrasing-only host.
 */
export function FrameHead({ label, meta, as = 'header', className }: FrameHeadProps) {
  const hasLabel = label !== undefined && label !== null
  const hasMeta = meta !== undefined && meta !== null
  if (!hasLabel && !hasMeta) return null

  const classes = ['b-frame__head']
  if (className !== undefined) classes.push(className)
  const name = classes.join(' ')
  const content = (
    <>
      {hasLabel ? <span className="b-frame__label mono-label">{label}</span> : null}
      {hasMeta ? <span className="b-frame__meta">{meta}</span> : null}
    </>
  )

  if (as === 'span') return <span className={name}>{content}</span>
  return <header className={name}>{content}</header>
}

export interface FrameBodyProps {
  as?: 'div' | 'span'
  className?: string | undefined
  children: ReactNode
}

export function FrameBody({ as = 'div', className, children }: FrameBodyProps) {
  const classes = ['b-frame__body']
  if (className !== undefined) classes.push(className)
  const name = classes.join(' ')

  if (as === 'span') return <span className={name}>{children}</span>
  return <div className={name}>{children}</div>
}

export function Frame({ label, meta, tone = 'default', className, children }: FrameProps) {
  const classes = ['b-frame']
  if (tone === 'accent') classes.push('b-frame--accent')
  if (className !== undefined) classes.push(className)

  const hasHeader = label !== undefined || meta !== undefined

  return (
    <section className={classes.join(' ')} aria-label={label}>
      {hasHeader ? <FrameHead label={label} meta={meta} /> : null}
      <FrameBody>{children}</FrameBody>
    </section>
  )
}
