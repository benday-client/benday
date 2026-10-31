import { Button } from './Button'

export interface ErrorNoticeProps {
  title?: string
  message: string
  onRetry?: () => void
  retrying?: boolean
}

export function ErrorNotice({
  title = 'error',
  message,
  onRetry,
  retrying = false,
}: ErrorNoticeProps) {
  return (
    <div className="b-error" role="alert">
      <p className="b-error__title">{title}</p>
      <p className="b-error__message">{message}</p>
      {onRetry !== undefined ? (
        // the recovery button keeps focus while its request runs, so retrying
        // is announced rather than removed; the handler rejects a repeat
        <Button
          variant="outline"
          aria-disabled={retrying ? 'true' : undefined}
          aria-busy={retrying ? 'true' : undefined}
          onClick={() => {
            if (retrying) return
            onRetry()
          }}
        >
          retry
        </Button>
      ) : null}
    </div>
  )
}
