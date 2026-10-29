import type { ReactNode } from 'react'

export interface TagProps {
  tone?: 'default' | 'accent' | 'warn'
  title?: string
  children: ReactNode
}

export function Tag({ tone = 'default', title, children }: TagProps) {
  const classes = ['b-tag', `b-tag--${tone}`]

  return (
    <span className={classes.join(' ')} title={title}>
      {children}
    </span>
  )
}
