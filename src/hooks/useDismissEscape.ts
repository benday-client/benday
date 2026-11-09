import { useEffect, useRef } from 'react'
import { uiOwnsKeyboard } from '../lib/ui'
import { isImeComposing } from './useHotkeys'

/**
 * Owns Escape for one dismissable surface. A capture listener closes the
 * surface before the app's bubble-phase back layer can leave the route; a key
 * another layer already claimed, an IME composition, a store-owned dialog or
 * composer and an open native modal keep the key for themselves.
 */
export function useDismissEscape(active: boolean, onDismiss: () => void): void {
  const latest = useRef(onDismiss)

  useEffect(() => {
    latest.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!active) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      // an IME owns the key that commits its composition
      if (isImeComposing(event)) return
      if (event.key !== 'Escape') return
      if (uiOwnsKeyboard()) return
      // an open native modal keeps Escape for itself
      if (document.querySelector('dialog[open]') !== null) return
      event.preventDefault()
      latest.current()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [active])
}
