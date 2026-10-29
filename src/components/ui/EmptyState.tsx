import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="b-empty">
      <p className="b-empty__title">{title}</p>
      {hint !== undefined ? <p className="b-empty__hint">{hint}</p> : null}
      {action !== undefined ? <div className="b-empty__action">{action}</div> : null}
    </div>
  )
}
