// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the deck is a focusable scroll region
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
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
  stateKey?: string
}

interface DeckPosition {
  index: number
  left: number
  top: number
}

const deckPositions = new Map<string, DeckPosition>()

const PAGE_SIZE = 4

const SKELETONS = [
  { key: 'skeleton-1', label: 'loading card' },
  { key: 'skeleton-2', label: 'loading card' },
  { key: 'skeleton-3', label: 'loading card' },
  { key: 'skeleton-4', label: 'loading card' },
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
  pending = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  empty,
  label,
  className,
  initialIndex,
  stateKey,
}: DeckProps<T>): ReactElement {
  const flow = useSettings((state) => state.flow)
  const wide = useMediaQuery('(min-width: 900px)')
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  const horizontal = wide || flow === 'horizontal'
  const axis = horizontal ? 'x' : 'y'

  const remembered = stateKey === undefined ? undefined : deckPositions.get(stateKey)
  const [focused, setFocused] = useState(remembered?.index ?? initialIndex ?? 0)
  const focusIndex = items.length === 0 ? 0 : Math.min(focused, items.length - 1)

  const scrollerRef = useRef<HTMLOListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)
  const loadMoreRef = useRef(onLoadMore)
  const pendingPositionRef = useRef<DeckPosition | null>(remembered ?? null)
  const lastPositionRef = useRef<DeckPosition | null>(remembered ?? null)
  const initialAppliedRef = useRef(remembered !== undefined || initialIndex === undefined)
  const initialIndexRef = useRef(initialIndex)

  useEffect(() => {
    initialIndexRef.current = initialIndex
  }, [initialIndex])

  useEffect(() => {
    const position = stateKey === undefined ? undefined : deckPositions.get(stateKey)
    const index = initialIndexRef.current
    pendingPositionRef.current = position ?? null
    lastPositionRef.current = position ?? null
    initialAppliedRef.current = position !== undefined || index === undefined
    setFocused(position?.index ?? index ?? 0)
  }, [stateKey])

  useEffect(() => {
    const position = pendingPositionRef.current
    if (position === null || items.length === 0) return

    pendingPositionRef.current = null
    setFocused(Math.min(position.index, items.length - 1))

    const scroller = scrollerRef.current
    if (scroller !== null) {
      scroller.scrollLeft = position.left
      scroller.scrollTop = position.top
    }
  }, [items.length, stateKey])

  useEffect(() => {
    if (initialAppliedRef.current) return
    if (initialIndex === undefined || items.length === 0) return

    initialAppliedRef.current = true
    const index = Math.min(Math.max(initialIndex, 0), items.length - 1)
    setFocused(index)
    scrollToIndex(index, 'auto')
  }, [initialIndex, items.length, horizontal])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || stateKey === undefined) return

    const save = () => {
      const position = {
        index: focusIndex,
        left: scroller.scrollLeft,
        top: scroller.scrollTop,
      }
      lastPositionRef.current = position
      deckPositions.set(stateKey, position)
    }

    save()
    scroller.addEventListener('scroll', save, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', save)
      if (lastPositionRef.current !== null) {
        deckPositions.set(stateKey, lastPositionRef.current)
      }
    }
  }, [stateKey, focusIndex])

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

  const scrollToIndex = (index: number, behavior: ScrollBehavior) => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const target = horizontal
      ? scroller.querySelector<HTMLElement>(`[data-deck-page="${Math.floor(index / PAGE_SIZE)}"]`)
      : scroller.querySelector<HTMLElement>(`[data-deck-index="${index}"]`)
    if (target === null || typeof target.scrollIntoView !== 'function') return

    target.scrollIntoView({
      block: 'nearest',
      inline: horizontal ? 'start' : 'center',
      behavior,
    })
  }

  const moveTo = (index: number) => {
    const next = Math.min(items.length - 1, Math.max(0, index))
    setFocused(next)
    scrollToIndex(next, reduceMotion ? 'auto' : 'smooth')
  }

  const handleKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (isTypingTarget(event.target)) return
    if (useUiStore.getState().themeMenuOpen) return
    if (document.querySelector('dialog[open]') !== null) return
    if (items.length === 0) return

    const key = event.key

    if (key === 'g' || key === 'G') {
      event.preventDefault()
      moveTo(key === 'G' ? items.length - 1 : 0)
      return
    }

    if (event.shiftKey) return

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
      if (isInteractiveTarget(event.target)) return
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

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  const classes = ['b-deck']
  if (className !== undefined) classes.push(className)

  const renderCard = (item: T, index: number) => {
    const isFocused = index === focusIndex
    return (
      <li
        key={getKey(item)}
        className="b-deck__item"
        data-deck-index={index}
        data-focused={isFocused ? 'true' : 'false'}
        onFocus={() => setFocused(index)}
        onPointerEnter={() => {
          if (document.documentElement.dataset['input'] === 'keyboard') return
          setFocused(index)
        }}
      >
        {renderItem(item, index, isFocused)}
      </li>
    )
  }

  let content: ReactNode
  if (items.length > 0) {
    if (horizontal) {
      const pages: T[][] = []
      for (let index = 0; index < items.length; index += PAGE_SIZE) {
        pages.push(items.slice(index, index + PAGE_SIZE))
      }
      content = pages.map((page, pageIndex) => (
        <li
          key={`page:${pageIndex}`}
          className="b-deck__page"
          data-deck-page={pageIndex}
          role="presentation"
        >
          <ol className="b-deck__grid" aria-label={`${label} page ${pageIndex + 1}`}>
            {page.map((item, offset) => renderCard(item, pageIndex * PAGE_SIZE + offset))}
          </ol>
        </li>
      ))
    } else {
      content = items.map(renderCard)
    }
  } else if (pending) {
    content = horizontal ? (
      <li className="b-deck__page" data-deck-page="0" role="presentation">
        <ol className="b-deck__grid" aria-label={`${label} loading`}>
          {SKELETONS.map((skeleton) => (
            <li key={skeleton.key} className="b-deck__skeleton" aria-hidden="true">
              <span className="b-deck__skeleton-label">{skeleton.label}</span>
            </li>
          ))}
        </ol>
      </li>
    ) : (
      SKELETONS.map((skeleton) => (
        <li key={skeleton.key} className="b-deck__skeleton" aria-hidden="true">
          <span className="b-deck__skeleton-label">{skeleton.label}</span>
        </li>
      ))
    )
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
    >
      {content}
      {hasMore ? <li ref={sentinelRef} className="b-deck__sentinel" aria-hidden="true" /> : null}
    </ol>
  )
}
