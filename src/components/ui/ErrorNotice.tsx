import { Button } from './Button'

export interface ErrorNoticeProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorNotice({ title = 'error', message, onRetry }: ErrorNoticeProps) {
  return (
    <div className="b-error" role="alert">
      <p className="b-error__title">{title}</p>
      <p className="b-error__message">{message}</p>
      {onRetry !== undefined ? (
        <Button variant="outline" onClick={onRetry}>
          retry
        </Button>
      ) : null}
    </div>
  )
}
