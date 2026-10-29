import { useEffect } from 'react'

const NAVIGATION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tab',
  'g',
  'G',
  'h',
  'j',
  'k',
  'l',
])

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

export function useInputMode(): void {
  useEffect(() => {
    const root = document.documentElement

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (!NAVIGATION_KEYS.has(event.key)) return
      root.dataset['input'] = 'keyboard'
    }

    const handlePointer = () => {
      if (root.dataset['input'] !== 'pointer') root.dataset['input'] = 'pointer'
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointermove', handlePointer, { passive: true, capture: true })
    window.addEventListener('pointerdown', handlePointer, { passive: true, capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointermove', handlePointer, true)
      window.removeEventListener('pointerdown', handlePointer, true)
    }
  }, [])
}
