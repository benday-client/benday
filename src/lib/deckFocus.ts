import { uiOwnsKeyboard } from './ui'

const DECK = '.b-deck'

/**
 * Focuses the first deck inside `viewRoot` after the swap that rendered it has
 * committed. One rAF keeps the move out of the render pass; when a store-free
 * but still animating native dialog is open, its one-shot `close` gates the
 * rAF so a closing overlay never loses focus to the deck behind it. Returns a
 * disposer that cancels both the frame and any pending `close` listener.
 */
export function focusDeckAfterSwap(viewRoot: HTMLElement | null): () => void {
  let frame = 0
  let waitingDialog: HTMLDialogElement | null = null
  let disposed = false
  // the reader may move focus after asking for the swap; that later choice wins
  const originFocus = document.activeElement

  const stop = () => {
    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    if (waitingDialog !== null) {
      waitingDialog.removeEventListener('close', handleDialogClose)
      waitingDialog = null
    }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    stop()
  }

  const schedule = () => {
    if (disposed) return
    frame = requestAnimationFrame(attempt)
  }

  function handleDialogClose() {
    if (waitingDialog !== null) {
      waitingDialog.removeEventListener('close', handleDialogClose)
      waitingDialog = null
    }
    schedule()
  }

  function attempt() {
    frame = 0
    if (disposed) return
    if (viewRoot === null || !viewRoot.isConnected) {
      dispose()
      return
    }
    if (uiOwnsKeyboard()) {
      dispose()
      return
    }
    const openDialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    if (openDialog !== null) {
      waitingDialog = openDialog
      openDialog.addEventListener('close', handleDialogClose, { once: true })
      return
    }
    // focus placed after this request was scheduled belongs to that newer
    // action; a deck focus pass must not steal it back
    const active = document.activeElement
    if (
      active !== originFocus &&
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== viewRoot &&
      viewRoot.contains(active)
    ) {
      dispose()
      return
    }
    const deck = viewRoot.querySelector<HTMLElement>(DECK)
    if (deck === null) {
      dispose()
      return
    }
    deck.focus({ preventScroll: true })
    stop()
  }

  schedule()
  return dispose
}

/**
 * Hands keyboard ownership from a control that is about to be disabled or
 * removed to the deck that contains it. Does nothing when focus is elsewhere,
 * so an unrelated deck never steals it.
 */
export function focusOwningDeck(element: HTMLElement | null): void {
  if (element === null) return
  const active = document.activeElement
  if (active === null || !element.contains(active)) return
  const deck = element.closest(DECK)
  if (!(deck instanceof HTMLElement)) return
  deck.focus({ preventScroll: true })
}
