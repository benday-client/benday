// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the deck is a focusable scroll region
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSettings } from '../lib/store'
import { EmptyState } from './ui'

export interface DeckProps<T> {
  items: readonly T[]
  getKey: (item: T) => string
  renderItem: (item: T, index: number, focused: boolean) => ReactNode
  onActivate?: (item: T, index: number) => void
  pending?: boolean
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  empty?: ReactNode
  label: string
  className?: string
  initialIndex?: number
}

const SKELETONS = [
  { key: 'skeleton-1', label: 'loading card' },
  { key: 'skeleton-2', label: 'loading card' },
  { key: 'skeleton-3', label: 'loading card' },
] as const

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('a, button, input, textarea, select') !== null
}

export function Deck<T>({
  items,
  getKey,
  renderItem,
  onActivate,
  pending = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  empty,
  label,
  className,
  initialIndex,
}: DeckProps<T>): ReactElement {
  const flow = useSettings((state) => state.flow)
  const wide = useMediaQuery('(min-width: 900px)')
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  const horizontal = flow === 'horizontal' || (flow === 'auto' && wide)
  const axis = horizontal ? 'x' : 'y'

  const [focused, setFocused] = useState(initialIndex ?? 0)
  const focusIndex = items.length === 0 ? 0 : Math.min(focused, items.length - 1)

  const scrollerRef = useRef<HTMLOListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)
  const loadMoreRef = useRef(onLoadMore)

  useEffect(() => {
    if (initialIndex === undefined) return
    const index = Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0))
    setFocused(index)
    const card = scrollerRef.current?.querySelector<HTMLElement>(`[data-deck-index="${index}"]`)
    if (card !== null && card !== undefined && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
    }
  }, [initialIndex, items.length])

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

  const moveTo = (index: number) => {
    const next = Math.min(items.length - 1, Math.max(0, index))
    setFocused(next)

    const scroller = scrollerRef.current
    if (scroller === null) return
    const card = scroller.querySelector<HTMLElement>(`[data-deck-index="${next}"]`)
    if (card === null || typeof card.scrollIntoView !== 'function') return

    card.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (isEditableTarget(event.target)) return
    if (items.length === 0) return

    const key = event.key

    if (key === 'Home') {
      event.preventDefault()
      moveTo(0)
      return
    }

    if (key === 'End') {
      event.preventDefault()
      moveTo(items.length - 1)
      return
    }

    if (key === 'Enter' || key === ' ') {
      const item = items[focusIndex]
      if (item !== undefined) onActivate?.(item, focusIndex)
      event.preventDefault()
      return
    }

    const back =
      axis === 'x' ? key === 'ArrowLeft' || key === 'h' : key === 'ArrowUp' || key === 'k'
    const forward =
      axis === 'x' ? key === 'ArrowRight' || key === 'l' : key === 'ArrowDown' || key === 'j'

    if (!back && !forward) return
    event.preventDefault()
    moveTo(back ? focusIndex - 1 : focusIndex + 1)
  }

  const classes = ['b-deck']
  if (className !== undefined) classes.push(className)

  let content: ReactNode
  if (items.length > 0) {
    content = items.map((item, index) => {
      const isFocused = index === focusIndex
      return (
        <li
          key={getKey(item)}
          className="b-deck__item"
          data-deck-index={index}
          data-focused={isFocused ? 'true' : 'false'}
          onFocus={() => setFocused(index)}
          onPointerEnter={() => setFocused(index)}
        >
          {renderItem(item, index, isFocused)}
        </li>
      )
    })
  } else if (pending) {
    content = SKELETONS.map((skeleton) => (
      <li key={skeleton.key} className="b-deck__skeleton" aria-hidden="true">
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

  return (
    <ol
      ref={scrollerRef}
      className={classes.join(' ')}
      data-axis={axis}
      aria-label={label}
      aria-roledescription="card deck"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {content}
      {hasMore ? <li ref={sentinelRef} className="b-deck__sentinel" aria-hidden="true" /> : null}
    </ol>
  )
}
