import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  hint?: string
  /** One glyph, dithered like the imagery. `null` hides it. */
  glyph?: string | null
  action?: ReactNode
}

export function EmptyState({ title, hint, glyph = '◆', action }: EmptyStateProps) {
  return (
    <div className="b-empty">
      {glyph === null ? null : (
        <p className="b-empty__glyph" aria-hidden="true">
          {glyph}
        </p>
      )}
      <p className="b-empty__title">{title}</p>
      {hint !== undefined ? <p className="b-empty__hint">{hint}</p> : null}
      {action !== undefined ? <div className="b-empty__action">{action}</div> : null}
    </div>
  )
}
