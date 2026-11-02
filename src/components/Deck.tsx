// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the deck is a focusable scroll region
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { bindingFor, characterShortcutAllowed, matchesBinding } from '../lib/keymap'
import { scrollCardBody } from '../lib/scroll'
import { useSettings } from '../lib/store'
import { Button, EmptyState } from './ui'

export interface DeckProps<T> {
  items: readonly T[]
  getKey: (item: T) => string
  renderItem: (item: T, index: number, focused: boolean) => ReactNode
  onActivate?: (item: T, index: number) => void
  onExitStart?: () => void
  leadingPeek?: ReactNode
  leadingPeekInteractive?: boolean
  pending?: boolean
  hasMore?: boolean
  loadingMore?: boolean
  loadMoreError?: boolean
  onLoadMore?: () => void
  onRetryLoadMore?: () => void
  empty?: ReactNode
  label: string
  className?: string
  initialIndex?: number
  stateKey?: string
  /** `list` stacks full-width content-height rows instead of dealing wide cards */
  layout?: 'deck' | 'list'
}

interface DeckPosition {
  axis: 'x' | 'y'
  index: number
  /** the focused card's key; an index alone drifts when items shift */
  key: string | null
  /** settled scroll offset on `axis`; null while a smooth move is in flight */
  offset: number | null
  /** the selected card's content-axis position; null while in flight */
  anchor: number | null
}

type Selection = { index: number; key: string | null }

const deckPositions = new Map<string, DeckPosition>()

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

/**
 * The live card for a committed selection: its key wins over a stale index, so
 * cards inserted or removed around it keep it current. A card that left the
 * deck falls back to the clamped index.
 */
function resolveIndex<T>(
  selection: Selection,
  items: readonly T[],
  getKey: (item: T) => string,
): number {
  if (items.length === 0) return 0
  if (selection.key !== null) {
    const keyed = items.findIndex((item) => getKey(item) === selection.key)
    if (keyed >= 0) return keyed
  }
  return clampIndex(selection.index, items.length)
}

function offsetOf(scroller: HTMLElement, axis: DeckPosition['axis']): number {
  return axis === 'x' ? scroller.scrollLeft : scroller.scrollTop
}

/** The scroller's scroll padding on one axis, in px; `auto`/missing reads as 0. */
function scrollPadding(
  style: CSSStyleDeclaration,
  axis: DeckPosition['axis'],
): { start: number; end: number } {
  const rawStart = axis === 'x' ? style.scrollPaddingLeft : style.scrollPaddingTop
  const rawEnd = axis === 'x' ? style.scrollPaddingRight : style.scrollPaddingBottom
  const start = Number.parseFloat(rawStart)
  const end = Number.parseFloat(rawEnd)
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
  }
}

/** The card's position in the scroller's content coordinates on `axis`. */
function contentAnchor(card: Element, scroller: HTMLElement, axis: DeckPosition['axis']): number {
  const cardRect = card.getBoundingClientRect()
  const base = scroller.getBoundingClientRect()
  return axis === 'x'
    ? cardRect.left - base.left + scroller.scrollLeft
    : cardRect.top - base.top + scroller.scrollTop
}

/**
 * How much of the card would sit inside the snapport if the scroller rested at
 * `candidate`, as a fraction of the smaller of card and snapport. Rects are
 * shifted mathematically so the scroller never has to move transiently.
 */
function visibleRatioAt(
  card: Element,
  scroller: HTMLElement,
  axis: DeckPosition['axis'],
  candidate: number,
): number {
  const cardRect = card.getBoundingClientRect()
  const base = scroller.getBoundingClientRect()
  const padding = scrollPadding(getComputedStyle(scroller), axis)
  const baseStart = axis === 'x' ? base.left : base.top
  const snapportStart = baseStart + padding.start
  const snapportExtent = Math.max(
    0,
    (axis === 'x' ? scroller.clientWidth : scroller.clientHeight) - padding.start - padding.end,
  )
  const cardExtent = axis === 'x' ? cardRect.width : cardRect.height
  const cardStart =
    (axis === 'x' ? cardRect.left : cardRect.top) - (candidate - offsetOf(scroller, axis))
  const overlap =
    Math.min(cardStart + cardExtent, snapportStart + snapportExtent) -
    Math.max(cardStart, snapportStart)
  const denominator = Math.min(cardExtent, snapportExtent)
  if (denominator <= 0) return 0
  return Math.max(0, overlap) / denominator
}

/** The real card nearest the snapport's centre on x, or start on y. */
function nearestCard(
  scroller: HTMLElement,
  axis: DeckPosition['axis'],
  preferredIndex: number,
): HTMLElement | null {
  const cards = scroller.querySelectorAll<HTMLElement>('[data-deck-index]')
  if (cards.length === 0) return null
  const base = scroller.getBoundingClientRect()
  const padding = scrollPadding(getComputedStyle(scroller), axis)
  const start = (axis === 'x' ? base.left : base.top) + padding.start
  const extent = Math.max(
    0,
    (axis === 'x' ? scroller.clientWidth : scroller.clientHeight) - padding.start - padding.end,
  )
  const target = axis === 'x' ? start + extent / 2 : start
  let best: HTMLElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    const position = axis === 'x' ? rect.left + rect.width / 2 : rect.top
    const distance = Math.abs(position - target)
    // a tiled row can put two cards at the same snap position; keeping the
    // current one avoids flipping a restored card to its row neighbour
    const tiedPreferred =
      Math.abs(distance - bestDistance) <= 0.5 &&
      Number(card.dataset['deckIndex']) === preferredIndex
    if (distance < bestDistance - 0.5 || tiedPreferred) {
      best = card
      bestDistance = Math.min(bestDistance, distance)
    }
  }
  return best
}

// the deck owns axis semantics; the registry owns which chords mean what
const DECK_MOVE = bindingFor('deck-move')
const DECK_ENDS = bindingFor('deck-ends')
const DECK_POSITION = bindingFor('deck-position')
const DECK_OPEN = bindingFor('deck-open')
const DECK_SCROLL = bindingFor('deck-scroll')

const SKELETONS = [
  { key: 'skeleton-1', label: 'loading card' },
  { key: 'skeleton-2', label: 'loading card' },
  { key: 'skeleton-3', label: 'loading card' },
] as const

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('a, button, input, textarea, select, [contenteditable="true"]') !== null
}

export function Deck<T>({
  items,
  getKey,
  renderItem,
  onActivate,
  onExitStart,
  leadingPeek,
  leadingPeekInteractive = false,
  pending = false,
  hasMore = false,
  loadingMore = false,
  loadMoreError = false,
  onLoadMore,
  onRetryLoadMore,
  empty,
  label,
  className,
  initialIndex,
  stateKey,
  layout = 'deck',
}: DeckProps<T>): ReactElement {
  const wide = useMediaQuery('(min-width: 900px)')
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  // a list keeps the deck's focus, keys and position memory but stacks
  // content-height rows on every screen; notifications read as a list
  const horizontal = wide && layout === 'deck'
  const axis: DeckPosition['axis'] = horizontal ? 'x' : 'y'
  const hasLeadingPeek = leadingPeek !== undefined

  const remembered = stateKey === undefined ? undefined : deckPositions.get(stateKey)
  const [selection, setSelection] = useState<Selection>(() =>
    remembered === undefined
      ? { index: initialIndex ?? 0, key: null }
      : { index: remembered.index, key: remembered.key },
  )
  const effectiveIndex = resolveIndex(selection, items, getKey)
  const effectiveItem = items[effectiveIndex]
  const effectiveKey = effectiveItem === undefined ? null : getKey(effectiveItem)
  const focusIndex = effectiveIndex
  const [announcedIndex, setAnnouncedIndex] = useState(() => effectiveIndex)

  const scrollerRef = useRef<HTMLOListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)
  const loadMoreRef = useRef(onLoadMore)
  // a saved position waits here until the items it points at exist, so an
  // empty or still-loading deck never zeroes the memory of another commit
  const pendingPositionRef = useRef<DeckPosition | null>(remembered ?? null)
  const initialAppliedRef = useRef(remembered !== undefined || initialIndex === undefined)
  const initialIndexRef = useRef(initialIndex)
  const centeredPeekKeyRef = useRef<string | null>(null)
  const itemsRef = useRef(items)
  const getKeyRef = useRef(getKey)
  const selectionRef = useRef(selection)
  const stateKeyRef = useRef(stateKey)
  const axisRef = useRef<DeckPosition['axis']>(axis)
  // a smooth programmatic move has not settled yet, so its offsets are unknown
  const transitRef = useRef(false)
  // the restore/initial effects own selection for their commit; reconciliation
  // must not overwrite a selection they just resolved
  const skipReconcileRef = useRef(false)
  // a selection resolved by an effect reaches the map on the next commit, so
  // this commit must not persist the previous selection over the saved data
  const skipPersistRef = useRef(false)
  // a selection resolved this commit already placed its card, so the layout
  // correction must not scroll to the previous render's index over it
  const skipGeometryRef = useRef(false)
  // the first layout centres the opening card before the browser paints; a
  // smooth scroll there would read as the deck sliding in on load, so only
  // later corrections keep the user-move motion
  const firstCenteringRef = useRef(true)
  const layoutWidth = horizontal ? 'wide' : 'narrow'
  const layoutPeek = hasLeadingPeek ? 'peek' : 'solo'
  const layoutSignature = `${axis}:${layoutWidth}:${layoutPeek}`
  const previousLayoutRef = useRef(layoutSignature)

  // Every programmatic deck move goes through one helper, so the focused card,
  // the leading-peek centring and an emptied deck share the same motion.
  const scrollBehavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth'

  const scrollDeck = (anchor: HTMLElement | number, behavior: ScrollBehavior) => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    if (typeof anchor === 'number') {
      const offset = Math.max(0, anchor)
      // jsdom has no Element.scrollTo; the offset itself is what matters there
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ left: offset, behavior })
      } else {
        scroller.scrollLeft = offset
      }
      return
    }

    if (typeof anchor.scrollIntoView !== 'function') return

    anchor.scrollIntoView({
      block: horizontal ? 'nearest' : 'start',
      inline: horizontal ? 'center' : 'nearest',
      behavior,
    })
  }

  const scrollToIndex = (index: number, behavior: ScrollBehavior) => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const target = scroller.querySelector<HTMLElement>(`[data-deck-index="${index}"]`)
    if (target === null) return

    scrollDeck(target, behavior)
  }

  // committed refs mirror the last render after it commits; nothing here runs
  // during render, so a scroll handler always reads settled state
  useLayoutEffect(() => {
    itemsRef.current = items
    getKeyRef.current = getKey
    selectionRef.current = selection
    stateKeyRef.current = stateKey
    axisRef.current = axis
  })

  useLayoutEffect(() => {
    initialIndexRef.current = initialIndex
  }, [initialIndex])

  // initialize only when the namespace changes; a resize must not reset the
  // reader's position, so axis and peek are not initialization inputs
  useLayoutEffect(() => {
    const position = stateKey === undefined ? undefined : deckPositions.get(stateKey)
    pendingPositionRef.current = position ?? null
    initialAppliedRef.current = position !== undefined || initialIndexRef.current === undefined
    transitRef.current = false
    skipReconcileRef.current = true
    skipPersistRef.current = true
    skipGeometryRef.current = true
    setSelection(
      position === undefined
        ? { index: initialIndexRef.current ?? 0, key: null }
        : { index: position.index, key: position.key },
    )
    setAnnouncedIndex(position?.index ?? initialIndexRef.current ?? 0)

    const scroller = scrollerRef.current
    if (position === undefined && scroller !== null && !(horizontal && hasLeadingPeek)) {
      scroller.scrollLeft = 0
      scroller.scrollTop = 0
    }
  }, [stateKey])

  // consume a saved position as soon as the items it points at arrive; while
  // the deck is still empty it stays pending with its key intact
  useLayoutEffect(() => {
    const position = pendingPositionRef.current
    if (position === null || items.length === 0) return
    // a loading placeholder can be the only mounted card; keep the saved key
    // pending until the real item it points at exists
    if (pending && position.key !== null) {
      const loaded = items.some((item) => getKey(item) === position.key)
      if (!loaded) return
    }

    pendingPositionRef.current = null
    const index = resolveIndex({ index: position.index, key: position.key }, items, getKey)
    const restoredItem = items[index]
    transitRef.current = false
    skipReconcileRef.current = true
    skipPersistRef.current = true
    skipGeometryRef.current = true
    setSelection({ index, key: restoredItem === undefined ? null : getKey(restoredItem) })
    setAnnouncedIndex(index)

    const scroller = scrollerRef.current
    if (scroller === null) return
    const card = scroller.querySelector<HTMLElement>(`[data-deck-index="${index}"]`)

    if (index !== position.index || position.axis !== axis) {
      // the key moved the focus because items shifted around it, or the offsets
      // belong to the other axis; either way they cannot place this card
      scrollToIndex(index, 'auto')
      return
    }
    if (horizontal && hasLeadingPeek && index === 0) {
      // the stored offset belongs to the layout before the leading peek existed
      scrollToIndex(0, 'auto')
      return
    }
    if (axis === 'x') {
      // mandatory snapping owns an x rest, so put the resolved card dead centre
      scrollToIndex(index, 'auto')
      return
    }
    if (position.offset === null || position.anchor === null || card === null) {
      scrollToIndex(index, 'auto')
      return
    }
    const anchor = contentAnchor(card, scroller, 'y')
    if (
      Math.abs(anchor - position.anchor) <= 1 ||
      visibleRatioAt(card, scroller, 'y', position.offset) >= 0.9
    ) {
      scroller.scrollTop = position.offset
      return
    }
    // the card is no longer mostly on screen at the saved offset: reveal it
    scrollToIndex(index, 'auto')
  }, [items, getKey, stateKey, axis, horizontal, hasLeadingPeek, pending])

  // keep the committed selection live: a keyed card follows reorders, a card
  // that left the deck is replaced by the clamped slot, an empty deck is zero
  useLayoutEffect(() => {
    if (skipReconcileRef.current) {
      skipReconcileRef.current = false
      return
    }
    if (items.length === 0) {
      if (selection.index !== 0 || selection.key !== null) {
        skipPersistRef.current = true
        setSelection({ index: 0, key: null })
      }
      return
    }
    if (effectiveIndex !== selection.index || effectiveKey !== selection.key) {
      skipPersistRef.current = true
      setSelection({ index: effectiveIndex, key: effectiveKey })
    }
  }, [items, selection, effectiveIndex, effectiveKey])

  // a fresh deck may start on a requested card; a saved position always wins
  useLayoutEffect(() => {
    if (initialAppliedRef.current) return
    if (initialIndex === undefined || items.length === 0) return

    initialAppliedRef.current = true
    const index = clampIndex(initialIndex, items.length)
    const initialItem = items[index]
    transitRef.current = false
    skipReconcileRef.current = true
    skipPersistRef.current = true
    skipGeometryRef.current = true
    setSelection({ index, key: initialItem === undefined ? null : getKey(initialItem) })
    setAnnouncedIndex(index)
    scrollToIndex(index, 'auto')
  }, [initialIndex, items.length, horizontal])

  // an axis flip or a peek appearing/disappearing changes the geometry under a
  // card that should stay current: correct its placement, never the selection
  useLayoutEffect(() => {
    const previous = previousLayoutRef.current
    previousLayoutRef.current = layoutSignature
    if (skipGeometryRef.current) {
      skipGeometryRef.current = false
      return
    }
    if (previous === layoutSignature) return
    if (items.length === 0) return
    if (pendingPositionRef.current !== null) return
    transitRef.current = false
    scrollToIndex(effectiveIndex, 'auto')
  })

  // an empty deck has no focused card to centre, so the empty slot takes that
  // place: the leading peek stays half visible and the message sits like a card
  const hasEmptySlot = items.length === 0 && !pending

  useLayoutEffect(() => {
    if (!horizontal || !hasEmptySlot) return
    const scroller = scrollerRef.current
    if (scroller === null) return
    const empty = scroller.querySelector<HTMLElement>('.b-deck__empty')
    if (empty === null) return
    const deckRect = scroller.getBoundingClientRect()
    const emptyRect = empty.getBoundingClientRect()
    const delta = emptyRect.left + emptyRect.width / 2 - (deckRect.left + deckRect.width / 2)
    scrollDeck(scroller.scrollLeft + delta, scrollBehavior)
  }, [horizontal, hasEmptySlot])

  // A leading peek occupies the previous-card slot. The first real card must
  // start centered so the peek is only half visible.
  useLayoutEffect(() => {
    const firstCentering = firstCenteringRef.current
    firstCenteringRef.current = false
    if (!horizontal || !hasLeadingPeek) {
      // without a horizontal peek there is nothing centered to remember, so the
      // next wide layout must center the first card again
      centeredPeekKeyRef.current = null
      return
    }
    if (items.length === 0 || focusIndex !== 0) return
    const key = stateKey ?? 'no-key'
    if (centeredPeekKeyRef.current === key) return
    const scroller = scrollerRef.current
    if (scroller === null) return
    const target = scroller.querySelector<HTMLElement>('[data-deck-index="0"]')
    if (target === null) return
    const deckRect = scroller.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const centeredLeft = targetRect.left - deckRect.left - (deckRect.width - targetRect.width) / 2
    // a deck sitting at its origin was reset by a swap, not moved by the user,
    // so it re-centres before paint instead of sliding in from the switcher
    const fromOrigin = scroller.scrollLeft < 1
    scrollDeck(
      scroller.scrollLeft + centeredLeft,
      firstCentering || fromOrigin ? 'auto' : scrollBehavior,
    )
    centeredPeekKeyRef.current = key
  }, [horizontal, hasLeadingPeek, items.length, focusIndex, stateKey])

  // persist the settled position; while a smooth move is in flight only the
  // identity is known, so its offsets are stored as null until the rest lands
  useLayoutEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    if (stateKey === undefined) return
    if (items.length === 0) return
    if (pendingPositionRef.current !== null) return
    const scroller = scrollerRef.current
    if (scroller === null) return
    const settled = !transitRef.current
    const card = scroller.querySelector<HTMLElement>(`[data-deck-index="${effectiveIndex}"]`)
    deckPositions.set(stateKey, {
      axis,
      index: effectiveIndex,
      key: effectiveKey,
      offset: settled ? offsetOf(scroller, axis) : null,
      anchor: settled && card !== null ? contentAnchor(card, scroller, axis) : null,
    })
  }, [stateKey, axis, selection, items, effectiveIndex, effectiveKey])

  // at rest the card nearest the snap position becomes the logical current
  // card; moving the selection there must not scroll or steal DOM focus
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    let raf = 0
    let last = offsetOf(scroller, axis)
    let stable = 0
    // a viewport or container resize reflows the deck before the axis prop
    // commits; the browser's clamped scroll offset is not reader intent. skip
    // exactly the first settle whose scroller/card geometry changed, then let
    // the restored placement settle normally
    const geometryStamp = () => {
      const first = scroller.querySelector<HTMLElement>('[data-deck-index]')
      return [
        scroller.clientWidth,
        scroller.clientHeight,
        first?.offsetWidth ?? 0,
        first?.offsetHeight ?? 0,
      ].join(':')
    }
    let stamp = geometryStamp()

    const settle = () => {
      raf = 0
      transitRef.current = false
      const currentStamp = geometryStamp()
      if (currentStamp !== stamp) {
        stamp = currentStamp
        return
      }
      const currentItems = itemsRef.current
      if (currentItems.length === 0) return
      if (pendingPositionRef.current !== null) return
      const readKey = getKeyRef.current
      const modalOpen = document.querySelector('dialog[open]') !== null
      const active = document.activeElement
      const focusInControl =
        active instanceof HTMLElement &&
        scroller.contains(active) &&
        active.closest('a, button, input, textarea, select, [contenteditable="true"]') !== null
      let next = selectionRef.current
      if (!modalOpen && !focusInControl) {
        const card = nearestCard(scroller, axis, selectionRef.current.index)
        if (card !== null) {
          const index = Number(card.dataset['deckIndex'])
          const item = currentItems[index]
          if (Number.isInteger(index) && item !== undefined) next = { index, key: readKey(item) }
        }
      }
      const currentStateKey = stateKeyRef.current
      if (currentStateKey !== undefined) {
        const card = scroller.querySelector<HTMLElement>(`[data-deck-index="${next.index}"]`)
        deckPositions.set(currentStateKey, {
          axis: axisRef.current,
          index: next.index,
          key: next.key,
          offset: offsetOf(scroller, axisRef.current),
          anchor: card === null ? null : contentAnchor(card, scroller, axisRef.current),
        })
      }
      const changed =
        next.index !== selectionRef.current.index || next.key !== selectionRef.current.key
      if (!modalOpen && !focusInControl && changed) {
        setSelection(next)
        setAnnouncedIndex(next.index)
      }
    }

    if ('onscrollend' in window) {
      scroller.addEventListener('scrollend', settle)
      return () => {
        scroller.removeEventListener('scrollend', settle)
      }
    }

    const loop = () => {
      const current = offsetOf(scroller, axis)
      if (Math.abs(current - last) < 0.5) stable += 1
      else {
        stable = 0
        last = current
      }
      // two identical offsets mean the scroller has stopped moving
      if (stable >= 2) {
        settle()
        return
      }
      raf = requestAnimationFrame(loop)
    }
    const handleScroll = () => {
      if (raf !== 0) return
      stable = 0
      last = offsetOf(scroller, axis)
      raf = requestAnimationFrame(loop)
    }

    scroller.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', handleScroll)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [axis])

  useEffect(() => {
    loadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    if (!hasMore || loadingMore) return

    const scroller = scrollerRef.current
    const sentinel = sentinelRef.current
    if (scroller === null || sentinel === null) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) loadMoreRef.current?.()
      },
      { root: scroller, rootMargin: '500px' },
    )

    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, loadingMore])

  // a focused control inside a card would otherwise keep the keyboard while
  // the deck moves; move focus to the scroller without scrolling it
  const focusScroller = () => {
    const scroller = scrollerRef.current
    const active = document.activeElement
    if (
      scroller !== null &&
      active instanceof HTMLElement &&
      active !== scroller &&
      scroller.contains(active)
    ) {
      scroller.focus({ preventScroll: true })
    }
  }

  const moveTo = (index: number) => {
    focusScroller()
    const next = clampIndex(index, items.length)
    const item = items[next]
    transitRef.current = scrollBehavior === 'smooth'
    setSelection({ index: next, key: item === undefined ? null : getKey(item) })
    setAnnouncedIndex(next)
    scrollToIndex(next, scrollBehavior)
  }

  const exitDeck = () => {
    focusScroller()
    onExitStart?.()
  }

  const activateItem = (item: T, index: number) => {
    const card = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-deck-index="${index}"] .b-post-card`,
    )
    if (card !== null && card !== undefined) card.style.viewTransitionName = 'benday-post'

    // the installed dom types already describe the api; a browser without it
    // leaves the direct path in place
    const startViewTransition = document.startViewTransition

    if (typeof startViewTransition === 'function' && !reduceMotion) {
      startViewTransition.call(document, () => {
        flushSync(() => {
          onActivate?.(item, index)
        })
      })
      return
    }

    onActivate?.(item, index)
  }

  const handleKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented) return
    // an input method owns every key while it composes
    if (event.isComposing || event.keyCode === 229) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (isTypingTarget(event.target)) return
    if (document.querySelector('dialog[open]') !== null) return
    // a native control outside this deck keeps its own keys: the deck never
    // navigates on behalf of a focused link, button or editor elsewhere
    const scroller = scrollerRef.current
    if (
      scroller !== null &&
      event.target instanceof Node &&
      !scroller.contains(event.target) &&
      isInteractiveTarget(event.target)
    ) {
      return
    }
    // a deck letter or digit is a printable shortcut; turning them off leaves
    // the arrows, page keys and activation alone
    if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return

    const key = event.key
    // arrows follow the visual axis; j/k always follow reading order and h/l
    // only exist where there is a horizontal axis
    const backArrow = axis === 'x' ? key === 'ArrowLeft' : key === 'ArrowUp'
    const forwardArrow = axis === 'x' ? key === 'ArrowRight' : key === 'ArrowDown'
    const back = backArrow || key === 'k' || (horizontal && key === 'h')
    const forward = forwardArrow || key === 'j' || (horizontal && key === 'l')

    // an empty deck still exits with the unmodified back arrow; letters never
    // change route
    if (items.length === 0) {
      if (backArrow && !event.shiftKey) {
        event.preventDefault()
        // the first press already left this deck; a held key must not re-enter
        if (!event.repeat) onExitStart?.()
      }
      return
    }

    if (matchesBinding(event, DECK_POSITION)) {
      if (isInteractiveTarget(event.target)) return
      const index = Number(key) - 1
      if (index >= items.length) return
      event.preventDefault()
      moveTo(index)
      return
    }

    // Home and End are canonical, g and G are aliases; the G chord has no
    // shift constraint because the key already carries the produced character
    if (matchesBinding(event, DECK_ENDS)) {
      event.preventDefault()
      moveTo(key === 'End' || key === 'G' ? items.length - 1 : 0)
      return
    }

    const shiftArrow = event.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp')
    if (matchesBinding(event, DECK_SCROLL)) {
      const card = scrollerRef.current?.querySelector<HTMLElement>(
        `[data-deck-index="${focusIndex}"]`,
      )
      const direction = key === 'PageUp' || key === 'ArrowUp' ? -1 : 1
      const moved = scrollCardBody(card ?? null, direction)
      // the deck owns shifted arrows even when its body cannot move, so the key
      // never falls through to a page text selection; plain page keys still
      // release at a boundary
      if (shiftArrow || moved) event.preventDefault()
      return
    }

    if (event.shiftKey) return

    if (matchesBinding(event, DECK_OPEN)) {
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      // a held activation key must not reopen the same card again
      if (event.repeat) return
      const item = items[focusIndex]
      if (item !== undefined) activateItem(item, focusIndex)
      return
    }

    // a wide deck opens with ↓; a narrow deck keeps → beside enter
    const openKey = axis === 'x' ? 'ArrowDown' : 'ArrowRight'
    if (key === openKey) {
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      if (event.repeat) return
      const item = items[focusIndex]
      if (item !== undefined) activateItem(item, focusIndex)
      return
    }

    if (!matchesBinding(event, DECK_MOVE)) return
    if (!back && !forward) return
    event.preventDefault()
    if (back && focusIndex === 0) {
      // only the back arrow leaves the deck; held or not, h/j/k clamp
      if (backArrow && !event.repeat) exitDeck()
      return
    }
    moveTo(back ? focusIndex - 1 : focusIndex + 1)
  }

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  const classes = ['b-deck']
  if (className !== undefined) classes.push(className)

  const leadingItem =
    horizontal && hasLeadingPeek ? (
      <li
        className="b-deck__item b-deck__peek"
        aria-hidden={leadingPeekInteractive ? undefined : 'true'}
        style={
          {
            animationDelay: '45ms',
            zIndex: 96,
            '--deal-shift': '100%',
            '--deal-rotate': '-0.45deg',
          } as CSSProperties
        }
      >
        {leadingPeek}
      </li>
    ) : null

  const renderCard = (item: T, index: number) => {
    const isFocused = index === focusIndex
    const dealOffset = Math.max(-8, Math.min(8, index - focusIndex))
    return (
      <li
        key={getKey(item)}
        className="b-deck__item"
        data-deck-index={index}
        data-focused={isFocused ? 'true' : 'false'}
        aria-current={isFocused ? 'true' : undefined}
        style={
          {
            animationDelay: `${Math.min(Math.abs(dealOffset), 6) * 45}ms`,
            zIndex: 100 - Math.abs(dealOffset) * 2 - (dealOffset < 0 ? 1 : 0),
            '--deal-shift': `${-dealOffset * 100}%`,
            '--deal-rotate': `${dealOffset * 0.45}deg`,
          } as CSSProperties
        }
        onFocus={() => setSelection({ index, key: getKey(item) })}
      >
        {renderItem(item, index, isFocused)}
      </li>
    )
  }

  let content: ReactNode
  if (items.length > 0) {
    content = items.map(renderCard)
  } else if (pending) {
    content = SKELETONS.map((skeleton, skeletonIndex) => (
      <li
        key={skeleton.key}
        className="b-deck__skeleton"
        style={{ animationDelay: `${skeletonIndex * 60}ms, 0s` }}
        aria-hidden="true"
      >
        <span className="b-deck__skeleton-label">{skeleton.label}</span>
      </li>
    ))
  } else {
    content = (
      <li className="b-deck__empty">
        {empty ?? <EmptyState title="no cards" hint="nothing to show here yet" />}
      </li>
    )
  }

  const statusText =
    items.length === 0
      ? pending
        ? 'loading cards'
        : 'no cards'
      : `card ${clampIndex(announcedIndex, items.length) + 1} of ${items.length}`

  return (
    <>
      <ol
        ref={scrollerRef}
        className={classes.join(' ')}
        data-axis={axis}
        data-layout={layout}
        aria-label={label}
        aria-roledescription="card deck"
        tabIndex={0}
      >
        {leadingItem}
        {content}
        {loadingMore ? (
          <li className="b-deck__loading">
            <span className="b-deck__loading-text mono-label" role="status">
              loading more cards
            </span>
          </li>
        ) : null}
        {loadMoreError ? (
          <li className="b-deck__load-error">
            <span className="b-deck__load-error-text" role="alert">
              couldn&apos;t load more cards
            </span>
            <Button
              variant="ghost"
              className="b-deck__load-error-retry"
              aria-disabled={onRetryLoadMore === undefined || loadingMore ? 'true' : undefined}
              aria-busy={loadingMore ? 'true' : undefined}
              onClick={() => {
                if (onRetryLoadMore === undefined || loadingMore) return
                onRetryLoadMore()
              }}
            >
              retry
            </Button>
          </li>
        ) : null}
        {hasMore ? <li ref={sentinelRef} className="b-deck__sentinel" aria-hidden="true" /> : null}
      </ol>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {statusText}
      </p>
    </>
  )
}
