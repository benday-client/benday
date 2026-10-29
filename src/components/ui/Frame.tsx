import type { ReactNode } from 'react'

export interface FrameProps {
  label?: string
  meta?: string
  tone?: 'default' | 'accent'
  className?: string
  children: ReactNode
}

export function Frame({ label, meta, tone = 'default', className, children }: FrameProps) {
  const classes = ['b-frame']
  if (tone === 'accent') classes.push('b-frame--accent')
  if (className !== undefined) classes.push(className)

  const hasHeader = label !== undefined || meta !== undefined

  return (
    <section className={classes.join(' ')}>
      {hasHeader ? (
        <header className="b-frame__head">
          {label !== undefined ? <span className="b-frame__label mono-label">{label}</span> : null}
          {meta !== undefined ? <span className="b-frame__meta">{meta}</span> : null}
        </header>
      ) : null}
      <div className="b-frame__body">{children}</div>
    </section>
  )
}
