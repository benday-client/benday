import { useEffect, useRef } from 'react'

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

export function useHotkeys(hotkeys: readonly Hotkey[], enabled = true): void {
  const latest = useRef(hotkeys)

  useEffect(() => {
    latest.current = hotkeys
  }, [hotkeys])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (isEditableTarget(event.target)) return

      for (const hotkey of latest.current) {
        if (event.key !== hotkey.key) continue

        if (hotkey.ctrlOrMeta === true) {
          if (event.altKey) continue
          if (!event.metaKey && !event.ctrlKey) continue
        } else if (event.metaKey || event.ctrlKey || event.altKey) {
          continue
        }

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
