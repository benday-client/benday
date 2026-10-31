import type { RenderResult } from '@testing-library/react'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * The app shell gives `.b-main` a definite height (`1fr` of a `100dvh` grid),
 * which is what every deck, thread and viewer measurement depends on. Native
 * browser specs render inside the same shell without booting a second App: the
 * top bar is dropped, so `main` takes the whole row.
 */
export function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="b-app" style={{ gridTemplateRows: 'minmax(0, 1fr)' }}>
      <main className="b-main">{children}</main>
    </div>
  )
}

export function renderStage(ui: ReactNode): RenderResult {
  return render(<Stage>{ui}</Stage>)
}
