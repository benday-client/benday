import { useCallback, useEffect, useRef, useState } from 'react'
import { isEditableTarget } from '../hooks/useHotkeys'
import { bindingFor, characterShortcutAllowed, displayKeys } from '../lib/keymap'
import { useSettings } from '../lib/store'
import { uiOwnsKeyboard, useUiStore } from '../lib/ui'

/**
 * A `?` press shorter than this still opens the help dialog; holding past it
 * reveals the key badges instead. `?` has a tap action, which is the only
 * reason the hold needs a discriminator at all.
 */
export const HOLD_THRESHOLD_MS = 300
/**
 * Once the hold is real, wait one more beat before painting, so a chord that
 * resolves just past the threshold never flashes badges on the way to its own
 * handler.
 */
export const HOLD_PAINT_MS = 120
/** Space between a badge group and the control it explains. */
const HINT_GAP = 8
/** A group anchored this close to the top edge flips below its control. */
const HINT_FLIP_TOP = 56

interface HintGroup {
  /** Registry binding ids the owner declared on this element. */
  ids: readonly string[]
  /** The registry's display labels, one per id. */
  keys: readonly string[]
  left: number
  top: number
  placement: 'above' | 'below'
}

function keyLabel(id: string): string | null {
  // an owner typo must not take the overlay down with it, so an unknown id is
  // skipped instead of throwing inside a paint callback
  try {
    return displayKeys(bindingFor(id))[0] ?? null
  } catch {
    return null
  }
}

/**
 * Reads the hints the owners declared: any element with `data-keyhint` naming
 * one or more registry binding ids, and only while that owner can actually run
 * the action. Positions come from the element's own viewport rect.
 */
function collectHintGroups(root: ParentNode = document): HintGroup[] {
  const groups: HintGroup[] = []
  for (const node of root.querySelectorAll<HTMLElement>('[data-keyhint]')) {
    // a control that cannot run its action has no key to teach
    if (node.matches(':disabled, [aria-disabled="true"]')) continue
    const ids: string[] = []
    const keys: string[] = []
    for (const id of (node.getAttribute('data-keyhint') ?? '').split(/\s+/)) {
      if (id.length === 0) continue
      const label = keyLabel(id)
      if (label === null) continue
      ids.push(id)
      keys.push(label)
    }
    if (keys.length === 0) continue

    const rect = node.getBoundingClientRect()
    const below = rect.top < HINT_FLIP_TOP
    groups.push({
      ids,
      keys,
      left: rect.right,
      top: below ? rect.bottom + HINT_GAP : rect.top - HINT_GAP,
      placement: below ? 'below' : 'above',
    })
  }
  return groups
}

export interface KeyHintsProps {
  /** Changes identity on a route swap; a new route ends the gesture. */
  route?: string | undefined
}

/**
 * Hold `?` to reveal the keys the visible controls already answer to. The
 * badges are painted from the controls' own rects into a fixed, inert layer:
 * they reserve no space, move nothing, take no pointer events and carry no
 * accessible text (the labels the badges echo are already in the controls'
 * names and in the help dialog).
 */
export function KeyHints({ route }: KeyHintsProps) {
  const dialog = useUiStore((state) => state.dialog)
  const compose = useUiStore((state) => state.compose)
  const inlineCompose = useUiStore((state) => state.inlineCompose)
  const keyboardShortcuts = useSettings((state) => state.keyboardShortcuts)
  const [groups, setGroups] = useState<readonly HintGroup[]>([])

  const phaseRef = useRef<'idle' | 'pending' | 'open'>('idle')
  // set once the press has outlived the threshold, which cancels the tap
  const heldRef = useRef(false)
  const thresholdRef = useRef<number | null>(null)
  const paintRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    phaseRef.current = 'idle'
    heldRef.current = false
    if (thresholdRef.current !== null) window.clearTimeout(thresholdRef.current)
    if (paintRef.current !== null) window.clearTimeout(paintRef.current)
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    thresholdRef.current = null
    paintRef.current = null
    frameRef.current = null
  }, [])

  const hide = useCallback(() => {
    stop()
    setGroups((current) => (current.length === 0 ? current : []))
  }, [stop])

  // a route swap, a dialog or a composer all describe a different surface than
  // the one the hold started on, so the badges end with it
  useEffect(() => {
    hide()
  }, [hide, route, dialog, compose, inlineCompose])

  // switching the character shortcuts off mid-gesture cancels the pending hold
  // and drops any badges already painted
  useEffect(() => {
    if (keyboardShortcuts) return
    hide()
  }, [hide, keyboardShortcuts])

  useEffect(() => {
    const scheduleMeasure = () => {
      if (phaseRef.current !== 'open') return
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        setGroups(collectHintGroups())
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === '?') {
        if (event.repeat || event.defaultPrevented) return
        // an IME owns the key that commits its composition
        if (event.isComposing || event.keyCode === 229) return
        if (event.metaKey || event.ctrlKey || event.altKey) return
        // `?` is a bare character shortcut, so it obeys the preference
        if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
        if (isEditableTarget(event.target)) return
        if (uiOwnsKeyboard()) return
        if (document.querySelector('dialog[open]') !== null) return
        // a second keydown of a held `?` is the same gesture, not a new one
        if (phaseRef.current !== 'idle') return

        phaseRef.current = 'pending'
        heldRef.current = false
        thresholdRef.current = window.setTimeout(() => {
          thresholdRef.current = null
          heldRef.current = true
          paintRef.current = window.setTimeout(() => {
            paintRef.current = null
            phaseRef.current = 'open'
            setGroups(collectHintGroups())
          }, HOLD_PAINT_MS)
        }, HOLD_THRESHOLD_MS)
        return
      }

      if (phaseRef.current === 'idle') return
      // any other key ends the gesture and keeps its own meaning: the badge
      // teaches the key, it never swallows it. Escape is the exception because
      // escaping the overlay must not also navigate.
      const visible = phaseRef.current === 'open'
      hide()
      if (visible && event.key === 'Escape') event.preventDefault()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== '?') return
      if (phaseRef.current === 'idle') return
      // released before the threshold: this was a tap, so run the tap action
      const tapped = phaseRef.current === 'pending' && !heldRef.current
      hide()
      if (tapped) useUiStore.getState().openDialog('help')
    }

    const handleBlur = () => {
      hide()
    }

    const handleVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      hide()
    }

    const handleFocusIn = (event: Event) => {
      if (!isEditableTarget(event.target)) return
      hide()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)
    document.addEventListener('visibilitychange', handleVisibility)
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      document.removeEventListener('visibilitychange', handleVisibility)
      document.removeEventListener('focusin', handleFocusIn)
      // unmount must not leave a timer that would paint into a dead tree
      stop()
    }
  }, [hide, stop])

  // a disabled preference hides the layer in the same commit that flips it
  if (!keyboardShortcuts || groups.length === 0) return null

  return (
    <div className="b-keyhints" data-keyhint-layer="true" aria-hidden="true">
      {groups.map((group, position) => (
        <div
          // ids plus their order are the identity: a scroll only moves the
          // group, it does not replace it
          key={`${group.ids.join(' ')}#${String(position)}`}
          className="b-keyhints__group"
          data-placement={group.placement}
          style={{ left: group.left, top: group.top }}
        >
          {group.keys.map((label, index) => (
            <span key={`${label}-${String(index)}`} className="b-keyhint">
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
