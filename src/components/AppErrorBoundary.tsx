import { Component, type ReactNode } from 'react'
import { Button, Frame } from './ui'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

function messageFor(error: Error | null): string {
  if (error === null) return ''
  return error.message.length > 0 ? error.message : String(error)
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <div className="b-crash">
        <Frame className="b-crash__frame" label="something snapped" tone="accent">
          <p className="b-crash__message">{messageFor(error)}</p>
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
