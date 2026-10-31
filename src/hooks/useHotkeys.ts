import { useEffect, useRef } from 'react'
import { characterShortcutAllowed, matchesChord } from '../lib/keymap'
import { useSettings } from '../lib/store'

export interface Hotkey {
  key: string
  handler: () => void
  ctrlOrMeta?: boolean
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

/**
 * Whether an IME owns the keydown that would otherwise act as a shortcut.
 * `keyCode` 229 covers browsers that report the composition commit before
 * `isComposing` flips, so the two are always consulted together.
 */
export function isImeComposing(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229
}

export function useHotkeys(hotkeys: readonly Hotkey[], enabled = true): void {
  const latest = useRef(hotkeys)

  useEffect(() => {
    latest.current = hotkeys
  }, [hotkeys])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // the character-shortcut opt-out reads live settings, so flipping the
      // setting never needs a resubscribe; modifier chords and non-character
      // navigation keys still work while it is off
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      if (event.defaultPrevented || event.repeat) return
      // an IME owns the key that commits its composition
      if (isImeComposing(event)) return
      if (isEditableTarget(event.target)) return
      // a native modal owns the keyboard, including the locally controlled
      // media viewer that never enters the UI store
      if (document.querySelector('dialog[open]') !== null) return

      for (const hotkey of latest.current) {
        // the match semantics live in the registry, so a chord means the same
        // thing here and in the surface that declares it
        const chord =
          hotkey.ctrlOrMeta === true ? { key: hotkey.key, ctrlOrMeta: true } : { key: hotkey.key }
        if (!matchesChord(event, chord)) continue

        event.preventDefault()
        hotkey.handler()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled])
}
