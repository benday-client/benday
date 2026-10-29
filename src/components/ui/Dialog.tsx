import { type ReactNode, type SyntheticEvent, useEffect, useId, useRef } from 'react'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  footer?: ReactNode
  className?: string
  children: ReactNode
}

export function Dialog({ open, title, onClose, footer, className, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return

    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal()
      } else {
        dialog.open = true
      }
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close()
      } else {
        dialog.open = false
      }
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || !open) return

    const handleBackdrop = (event: MouseEvent) => {
      if (event.target === dialog) onClose()
    }

    dialog.addEventListener('click', handleBackdrop)
    return () => {
      dialog.removeEventListener('click', handleBackdrop)
    }
  }, [open, onClose])

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    onClose()
  }

  const classes = ['b-dialog']
  if (className !== undefined) classes.push(className)

  return (
    <dialog
      ref={dialogRef}
      className={classes.join(' ')}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={handleCancel}
    >
      <header className="b-dialog__head">
        <h2 id={titleId} className="b-dialog__title">
          {title}
        </h2>
      </header>
      <div className="b-dialog__body">{children}</div>
      {footer !== undefined ? <footer className="b-dialog__foot">{footer}</footer> : null}
    </dialog>
  )
}
