import { Component, type ReactNode } from 'react'
import { errorInfo } from '../lib/errors'
import { Button, Frame } from './ui'

interface AppErrorBoundaryProps {
  children: ReactNode
}

/**
 * A crash is a status, not a nullable error: `ok` is the live app and `failed`
 * carries whatever was thrown. `unknown` is deliberate — a render fault can
 * throw a string, `null` or an object, and none of them may crash the recovery
 * screen itself.
 */
type AppErrorBoundaryState = { status: 'ok' } | { status: 'failed'; error: unknown }

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { status: 'ok' }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { status: 'failed', error }
  }

  // The crash root is the recovery target: mounting it focuses and announces
  // the failure, and the stable callback identity means a later re-render does
  // not steal focus back from the reload button.
  private readonly focusCrash = (element: HTMLDivElement | null): void => {
    element?.focus()
  }

  override render(): ReactNode {
    const state = this.state
    if (state.status === 'ok') return this.props.children

    return (
      <div className="b-crash" role="alert" tabIndex={-1} ref={this.focusCrash}>
        <Frame className="b-crash__frame" label="something snapped" tone="accent">
          <p className="b-crash__message">{errorInfo(state.error).detail}</p>
          <p className="b-crash__hint">the reader hit a render fault.</p>
          <Button
            variant="solid"
            onClick={() => {
              window.location.reload()
            }}
          >
            reload
          </Button>
        </Frame>
      </div>
    )
  }
}
