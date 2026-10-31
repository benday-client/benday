import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  footer?: ReactNode
  headExtra?: ReactNode
  headerClose?: boolean
  className?: string
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDialogElement>) => void
  children: ReactNode
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// the floor for an animated exit: shorter transitions settle inside it, longer
// ones keep the shell open until their declared duration finishes
const CLOSE_ANIMATION_MS = 190

function motionDuration(dialog: HTMLDialogElement): number {
  const raw = getComputedStyle(dialog).getPropertyValue('--motion-dur').trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return 0
  return raw.endsWith('ms') ? value : value * 1000
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

// focus is only put back when the close left it nowhere useful: a newly focused
// control outside, or another open dialog, keeps it
function restoreOpenerFocus(dialog: HTMLDialogElement, opener: HTMLElement | null): void {
  if (opener === null || !opener.isConnected) return
  if (document.querySelector('dialog[open]') !== null) return
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    if (!dialog.contains(active)) return
    active.blur()
  }
  if (!opener.matches(FOCUSABLE) && opener.tabIndex < 0) return
  opener.focus()
}

// A modal is focused by the browser on the first focusable element in DOM
// order, which is the header close cross. Opening a window must not arm its
// close control, so the opening moves focus deliberately instead. An explicit
// choice made by the consumer's own effects already focused something inside
// the dialog, and that keeps ownership.
function focusOpenedDialog(dialog: HTMLDialogElement): void {
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    active !== dialog &&
    dialog.contains(active) &&
    !active.classList.contains('b-dialog__close')
  ) {
    return
  }
  const target =
    dialog.querySelector<HTMLElement>('[data-autofocus]') ??
    dialog.querySelector<HTMLElement>('input, textarea, select')
  ;(target ?? dialog).focus()
}

export function Dialog({
  open,
  title,
  onClose,
  footer,
  headExtra,
  headerClose = false,
  className,
  onKeyDown,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  // a render that closes must not overwrite the captured open size with the
  // collapsed size the observer reports before the effect cleanup runs
  const openRef = useRef(open)
  openRef.current = open
  // react clears ref props before passive cleanups run, so unmount needs its own
  const elementRef = useRef<HTMLDialogElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const modalRef = useRef(false)
  const titleId = useId()

  const finishClose = (dialog: HTMLDialogElement) => {
    closeTimerRef.current = null
    delete dialog.dataset['closing']
    if (!dialog.open) return
    // showModal / close restore focus themselves
    if (modalRef.current && typeof dialog.close === 'function') {
      dialog.close()
    } else {
      dialog.open = false
      restoreOpenerFocus(dialog, openerRef.current)
    }
    openerRef.current = null
  }

  // Opening happens in a layout effect so the deliberate focus lands before
  // the children's passive effects can pull focus away on their own terms.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    elementRef.current = dialog

    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      delete dialog.dataset['closing']
      if (!dialog.open) {
        // read the opener before showModal moves focus into the dialog itself
        openerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
        modalRef.current = typeof dialog.showModal === 'function'
        if (modalRef.current) {
          dialog.showModal()
        } else {
          dialog.open = true
        }
        focusOpenedDialog(dialog)
      }
      return
    }

    if (!dialog.open) return
    // keep the dialog open for the length of the exit animation so a theme
    // that animates its close has something to animate
    if (prefersReducedMotion() || dialog.dataset['closing'] === 'true') {
      finishClose(dialog)
      return
    }
    dialog.dataset['closing'] = 'true'
    // only the theme with a themed exit animates; every other theme closes at
    // once instead of holding an invisible modal open
    // the theme declares how long its exit runs; truth to materials declares
    // none, cyberpunk overrides the transition with its own boot keyframes
    const themed = motionDuration(dialog)
    const animatesExit =
      !prefersReducedMotion() &&
      (document.documentElement.dataset['theme'] === 'cyberpunk' || themed > 0)
    if (!animatesExit) {
      finishClose(dialog)
      return
    }
    // the exit transition can run longer than the floor, so the shell must stay
    // open for the declared duration instead of cutting the animation short
    closeTimerRef.current = window.setTimeout(
      () => {
        finishClose(dialog)
      },
      Math.max(CLOSE_ANIMATION_MS, Math.ceil(themed)),
    )
  }, [open])

  // the close animation keeps the shell at its open size, so a dialog whose
  // body is swapped out mid-close does not collapse while it fades
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || !open) return
    const update = () => {
      if (!openRef.current) return
      // offset size ignores the entry transform, so the frozen shell matches
      // the settled box
      dialog.style.setProperty('--b-close-width', `${dialog.offsetWidth}px`)
      dialog.style.setProperty('--b-close-height', `${dialog.offsetHeight}px`)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(dialog)
    return () => observer.disconnect()
  }, [open])

  // a viewer that unmounts while open never reaches the close branch above, so
  // closing and restoring has to survive unmount too
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      const dialog = elementRef.current
      if (dialog === null || !dialog.open) return
      if (modalRef.current && typeof dialog.close === 'function') {
        dialog.close()
      } else {
        dialog.open = false
      }
      restoreOpenerFocus(dialog, openerRef.current)
      openerRef.current = null
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || !open) return

    // a selection drag that starts inside the dialog and ends on its backdrop
    // retargets the click to the dialog; only a press that started on the
    // backdrop itself dismisses
    let pressedOnBackdrop = false
    const handlePointerDown = (event: PointerEvent) => {
      pressedOnBackdrop = event.target === dialog
    }
    const handleBackdrop = (event: MouseEvent) => {
      const dismiss = pressedOnBackdrop && event.target === dialog
      pressedOnBackdrop = false
      if (dismiss) onClose()
    }

    dialog.addEventListener('pointerdown', handlePointerDown)
    dialog.addEventListener('click', handleBackdrop)
    return () => {
      dialog.removeEventListener('pointerdown', handlePointerDown)
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
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onKeyDown={onKeyDown}
    >
      <header className="b-dialog__head">
        <h2 id={titleId} className="b-dialog__title">
          {title}
        </h2>
        {headExtra}
        {headerClose ? (
          <button
            type="button"
            className="b-dialog__close"
            aria-label={`close ${title}`}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </header>
      <div className="b-dialog__body">{children}</div>
      {footer !== undefined ? <footer className="b-dialog__foot">{footer}</footer> : null}
    </dialog>
  )
}
