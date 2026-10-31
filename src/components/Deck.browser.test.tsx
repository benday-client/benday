import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { cardCountLabel, PROFILE_MODES } from '../lib/profileModes'
import { resultCountLabel, SEARCH_MODES } from '../lib/searchModes'
import type { PostModel } from '../lib/types'
import { longPostFixture, postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { renderStage, Stage } from '../test/stage'
import { Deck } from './Deck'
import { PostCard } from './PostCard'
import { RefreshCard } from './RefreshCard'
import { CardBackButton, cardBackIndex, ModeCard } from './ui'

const WIDE = { width: 1280, height: 800 } as const
const NARROW = { width: 390, height: 844 } as const

function post(id: string, text: string): PostModel {
  return postFixture({ uri: `at://did:plc:test/app.bsky.feed.post/${id}`, text })
}

const SHORT = post('short', 'short card body')
const SECOND = post('second', 'second card body')
const THIRD = post('third', 'third card body')
const FOURTH = post('fourth', 'fourth card body')
const FIFTH = post('fifth', 'fifth card body')
const SIXTH = post('sixth', 'sixth card body')
const MANY = Array.from({ length: 12 }, (_, index) => post(`rest-${index}`, 'short card body'))

async function settle(): Promise<void> {
  await new Promise<void>((done) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        done()
      })
    })
  })
}

function appShell(children: ReactNode) {
  const queryClient = createTestQueryClient()
  const memory = memoryLocation({ path: '/feed', record: true })
  return renderStage(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <section className="b-view">
          <div className="b-view__body">{children}</div>
        </section>
      </Router>
    </QueryClientProvider>,
  )
}

interface DeckHostOptions {
  leadingPeek?: ReactNode
  leadingPeekInteractive?: boolean
  stateKey?: string
  onActivate?: (post: PostModel) => void
  editor?: boolean
  layout?: 'deck' | 'list'
}

function renderPostDeck(posts: readonly PostModel[], options: DeckHostOptions = {}) {
  const queryClient = createTestQueryClient()
  const memory = memoryLocation({ path: '/feed', record: true })
  return renderStage(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <section className="b-view">
          <div className="b-view__body">
            <Deck
              items={posts}
              getKey={(item) => item.uri}
              renderItem={(item, index, focused) => (
                <PostCard
                  post={item}
                  index={index}
                  focused={focused}
                  onOpen={() => {
                    options.onActivate?.(item)
                  }}
                />
              )}
              onActivate={(item) => {
                options.onActivate?.(item)
              }}
              {...(options.leadingPeek === undefined ? {} : { leadingPeek: options.leadingPeek })}
              {...(options.leadingPeekInteractive === undefined
                ? {}
                : { leadingPeekInteractive: options.leadingPeekInteractive })}
              {...(options.stateKey === undefined ? {} : { stateKey: options.stateKey })}
              {...(options.layout === undefined ? {} : { layout: options.layout })}
              label="cards"
            />
          </div>
          {options.editor === true ? <textarea data-testid="editor" defaultValue="abcdef" /> : null}
        </section>
      </Router>
    </QueryClientProvider>,
  )
}

function deckOf(container: HTMLElement): HTMLElement {
  const deck = container.querySelector<HTMLElement>('.b-deck')
  if (deck === null) throw new Error('deck missing')
  return deck
}

function cardOf(container: HTMLElement, index: number): HTMLElement {
  const card = container.querySelector<HTMLElement>(`[data-deck-index="${index}"]`)
  if (card === null) throw new Error(`card ${index} missing`)
  return card
}

function visibleWidth(element: Element, deck: Element): number {
  const rect = element.getBoundingClientRect()
  const deckRect = deck.getBoundingClientRect()
  return Math.max(0, Math.min(rect.right, deckRect.right) - Math.max(rect.left, deckRect.left))
}

function visibleHeight(element: Element, deck: Element): number {
  const rect = element.getBoundingClientRect()
  const deckRect = deck.getBoundingClientRect()
  return Math.max(0, Math.min(rect.bottom, deckRect.bottom) - Math.max(rect.top, deckRect.top))
}

interface SelectionSnapshot {
  text: string
  start: number
  end: number
}

function selectionSnapshot(): SelectionSnapshot | null {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return { text: selection.toString(), start: range.startOffset, end: range.endOffset }
}

/** Selects a known nonempty run of card text and proves it really is selected. */
function selectCardText(scope: ParentNode): SelectionSnapshot {
  const block = scope.querySelector('.b-post-card__text')
  if (block === null) throw new Error('post text missing')
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let target: Text | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text && node.data.trim().length > 0) {
      target = node
      break
    }
  }
  if (target === null) throw new Error('no selectable text')
  const range = document.createRange()
  range.setStart(target, 0)
  range.setEnd(target, Math.min(5, target.data.length))
  const selection = document.getSelection()
  if (selection === null) throw new Error('selection unavailable')
  selection.removeAllRanges()
  selection.addRange(range)
  const snapshot = selectionSnapshot()
  if (snapshot === null || snapshot.text.length === 0) throw new Error('selection is empty')
  return snapshot
}

/** Registered after render, so it observes what the deck decided. */
function keyProbe() {
  let prevented = false
  const probe = (event: KeyboardEvent) => {
    prevented = event.defaultPrevented
  }
  window.addEventListener('keydown', probe)
  return {
    consumed: () => prevented,
    stop: () => {
      window.removeEventListener('keydown', probe)
    },
  }
}

/**
 * The suite runs with prefers-reduced-motion: reduce, so a transition could
 * never be observed. This is the seam that reports motion as allowed; layout,
 * scrolling and CSS are left untouched.
 */
function allowMotion(): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => {
    const list = original.call(window, query)
    if (query !== '(prefers-reduced-motion: reduce)') return list
    return new Proxy(list, {
      get(target, property) {
        if (property === 'matches') return false
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }) as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

async function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  requestAnimationFrame(() => {
    resolve()
  })
  return promise
}

/**
 * Samples the deck's offset every animation frame until it stops changing, so
 * an instant jump and an animated slide can be told apart by the samples
 * between the start and settled offsets.
 */
async function sampleScrollLeft(deck: HTMLElement, limit = 240): Promise<number[]> {
  const samples: number[] = [deck.scrollLeft]
  let stable = 0
  for (let frame = 0; frame < limit; frame += 1) {
    await nextFrame()
    const value = deck.scrollLeft
    samples.push(value)
    stable = Math.abs(value - (samples[samples.length - 2] ?? value)) < 0.5 ? stable + 1 : 0
    // wait out the slide plus a comfortable quiet tail
    if (stable >= 12 && samples.length > 12) break
  }
  return samples
}

function intermediate(samples: readonly number[], start: number, end: number): number[] {
  const low = Math.min(start, end)
  const high = Math.max(start, end)
  return samples.filter((value) => value > low + 1 && value < high - 1)
}

function expectFirstCardCentred(container: HTMLElement, deck: HTMLElement): void {
  const cardRect = cardOf(container, 0).getBoundingClientRect()
  const deckRect = deck.getBoundingClientRect()
  const padding = Number.parseFloat(getComputedStyle(deck).paddingLeft)
  const offCenter = Math.abs(
    cardRect.left + cardRect.width / 2 - (deckRect.left + deckRect.width / 2),
  )
  expect(offCenter).toBeLessThanOrEqual(padding + 1)

  const peek = container.querySelector('.b-deck__peek')
  if (peek === null) throw new Error('peek missing')
  const sliver = visibleWidth(peek, deck)
  const gap = Number.parseFloat(getComputedStyle(deck).columnGap)
  expect(sliver).toBeGreaterThan(20)
  expect(Math.abs(sliver - peek.getBoundingClientRect().width / 2)).toBeLessThanOrEqual(gap + 2)
}

beforeEach(async () => {
  await page.viewport(WIDE.width, WIDE.height)
})

describe('Deck shifted arrows over real post bodies', () => {
  it('consumes the key on a short card and keeps the native selection', async () => {
    const { container } = renderPostDeck([SHORT, SECOND])
    await settle()
    const before = selectCardText(container)

    const probe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    probe.stop()

    expect(probe.consumed()).toBe(true)
    expect(selectionSnapshot()).toEqual(before)
  })

  it('moves an overflowing body only when it can move', async () => {
    const { container } = renderPostDeck([longPostFixture({ uri: 'at://did:plc:test/x/long' })])
    await settle()
    const deck = deckOf(container)
    const body = container.querySelector<HTMLElement>('.b-post-card__body')
    if (body === null) throw new Error('post body missing')
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight + 100)
    const before = selectCardText(container)

    const firstProbe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    firstProbe.stop()
    expect(firstProbe.consumed()).toBe(true)
    expect(body.scrollTop).toBeGreaterThan(0)
    expect(selectionSnapshot()).toEqual(before)

    // mid body the offset keeps moving
    const mid = body.scrollTop
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(body.scrollTop).toBeGreaterThan(mid)

    // at the bottom and back at the top the key is still owned
    body.scrollTop = body.scrollHeight
    const bottomProbe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    bottomProbe.stop()
    expect(bottomProbe.consumed()).toBe(true)
    expect(Math.round(body.scrollTop)).toBe(Math.round(body.scrollHeight - body.clientHeight))
    expect(selectionSnapshot()).toEqual(before)

    body.scrollTop = 0
    const topProbe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
    topProbe.stop()
    expect(topProbe.consumed()).toBe(true)
    expect(body.scrollTop).toBe(0)
    expect(selectionSnapshot()).toEqual(before)
    expect(deck.dataset['axis']).toBe('x')
  })

  it('leaves shift+arrow to a native text editor', async () => {
    const { container } = renderPostDeck([SHORT], { editor: true })
    await settle()
    const editor = container.querySelector('textarea')
    if (editor === null) throw new Error('editor missing')
    editor.focus()
    editor.setSelectionRange(0, 2)
    expect(editor.value.slice(0, 2)).toBe('ab')

    const probe = keyProbe()
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    probe.stop()

    expect(probe.consumed()).toBe(false)
    expect(editor.selectionStart).toBe(0)
    expect(editor.selectionEnd).toBe(3)
  })
})

describe('Deck vertical arrows over real cards', () => {
  it('moves down and up without opening and opens with enter on a wide deck', async () => {
    const activated: string[] = []
    const { container } = renderPostDeck([SHORT, SECOND, THIRD], {
      onActivate: (item) => {
        activated.push(item.uri)
      },
    })
    await settle()
    const deck = deckOf(container)
    expect(deck.dataset['axis']).toBe('x')

    await userEvent.keyboard('{ArrowDown}')
    await settle()
    expect(cardOf(container, 1).dataset['focused']).toBe('true')
    expect(visibleWidth(cardOf(container, 1), deck)).toBeGreaterThan(40)
    expect(activated).toEqual([])

    await userEvent.keyboard('{ArrowUp}')
    await settle()
    expect(cardOf(container, 0).dataset['focused']).toBe('true')
    expect(activated).toEqual([])

    await userEvent.keyboard('{Enter}')
    expect(activated).toEqual([SHORT.uri])
  })
})

describe('Deck geometry', () => {
  it('centers the first card beside a visible peek sliver at 1280 and stacks at 800', async () => {
    const { container } = renderPostDeck([SHORT, SECOND, THIRD], {
      leadingPeek: <button type="button">peek</button>,
    })
    await settle()

    const deck = deckOf(container)
    const card = cardOf(container, 0)
    const peek = container.querySelector('.b-deck__peek')
    if (peek === null) throw new Error('peek missing')
    expect(deck.dataset['axis']).toBe('x')

    const deckRect = deck.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    expect(cardRect.width).toBeGreaterThan(deckRect.width / 3)
    const padding = Number.parseFloat(getComputedStyle(deck).paddingLeft)
    const offCenter = Math.abs(
      cardRect.left + cardRect.width / 2 - (deckRect.left + deckRect.width / 2),
    )
    expect(offCenter).toBeLessThanOrEqual(padding + 1)

    const sliver = visibleWidth(peek, deck)
    const gap = Number.parseFloat(getComputedStyle(deck).columnGap)
    expect(deck.scrollLeft).toBeGreaterThan(0)
    expect(sliver).toBeGreaterThan(20)
    // the peek sits one gap before the centered first card, so roughly half of
    // it stays visible
    expect(Math.abs(sliver - peek.getBoundingClientRect().width / 2)).toBeLessThanOrEqual(gap + 2)

    await page.viewport(800, 800)
    await settle()
    expect(deck.dataset['axis']).toBe('y')
    expect(getComputedStyle(deck).flexDirection).toBe('column')
    expect(container.querySelector('.b-deck__peek')).toBeNull()
    const stackedCard = cardOf(container, 0).getBoundingClientRect()
    expect(stackedCard.right).toBeLessThanOrEqual(800 + 1)
    expect(stackedCard.width).toBeGreaterThan(700)
  })

  it('re-centers the peek after a wide to narrow to wide round trip', async () => {
    const { container } = renderPostDeck([SHORT, SECOND], {
      leadingPeek: <button type="button">peek</button>,
    })
    await settle()

    const deck = deckOf(container)
    const peek = container.querySelector('.b-deck__peek')
    if (peek === null) throw new Error('peek missing')
    const beforeScroll = deck.scrollLeft
    const beforeSliver = visibleWidth(peek, deck)
    expect(beforeScroll).toBeGreaterThan(0)
    expect(beforeSliver).toBeGreaterThan(20)

    await page.viewport(800, 800)
    await settle()
    await page.viewport(WIDE.width, WIDE.height)
    await settle()

    // the narrow layout drops the peek element, so read the one that came back
    const restoredPeek = container.querySelector('.b-deck__peek')
    if (restoredPeek === null) throw new Error('peek not restored')
    expect(Math.abs(deck.scrollLeft - beforeScroll)).toBeLessThanOrEqual(1)
    expect(Math.abs(visibleWidth(restoredPeek, deck) - beforeSliver)).toBeLessThanOrEqual(1)
  })

  it('keeps the focused card in view and activates it across axis changes', async () => {
    const activated: string[] = []
    const { container } = renderPostDeck([SHORT, SECOND, THIRD, FOURTH], {
      leadingPeek: <button type="button">peek</button>,
      stateKey: 'axis-cards',
      onActivate: (item) => {
        activated.push(item.uri)
      },
    })
    await settle()

    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowRight}')
    await settle()
    const deck = deckOf(container)
    expect(cardOf(container, 2).dataset['focused']).toBe('true')
    expect(visibleWidth(cardOf(container, 2), deck)).toBeGreaterThan(40)

    // crossing the axis break must put the same card back in view
    await page.viewport(800, 800)
    await settle()
    expect(cardOf(container, 2).dataset['focused']).toBe('true')
    expect(visibleHeight(cardOf(container, 2), deck)).toBeGreaterThan(40)

    await page.viewport(WIDE.width, WIDE.height)
    await settle()
    expect(cardOf(container, 2).dataset['focused']).toBe('true')
    expect(visibleWidth(cardOf(container, 2), deck)).toBeGreaterThan(40)

    await userEvent.keyboard('{Enter}')
    expect(activated).toEqual([THIRD.uri])
  })

  it('paints the real focus indicator, including the cyberpunk replacement', async () => {
    const { container } = renderPostDeck([SHORT, SECOND])
    await settle()

    const frame = cardOf(container, 0).querySelector<HTMLElement>('.b-frame')
    if (frame === null) throw new Error('focused frame missing')
    const normal = getComputedStyle(frame)
    expect(normal.outlineStyle).toBe('solid')
    expect(Number.parseFloat(normal.outlineWidth)).toBeGreaterThan(0)
    expect(normal.outlineColor).not.toBe('rgba(0, 0, 0, 0)')
    // the double rule: one hairline on the edge and one tucked three pixels in
    expect(normal.outlineOffset).toBe('-3px')
    expect(normal.boxShadow).toContain('inset')

    document.documentElement.dataset['theme'] = 'cyberpunk'
    const cyber = getComputedStyle(frame)
    // the shared rule survives the clipped theme; cyberpunk adds its glow
    expect(cyber.outlineStyle).toBe('solid')
    expect(cyber.boxShadow).toContain('inset')
    expect(cyber.filter).toContain('drop-shadow')
  })
})

describe('Deck with shared mode cards', () => {
  function renderModeDeck(domain: 'profile' | 'search', onPeek: () => void, onSelect: () => void) {
    type ModeEntry = { mode: string; name: string; description: string }
    const modes: readonly ModeEntry[] = domain === 'profile' ? PROFILE_MODES : SEARCH_MODES
    return appShell(
      <Deck
        items={modes}
        getKey={(option) => option.mode}
        renderItem={(option, index) => (
          <ModeCard
            label={domain === 'profile' ? 'mode' : 'search'}
            name={option.name}
            description={option.description}
            active={index === 0}
            countLabel={
              domain === 'profile'
                ? option.mode === 'profile'
                  ? null
                  : cardCountLabel(index + 1)
                : resultCountLabel(index + 2)
            }
            activeHint={domain === 'profile' ? '← modes' : 'current'}
            onSelect={onSelect}
          />
        )}
        leadingPeek={
          <CardBackButton
            label="modes"
            meta={domain === 'profile' ? 'profile' : 'posts'}
            index={cardBackIndex(3)}
            title={domain === 'profile' ? 'profile' : 'posts'}
            detail={domain === 'profile' ? '@test.bsky.social' : 'results'}
            hint="← modes"
            ariaLabel="change mode"
            onClick={onPeek}
          />
        }
        leadingPeekInteractive
        label={`${domain} modes`}
      />,
    )
  }

  function expectModeDeckFilled(container: HTMLElement, count: number, axis: 'x' | 'y'): void {
    const deck = deckOf(container)
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.b-mode-card'))
    expect(cards).toHaveLength(count)
    expect(deck.dataset['axis']).toBe(axis)

    for (const [index, card] of cards.entries()) {
      const slot = cardOf(container, index).getBoundingClientRect()
      const rect = card.getBoundingClientRect()
      expect(rect.width).toBeGreaterThan(slot.width - 2)
      expect(rect.height).toBeGreaterThan(slot.height - 2)
      expect(rect.width).toBeGreaterThan(0)
    }

    // the starting card fills the available box on both axes
    const deckRect = deck.getBoundingClientRect()
    const first = cards[0]?.getBoundingClientRect()
    const second = cards[1]?.getBoundingClientRect()
    if (first === undefined || second === undefined) throw new Error('mode cards missing')
    expect(first.left).toBeGreaterThanOrEqual(deckRect.left - 1)
    expect(first.right).toBeLessThanOrEqual(deckRect.right + 1)
    expect(first.top).toBeGreaterThanOrEqual(deckRect.top - 1)
    expect(first.bottom).toBeLessThanOrEqual(deckRect.bottom + 1)

    if (axis === 'x') {
      expect(Math.abs(first.top - second.top)).toBeLessThanOrEqual(1)
      expect(second.left).toBeGreaterThanOrEqual(first.right - 1)
    } else {
      expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1)
    }
  }

  it('fills the profile mode cards and keeps the peek reachable at both widths', async () => {
    const onPeek = vi.fn()
    const onSelect = vi.fn()
    const { container } = renderModeDeck('profile', onPeek, onSelect)
    await settle()

    expectModeDeckFilled(container, PROFILE_MODES.length, 'x')
    const deck = deckOf(container)
    const active = container.querySelector<HTMLElement>('.b-mode-card[data-active="true"]')
    const idle = container.querySelector<HTMLElement>('.b-mode-card[data-active="false"]')
    if (active === null || idle === null) throw new Error('mode cards missing')
    expect(getComputedStyle(active).borderTopColor).not.toBe(getComputedStyle(idle).borderTopColor)
    expect(active.querySelector('.b-mode-card__hint')?.textContent).toBe('← modes')
    const focusedFrame = cardOf(container, 0).querySelector<HTMLElement>('.b-frame')
    if (focusedFrame === null) throw new Error('focused mode card missing')
    expect(getComputedStyle(focusedFrame).outlineStyle).toBe('solid')

    const peek = screen.getByRole('button', { name: 'change mode' })
    expect(visibleWidth(peek, deck)).toBeGreaterThan(20)
    await userEvent.click(peek)
    expect(onPeek).toHaveBeenCalledTimes(1)

    await page.viewport(NARROW.width, NARROW.height)
    await settle()
    expect(deck.dataset['axis']).toBe('y')
    expectModeDeckFilled(container, PROFILE_MODES.length, 'y')
    expect(container.querySelector('.b-deck__peek')).toBeNull()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(NARROW.width + 1)
  })

  it('fills the search mode cards and shows fetched counts', async () => {
    const onSelect = vi.fn()
    const { container } = renderModeDeck('search', vi.fn(), onSelect)
    await settle()

    expectModeDeckFilled(container, SEARCH_MODES.length, 'x')
    expect(screen.getByText('2 results')).toBeInTheDocument()
    expect(screen.getByText('3 results')).toBeInTheDocument()
    const active = container.querySelector<HTMLElement>('.b-mode-card[data-active="true"]')
    if (active === null) throw new Error('active search card missing')
    expect(active.querySelector('.b-mode-card__hint')?.textContent).toBe('current')
    // the profile-only card hides its count; every search card shows one
    expect(container.querySelectorAll('.b-mode-card__count')).toHaveLength(SEARCH_MODES.length)

    await userEvent.click(screen.getByRole('button', { name: 'show feeds' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('keeps a refresh footer reachable at the end of a content deck', async () => {
    const onRefresh = vi.fn()
    const items = [
      { kind: 'post' as const, post: SHORT },
      { kind: 'post' as const, post: SECOND },
      { kind: 'refresh' as const },
    ]
    const { container } = appShell(
      <Deck
        items={items}
        getKey={(item) => (item.kind === 'refresh' ? 'refresh' : item.post.uri)}
        renderItem={(item, index, focused) =>
          item.kind === 'refresh' ? (
            <RefreshCard index={index} focused={focused} onRefresh={onRefresh} />
          ) : (
            <PostCard post={item.post} index={index} focused={focused} />
          )
        }
        label="cards"
      />,
    )
    await settle()

    const deck = deckOf(container)
    const refresh = screen.getByLabelText('refresh feed')
    expect(refresh.textContent).toContain('[02]')
    deck.scrollTop = deck.scrollHeight
    await settle()
    expect(visibleHeight(refresh, deck)).toBeGreaterThan(40)

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

function SwapDeck(props: {
  posts: readonly PostModel[]
  peek: ReactNode | null
  stateKey: string
  pending: boolean
}) {
  return (
    <Deck
      items={props.posts}
      getKey={(item) => item.uri}
      renderItem={(item, index, focused) => (
        <PostCard post={item} index={index} focused={focused} onOpen={() => undefined} />
      )}
      {...(props.peek === null ? {} : { leadingPeek: props.peek })}
      pending={props.pending}
      stateKey={props.stateKey}
      label="cards"
    />
  )
}

interface SwapProps {
  posts: readonly PostModel[]
  peek: ReactNode | null
  stateKey: string
  pending: boolean
}

function swapShell(
  memory: ReturnType<typeof memoryLocation>,
  queryClient: ReturnType<typeof createTestQueryClient>,
  props: SwapProps,
): ReactNode {
  return (
    <Stage>
      <QueryClientProvider client={queryClient}>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <section className="b-view">
            <div className="b-view__body">
              <SwapDeck {...props} />
            </div>
          </section>
        </Router>
      </QueryClientProvider>
    </Stage>
  )
}

describe('Deck position memory', () => {
  it('centres the restored card when items were prepended', async () => {
    const first = renderPostDeck([SHORT, SECOND, THIRD, FOURTH], {
      stateKey: 'prepend-memory',
    })
    await settle()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowRight}')
    await settle()
    expect(cardOf(first.container, 2).dataset['focused']).toBe('true')
    first.unmount()

    const { container } = renderPostDeck([FIFTH, SIXTH, SHORT, SECOND, THIRD, FOURTH], {
      stateKey: 'prepend-memory',
    })
    await settle()
    await settle()
    const deck = deckOf(container)
    // the saved key resolves to a new index; the old offsets would leave it
    // off centre, so the restore has to bring that card into view
    expect(cardOf(container, 4).dataset['focused']).toBe('true')
    const cardRect = cardOf(container, 4).getBoundingClientRect()
    const deckRect = deck.getBoundingClientRect()
    const offCentre = Math.abs(
      cardRect.left + cardRect.width / 2 - (deckRect.left + deckRect.width / 2),
    )
    expect(offCentre).toBeLessThanOrEqual(16)
  })
})

describe('Deck peek resting position', () => {
  it("keeps the leading peek out of the deck's snap points across a swap", async () => {
    const queryClient = createTestQueryClient()
    const memory = memoryLocation({ path: '/feed', record: true })
    const peek = <button type="button">peek</button>
    const staged = (props: SwapProps) => swapShell(memory, queryClient, props)

    const { container, rerender } = render(
      staged({ posts: [SHORT, SECOND, THIRD], peek, stateKey: 'swap-a', pending: false }),
    )
    await settle()
    const deck = deckOf(container)
    expectFirstCardCentred(container, deck)
    const peekElement = container.querySelector('.b-deck__peek')
    if (peekElement === null) throw new Error('peek missing')
    // the sliver is a peek, not a resting card: snapping to it lets the browser
    // rest the deck on the switcher card after the login swap
    expect(getComputedStyle(peekElement).scrollSnapAlign).toBe('none')

    // the login transition drops the peek while the signed-in page is pending;
    // the swap resets the deck's offset and the browser re-runs snapping
    rerender(staged({ posts: [], peek: null, stateKey: 'swap-b', pending: true }))
    await settle()
    expect(Math.round(deck.scrollLeft)).toBe(0)

    rerender(staged({ posts: [SHORT, SECOND, THIRD], peek, stateKey: 'swap-b', pending: false }))
    await settle()
    await settle()
    expectFirstCardCentred(container, deck)
    expect(
      getComputedStyle(container.querySelector('.b-deck__peek') as Element).scrollSnapAlign,
    ).toBe('none')
  })

  it('does not centre the leading peek while the first page is pending', async () => {
    const queryClient = createTestQueryClient()
    const memory = memoryLocation({ path: '/feed', record: true })
    const peek = <button type="button">peek</button>
    const staged = (props: SwapProps) => swapShell(memory, queryClient, props)

    const { container, rerender } = render(
      staged({ posts: [], peek, stateKey: 'pending-a', pending: true }),
    )
    await settle()
    const deck = deckOf(container)
    const peekElement = container.querySelector('.b-deck__peek')
    if (peekElement === null) throw new Error('peek missing')
    const peekRect = peekElement.getBoundingClientRect()
    const deckRect = deck.getBoundingClientRect()
    // the skeletons have no card to centre yet, so the peek keeps the left slot
    // instead of the leading spacer pushing the switcher card into the middle
    expect(
      Math.abs(peekRect.left + peekRect.width / 2 - (deckRect.left + deckRect.width / 2)),
    ).toBeGreaterThan(100)

    rerender(staged({ posts: [SHORT, SECOND, THIRD], peek, stateKey: 'pending-a', pending: false }))
    await settle()
    await settle()
    expectFirstCardCentred(container, deck)
  })
})

describe('Deck first-card motion', () => {
  it('slides back onto the centered first card instead of snapping', async () => {
    const restoreMotion = allowMotion()
    try {
      const { container } = renderPostDeck([SHORT, SECOND, THIRD], {
        leadingPeek: <button type="button">peek</button>,
        leadingPeekInteractive: true,
        stateKey: 'first-card-motion',
      })
      await settle()
      const deck = deckOf(container)
      expect(deck.dataset['axis']).toBe('x')
      // the first centring is instant now; sampling just confirms it settled
      await sampleScrollLeft(deck)

      // walk to the second card and let that move settle
      await userEvent.keyboard('{ArrowRight}')
      await sampleScrollLeft(deck)
      expect(cardOf(container, 1).dataset['focused']).toBe('true')

      // an axis round trip (a rotation or a window resize) re-arms the peek
      // centring, exactly like a fresh mount does
      await page.viewport(NARROW.width, NARROW.height)
      await settle()
      expect(deck.dataset['axis']).toBe('y')
      await page.viewport(WIDE.width, WIDE.height)
      await settle()
      expect(deck.dataset['axis']).toBe('x')
      expect(cardOf(container, 1).dataset['focused']).toBe('true')
      const settledOnSecond = deck.scrollLeft
      expect(settledOnSecond).toBeGreaterThan(40)

      // 01 -> 00 must animate like every other move
      const start = settledOnSecond
      await userEvent.keyboard('{ArrowLeft}')
      const samples = await sampleScrollLeft(deck)
      const end = samples[samples.length - 1] ?? start
      expect(cardOf(container, 0).dataset['focused']).toBe('true')
      expect(end).toBeLessThan(settledOnSecond - 40)
      expect(intermediate(samples, start, end).length).toBeGreaterThan(0)
      expectFirstCardCentred(container, deck)

      // guard: 00 -> 01 keeps its slide
      const forwardStart = deck.scrollLeft
      await userEvent.keyboard('{ArrowRight}')
      const forwardSamples = await sampleScrollLeft(deck)
      const forwardEnd = forwardSamples[forwardSamples.length - 1] ?? forwardStart
      expect(cardOf(container, 1).dataset['focused']).toBe('true')
      expect(forwardEnd).toBeGreaterThan(forwardStart + 40)
      expect(intermediate(forwardSamples, forwardStart, forwardEnd).length).toBeGreaterThan(0)
    } finally {
      restoreMotion()
    }
  })
})

describe('Deck live selection', () => {
  it('takes the resting pointer card as current without moving focus', async () => {
    await page.viewport(NARROW.width, NARROW.height)
    const { container } = renderPostDeck(MANY, { layout: 'list' })
    await settle()
    const deck = deckOf(container)
    expect(deck.dataset['axis']).toBe('y')

    // list rows stack one per row, so the nearest row start is unambiguous
    const target = cardOf(container, 3)
    deck.scrollTop =
      target.getBoundingClientRect().top - deck.getBoundingClientRect().top + deck.scrollTop
    await settle()
    await settle()

    expect(deck.contains(document.activeElement)).toBe(false)
    expect(target.dataset['focused']).toBe('true')
    expect(target.getAttribute('aria-current')).toBe('true')
  })

  it('leaves the logical card alone while focus sits in an in-card control', async () => {
    await page.viewport(NARROW.width, NARROW.height)
    const { container } = renderPostDeck(MANY, { layout: 'list' })
    await settle()
    const deck = deckOf(container)
    const control = cardOf(container, 0).querySelector<HTMLElement>('a, button')
    if (control === null) throw new Error('card control missing')
    control.focus()

    const target = cardOf(container, 3)
    deck.scrollTop =
      target.getBoundingClientRect().top - deck.getBoundingClientRect().top + deck.scrollTop
    await settle()
    await settle()

    expect(document.activeElement).toBe(control)
    expect(cardOf(container, 0).dataset['focused']).toBe('true')
  })

  it('keeps a no-stateKey chooser on the same card across a resize', async () => {
    const { container } = renderPostDeck([SHORT, SECOND, THIRD, FOURTH], {
      leadingPeek: <button type="button">peek</button>,
    })
    await settle()
    await userEvent.keyboard('{ArrowRight}')
    await settle()
    expect(cardOf(container, 1).dataset['focused']).toBe('true')

    await page.viewport(NARROW.width, NARROW.height)
    await settle()
    expect(deckOf(container).dataset['axis']).toBe('y')
    expect(cardOf(container, 1).dataset['focused']).toBe('true')
    expect(visibleHeight(cardOf(container, 1), deckOf(container))).toBeGreaterThan(40)

    await page.viewport(WIDE.width, WIDE.height)
    await settle()
    expect(cardOf(container, 1).dataset['focused']).toBe('true')
    expect(visibleWidth(cardOf(container, 1), deckOf(container))).toBeGreaterThan(40)
  })
})

describe('Deck position restore', () => {
  it('replays a y offset when the layout is unchanged', async () => {
    await page.viewport(NARROW.width, NARROW.height)
    const first = renderPostDeck(MANY, { stateKey: 'y-offset' })
    await settle()
    const deck = deckOf(first.container)
    // a middle rest moves the deck away from its opening offset
    deck.scrollTop = deck.scrollHeight / 2
    await settle()
    await settle()
    const saved = deck.scrollTop
    expect(saved).toBeGreaterThan(0)
    first.unmount()

    const { container } = renderPostDeck(MANY, { stateKey: 'y-offset' })
    await settle()
    await settle()
    expect(Math.abs(deckOf(container).scrollTop - saved)).toBeLessThanOrEqual(2)
  })

  it('centres an x rest even when the deck was resized', async () => {
    await page.viewport(WIDE.width, WIDE.height)
    const first = renderPostDeck([SHORT, SECOND, THIRD, FOURTH], {
      stateKey: 'x-centre',
      leadingPeek: <button type="button">peek</button>,
    })
    await settle()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowRight}')
    await settle()
    expect(cardOf(first.container, 2).dataset['focused']).toBe('true')
    first.unmount()

    await page.viewport(1024, 800)
    const { container } = renderPostDeck([SHORT, SECOND, THIRD, FOURTH], {
      stateKey: 'x-centre',
      leadingPeek: <button type="button">peek</button>,
    })
    await settle()
    await settle()
    const cardRect = cardOf(container, 2).getBoundingClientRect()
    const deckRect = deckOf(container).getBoundingClientRect()
    const offCentre = Math.abs(
      cardRect.left + cardRect.width / 2 - (deckRect.left + deckRect.width / 2),
    )
    expect(cardOf(container, 2).dataset['focused']).toBe('true')
    expect(offCentre).toBeLessThanOrEqual(20)
  })

  it('reveals a restored card instantly when the items shifted around it', async () => {
    const restoreMotion = allowMotion()
    try {
      await page.viewport(NARROW.width, NARROW.height)
      const first = renderPostDeck([SHORT, SECOND, THIRD, FOURTH], { stateKey: 'reveal-shift' })
      await settle()
      await userEvent.keyboard('j')
      await userEvent.keyboard('j')
      await settle()
      expect(cardOf(first.container, 2).dataset['focused']).toBe('true')
      first.unmount()

      const { container } = renderPostDeck([FIFTH, SHORT, SECOND, THIRD, FOURTH], {
        stateKey: 'reveal-shift',
      })
      await settle()
      const deck = deckOf(container)
      const settled = deck.scrollTop
      await nextFrame()
      await nextFrame()
      // the shifted card is revealed with the instant path, not slid into place
      expect(Math.abs(deck.scrollTop - settled)).toBeLessThanOrEqual(1)
      expect(cardOf(container, 3).dataset['focused']).toBe('true')
      expect(visibleHeight(cardOf(container, 3), deck)).toBeGreaterThan(40)
    } finally {
      restoreMotion()
    }
  })
})

describe('Deck tile floor and list layout', () => {
  it('keeps the 320px tile floor at a short viewport', async () => {
    await page.viewport(320, 256)
    const { container } = renderPostDeck([SHORT, SECOND, THIRD])
    await settle()
    const deck = deckOf(container)
    expect(deck.dataset['axis']).toBe('y')
    expect(deck.dataset['layout']).toBe('deck')
    expect(cardOf(container, 0).getBoundingClientRect().height).toBeGreaterThanOrEqual(319)
  })

  it('keeps list rows content-height at a short viewport', async () => {
    await page.viewport(320, 256)
    const tiled = renderPostDeck([SHORT, SECOND, THIRD])
    await settle()
    const tiledHeight = cardOf(tiled.container, 0).getBoundingClientRect().height
    tiled.unmount()

    const list = renderPostDeck([SHORT, SECOND, THIRD], { layout: 'list' })
    await settle()
    const deck = deckOf(list.container)
    expect(deck.dataset['layout']).toBe('list')
    const row = cardOf(list.container, 0)
    expect(getComputedStyle(row).flexBasis).toBe('auto')
    expect(row.getBoundingClientRect().height).toBeLessThan(tiledHeight)
  })
})
