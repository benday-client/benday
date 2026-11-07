import { fireEvent, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../lib/store'
import { Deck } from './Deck'

const ITEMS = ['a', 'b', 'c']

function stubWide(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('900px'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

function deck(items: string[], onExitStart: () => void): ReactNode {
  return (
    <Deck
      items={items}
      getKey={(item) => item}
      renderItem={(item) => <button type="button">open {item}</button>}
      onExitStart={onExitStart}
      label="cards"
    />
  )
}

function focusedIndex(container: HTMLElement): string | null {
  return (
    container
      .querySelector('.b-deck__item[data-focused="true"]')
      ?.getAttribute('data-deck-index') ?? null
  )
}

beforeEach(() => {
  stubWide(true)
})

describe('Deck keyboard', () => {
  it('exits with the axis-back key even when there are no cards', () => {
    const onExitStart = vi.fn()
    render(deck([], onExitStart))

    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    expect(onExitStart).toHaveBeenCalledTimes(1)
  })

  it('exits an empty narrow deck with the up arrow too', () => {
    stubWide(false)
    const onExitStart = vi.fn()
    render(deck([], onExitStart))

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    expect(onExitStart).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the scroller before it moves a card', () => {
    const onExitStart = vi.fn()
    const { container } = render(deck(ITEMS, onExitStart))
    const child = container.querySelector('button')
    if (child === null) throw new Error('card control missing')
    child.focus()
    expect(document.activeElement).toBe(child)

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    // focus left the card control, so Enter now activates the new card
    expect(document.activeElement).toBe(container.querySelector('.b-deck'))
    expect(focusedIndex(container)).toBe('1')
  })

  it('clamps focus when cards shrink and resets when they empty', () => {
    const onExitStart = vi.fn()
    const { container, rerender } = render(deck(ITEMS, onExitStart))
    fireEvent.keyDown(window, { key: 'End' })
    expect(focusedIndex(container)).toBe('2')

    rerender(deck(['a'], onExitStart))
    expect(focusedIndex(container)).toBe('0')

    rerender(deck([], onExitStart))
    expect(container.querySelector('.b-deck__item[data-focused="true"]')).toBeNull()
  })

  it('keeps page keys on the post body and leaves focus alone', () => {
    const onExitStart = vi.fn()
    const { container } = render(deck(ITEMS, onExitStart))
    const child = container.querySelector('button')
    if (child === null) throw new Error('card control missing')
    child.focus()

    fireEvent.keyDown(window, { key: 'PageDown' })

    expect(document.activeElement).toBe(child)
    expect(focusedIndex(container)).toBe('0')
  })

  it('leaves j, k, h and l inert on either axis', () => {
    const onExitStart = vi.fn()
    const { container, unmount } = render(deck(ITEMS, onExitStart))

    for (const key of ['j', 'k', 'h', 'l']) fireEvent.keyDown(window, { key })
    expect(focusedIndex(container)).toBe('0')

    // the arrows still own movement on the wide axis
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedIndex(container)).toBe('1')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(focusedIndex(container)).toBe('0')

    unmount()
    stubWide(false)
    const narrow = render(deck(ITEMS, onExitStart))
    for (const key of ['j', 'k', 'h', 'l']) fireEvent.keyDown(window, { key })
    expect(focusedIndex(narrow.container)).toBe('0')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(focusedIndex(narrow.container)).toBe('1')
    expect(onExitStart).not.toHaveBeenCalled()
  })

  it('moves left and right and opens down on a wide deck', () => {
    const onActivate = vi.fn()
    const onExitStart = vi.fn()
    const { container } = render(
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => <article className="b-frame">{item}</article>}
        onActivate={onActivate}
        onExitStart={onExitStart}
        label="cards"
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedIndex(container)).toBe('1')
    expect(onActivate).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(focusedIndex(container)).toBe('0')

    // down opens instead of moving
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(focusedIndex(container)).toBe('0')
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith(ITEMS[0], 0)
    expect(onExitStart).not.toHaveBeenCalled()
  })

  it('leaves the up arrow inert on a wide deck', () => {
    const onExitStart = vi.fn()
    const { container } = render(deck(ITEMS, onExitStart))

    fireEvent.keyDown(window, { key: 'ArrowUp' })

    expect(onExitStart).not.toHaveBeenCalled()
    expect(focusedIndex(container)).toBe('0')
  })

  it('moves vertically and opens with right on a narrow deck', () => {
    stubWide(false)
    const onActivate = vi.fn()
    const onExitStart = vi.fn()
    const { container } = render(
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => <article className="b-frame">{item}</article>}
        onActivate={onActivate}
        onExitStart={onExitStart}
        label="cards"
      />,
    )

    expect(container.querySelector('.b-deck')?.getAttribute('data-axis')).toBe('y')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    expect(onActivate).not.toHaveBeenCalled()
    expect(onExitStart).not.toHaveBeenCalled()
    expect(focusedIndex(container)).toBe('0')

    // right is the narrow deck's open key
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(focusedIndex(container)).toBe('0')

    // the vertical arrows still walk the deck
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(focusedIndex(container)).toBe('1')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(focusedIndex(container)).toBe('0')
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('clamps forward movement instead of leaving the deck', () => {
    const onExitStart = vi.fn()
    const { container } = render(deck(ITEMS, onExitStart))

    for (let press = 0; press < 4; press += 1) fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedIndex(container)).toBe('2')
    expect(onExitStart).not.toHaveBeenCalled()

    // the axis-back arrow still leaves the deck from the first card
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(focusedIndex(container)).toBe('0')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onExitStart).toHaveBeenCalledTimes(1)
  })

  it('treats Home and End as canonical and g and G as aliases', () => {
    const { container } = render(deck(ITEMS, vi.fn()))

    fireEvent.keyDown(window, { key: 'End' })
    expect(focusedIndex(container)).toBe('2')
    fireEvent.keyDown(window, { key: 'Home' })
    expect(focusedIndex(container)).toBe('0')
    // a real Shift+G arrives with shiftKey set and must still mean last
    fireEvent.keyDown(window, { key: 'G', shiftKey: true })
    expect(focusedIndex(container)).toBe('2')
    fireEvent.keyDown(window, { key: 'g' })
    expect(focusedIndex(container)).toBe('0')
  })

  it('focuses the nth card when the deck is the active surface', () => {
    const { container } = render(deck(ITEMS, vi.fn()))

    // nothing inside the deck owns focus, yet the deck is still the surface
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: '3' })
    expect(focusedIndex(container)).toBe('2')
  })

  it('focuses the nth card while a non-interactive card child has focus', () => {
    const { container } = render(
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the case is a focusable non-interactive card child
          <article className="b-frame" tabIndex={0}>
            {item}
          </article>
        )}
        label="cards"
      />,
    )
    const child = container.querySelector<HTMLElement>('.b-frame')
    if (child === null) throw new Error('card child missing')
    child.focus()
    expect(document.activeElement).toBe(child)

    fireEvent.keyDown(child, { key: '2' })

    expect(focusedIndex(container)).toBe('1')
    expect(document.activeElement).toBe(container.querySelector('.b-deck'))
  })

  it('ignores keys while an input method is composing', () => {
    const onActivate = vi.fn()
    const onExitStart = vi.fn()
    const { container } = render(
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => <article className="b-frame">{item}</article>}
        onActivate={onActivate}
        onExitStart={onExitStart}
        label="cards"
      />,
    )

    fireEvent.keyDown(window, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(window, { key: 'ArrowLeft', keyCode: 229 })
    fireEvent.keyDown(window, { key: 'ArrowRight', isComposing: true })

    expect(onActivate).not.toHaveBeenCalled()
    expect(onExitStart).not.toHaveBeenCalled()
    expect(focusedIndex(container)).toBe('0')
  })
})

function keyConsumed(init: KeyboardEventInit, target: EventTarget = window): boolean {
  let prevented = false
  const probe = (event: Event) => {
    prevented = (event as KeyboardEvent).defaultPrevented
  }
  window.addEventListener('keydown', probe)
  fireEvent.keyDown(target as Element | Window, init)
  window.removeEventListener('keydown', probe)
  return prevented
}

function postBodyDeck(items: string[] = ITEMS): ReactNode {
  return (
    <Deck
      items={items}
      getKey={(item) => item}
      renderItem={(item) => (
        <article className="b-frame">
          <div className="b-post-card__body">
            <p className="b-post-card__text">card {item}</p>
          </div>
        </article>
      )}
      label="cards"
    />
  )
}

interface BodyMetrics {
  body: HTMLElement
  top: () => number
  scrollTo: (value: number) => void
}

/** jsdom reports no layout, so the card body declares the box it would have. */
function sizeBody(container: HTMLElement, scrollHeight: number, clientHeight: number): BodyMetrics {
  const body = container.querySelector<HTMLElement>('.b-post-card__body')
  if (body === null) throw new Error('post body missing')
  let top = 0
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: clientHeight })
  Object.defineProperty(body, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (next: number) => {
      top = next
    },
  })
  Object.defineProperty(body, 'scrollBy', {
    configurable: true,
    value: (options: ScrollToOptions) => {
      top += options.top ?? 0
    },
  })
  return {
    body,
    top: () => top,
    scrollTo: (value: number) => {
      top = value
    },
  }
}

describe('Deck shifted arrows', () => {
  it('consumes shift+arrow when the body has nothing to scroll', () => {
    const { container } = render(postBodyDeck())
    const metrics = sizeBody(container, 120, 120)

    expect(keyConsumed({ key: 'ArrowDown', shiftKey: true })).toBe(true)
    expect(keyConsumed({ key: 'ArrowUp', shiftKey: true })).toBe(true)

    expect(metrics.top()).toBe(0)
    expect(focusedIndex(container)).toBe('0')
  })

  it('still consumes the key at the top and bottom edges', () => {
    const { container } = render(postBodyDeck())
    const metrics = sizeBody(container, 1000, 100)

    metrics.scrollTo(900)
    expect(keyConsumed({ key: 'ArrowDown', shiftKey: true })).toBe(true)
    expect(metrics.top()).toBe(900)

    metrics.scrollTo(0)
    expect(keyConsumed({ key: 'ArrowUp', shiftKey: true })).toBe(true)
    expect(metrics.top()).toBe(0)
  })

  it('scrolls an overflowing body in both directions without moving a card', () => {
    const { container } = render(postBodyDeck())
    const metrics = sizeBody(container, 1000, 100)

    expect(keyConsumed({ key: 'ArrowDown', shiftKey: true })).toBe(true)
    expect(metrics.top()).toBeGreaterThan(0)
    expect(focusedIndex(container)).toBe('0')

    expect(keyConsumed({ key: 'ArrowUp', shiftKey: true })).toBe(true)
    expect(metrics.top()).toBe(0)
    expect(focusedIndex(container)).toBe('0')
  })

  it('keeps releasing plain page keys at a boundary', () => {
    const { container } = render(postBodyDeck())
    sizeBody(container, 120, 120)

    expect(keyConsumed({ key: 'PageDown' })).toBe(false)
    expect(keyConsumed({ key: 'PageUp' })).toBe(false)
  })

  it('leaves shift+arrow to a text editor inside the card', () => {
    render(
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={() => <textarea defaultValue="native selection" />}
        label="cards"
      />,
    )
    const editor = document.querySelector('textarea')
    if (editor === null) throw new Error('editor missing')

    expect(keyConsumed({ key: 'ArrowDown', shiftKey: true }, editor)).toBe(false)
  })
})

describe('Deck repeat ownership', () => {
  function activatable(onActivate: () => void, onExitStart?: () => void) {
    return (
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => <article className="b-frame">{item}</article>}
        onActivate={onActivate}
        {...(onExitStart === undefined ? {} : { onExitStart })}
        label="cards"
      />
    )
  }

  it('activates once for a held enter', () => {
    const onActivate = vi.fn()
    render(activatable(onActivate))

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Enter', repeat: true })
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('does not activate or consume Space', () => {
    const onActivate = vi.fn()
    const { container } = render(activatable(onActivate))

    expect(keyConsumed({ key: ' ' })).toBe(false)
    fireEvent.keyDown(window, { key: ' ' })

    expect(onActivate).not.toHaveBeenCalled()
    expect(focusedIndex(container)).toBe('0')
  })

  it('activates once for a held enter on a narrow deck', () => {
    stubWide(false)
    const onActivate = vi.fn()
    render(activatable(onActivate))

    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Enter', repeat: true })

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('activates once for a held right on a narrow deck', () => {
    stubWide(false)
    const onActivate = vi.fn()
    render(activatable(onActivate))

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true })

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('activates once for a held down on a wide deck', () => {
    const onActivate = vi.fn()
    render(activatable(onActivate))

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown', repeat: true })

    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('exits a nonempty deck once for a held back key at the first card', () => {
    const onActivate = vi.fn()
    const onExitStart = vi.fn()
    const { container } = render(activatable(onActivate, onExitStart))

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true })

    expect(onExitStart).toHaveBeenCalledTimes(1)
    expect(focusedIndex(container)).toBe('0')
  })

  it('exits an empty deck once for a held back key', () => {
    const onExitStart = vi.fn()
    render(
      <Deck
        items={[]}
        getKey={(item: string) => item}
        renderItem={() => null}
        onExitStart={onExitStart}
        label="cards"
      />,
    )

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true })

    expect(onExitStart).toHaveBeenCalledTimes(1)
  })

  it('still scans in range while the movement key is held', () => {
    const { container } = render(activatable(vi.fn()))

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedIndex(container)).toBe('1')

    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true })
    expect(focusedIndex(container)).toBe('2')

    fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true })
    expect(focusedIndex(container)).toBe('1')
  })
})

describe('Deck first card centring', () => {
  it('centres the opening card without a mount-time slide', () => {
    stubWide(true)
    const scrollTo = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      value: scrollTo,
      configurable: true,
      writable: true,
    })
    try {
      const onExitStart = vi.fn()
      const { container } = render(
        <Deck
          items={ITEMS}
          getKey={(item) => item}
          renderItem={(item) => <button type="button">open {item}</button>}
          leadingPeek={<button type="button">peek</button>}
          leadingPeekInteractive
          stateKey="mount-centring"
          onExitStart={onExitStart}
          label="cards"
        />,
      )
      expect(container.querySelector('.b-deck')?.getAttribute('data-axis')).toBe('x')
      const first = scrollTo.mock.calls[0]?.[0] as ScrollToOptions | undefined
      // the mount correction must not animate; a smooth first scroll is the
      // deck sliding in on load
      expect(first?.behavior).toBe('auto')
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', original)
      }
    }
  })
})

describe('Deck position memory', () => {
  function keyedDeck(containerItems: string[], stateKey: string): ReactElement {
    return (
      <Deck
        items={containerItems}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">open {item}</button>}
        stateKey={stateKey}
        label="cards"
      />
    )
  }

  function renderKeyed(containerItems: string[], stateKey: string) {
    return render(keyedDeck(containerItems, stateKey))
  }

  function focusedText(): string | null {
    return document.querySelector('.b-deck__item[data-focused="true"]')?.textContent?.trim() ?? null
  }

  it('restores by key when items are inserted before the focused card', () => {
    stubWide(false)
    const first = renderKeyed(['a', 'b', 'c'], 'memory-key')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(focusedIndex(first.container)).toBe('1')
    first.unmount()

    renderKeyed(['new', 'a', 'b', 'c'], 'memory-key')
    // the stored index 1 would be 'a' now; the key keeps 'b' focused
    expect(focusedText()).toBe('open b')
  })

  it('falls back to the stored index when the saved card is gone', () => {
    stubWide(false)
    const first = renderKeyed(['a', 'b', 'c'], 'memory-missing-key')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(focusedIndex(first.container)).toBe('1')
    first.unmount()

    renderKeyed(['a', 'c'], 'memory-missing-key')
    expect(focusedText()).toBe('open c')
  })

  it('keeps a saved position pending while the deck is still empty', () => {
    stubWide(false)
    const first = renderKeyed(['a', 'b', 'c'], 'memory-empty-mount')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(focusedIndex(first.container)).toBe('1')
    first.unmount()

    // mounting empty must not zero the saved key before the items arrive
    const second = renderKeyed([], 'memory-empty-mount')
    expect(second.container.querySelector('.b-deck__item')).toBeNull()

    second.rerender(keyedDeck(['x', 'a', 'b', 'c'], 'memory-empty-mount'))
    expect(focusedText()).toBe('open b')
  })

  it('keeps a saved key pending while only a loading placeholder is mounted', () => {
    stubWide(false)
    const first = renderKeyed(['a', 'b', 'c'], 'memory-loading-mount')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(focusedIndex(first.container)).toBe('1')
    first.unmount()

    const mounted = (loaded: boolean) => (
      <Deck
        items={loaded ? ['a', 'b', 'c'] : ['loading']}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">open {item}</button>}
        stateKey="memory-loading-mount"
        pending={!loaded}
        label="cards"
      />
    )
    const second = render(mounted(false))
    // the placeholder is not the saved card, so the key stays pending
    second.rerender(mounted(true))
    expect(focusedText()).toBe('open b')
  })

  it('does not carry one namespace position into another', () => {
    stubWide(false)
    const first = renderKeyed(['a', 'b', 'c'], 'ns-a')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    first.unmount()

    renderKeyed(['x', 'y', 'z'], 'ns-b')
    expect(focusedText()).toBe('open x')
  })
})

describe('Deck list semantics and status', () => {
  function listDeck(items: string[], layout: 'deck' | 'list' = 'deck'): ReactNode {
    return (
      <Deck
        items={items}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">open {item}</button>}
        layout={layout}
        label="cards"
      />
    )
  }

  it('keeps a plain ordered list with one current card and a live status', () => {
    const { container } = render(listDeck(ITEMS, 'list'))
    const deck = container.querySelector('.b-deck')
    expect(deck?.tagName).toBe('OL')
    expect(deck?.getAttribute('data-layout')).toBe('list')
    expect(deck?.getAttribute('role')).toBeNull()
    expect(deck?.querySelectorAll('[aria-selected]')).toHaveLength(0)
    const current = container.querySelectorAll('.b-deck__item[aria-current="true"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.getAttribute('data-deck-index')).toBe('0')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('card 1 of 3')
  })

  it('announces explicit moves but not a focus change', () => {
    const { container } = render(listDeck(ITEMS))
    const status = () => container.querySelector('[role="status"]')?.textContent ?? null
    expect(status()).toBe('card 1 of 3')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(status()).toBe('card 2 of 3')

    const third = container.querySelectorAll<HTMLButtonElement>('.b-deck__item button')[2]
    if (third === undefined) throw new Error('third card control missing')
    fireEvent.focus(third)
    // moving focus by hand changes the current card but is not a deck move
    expect(status()).toBe('card 2 of 3')
    const current = container.querySelector('.b-deck__item[aria-current="true"]')
    expect(current?.getAttribute('data-deck-index')).toBe('2')
  })

  it('shows a named loading row and an alert with a guarded retry', () => {
    const onRetry = vi.fn()
    const { container, rerender } = render(
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">open {item}</button>}
        loadingMore
        loadMoreError
        onLoadMore={vi.fn()}
        onRetryLoadMore={onRetry}
        label="cards"
      />,
    )
    expect(container.querySelector('.b-deck__loading [role="status"]')?.textContent).toBe(
      'loading more cards',
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "couldn't load more cards",
    )
    const retry = container.querySelector<HTMLButtonElement>('.b-deck__load-error-retry')
    expect(retry?.getAttribute('aria-disabled')).toBe('true')
    if (retry !== null) fireEvent.click(retry)
    expect(onRetry).not.toHaveBeenCalled()

    rerender(
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">open {item}</button>}
        loadMoreError
        onRetryLoadMore={onRetry}
        label="cards"
      />,
    )
    const ready = container.querySelector<HTMLButtonElement>('.b-deck__load-error-retry')
    if (ready !== null) fireEvent.click(ready)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('leaves keys to an interactive control outside the deck', () => {
    const { container } = render(
      <div>
        <button type="button">outside</button>
        {listDeck(ITEMS)}
      </div>,
    )
    const outside = container.querySelector<HTMLButtonElement>('button')
    if (outside === null) throw new Error('outside control missing')
    outside.focus()

    expect(keyConsumed({ key: 'ArrowRight' }, outside)).toBe(false)
    expect(keyConsumed({ key: 'g' }, outside)).toBe(false)
    expect(focusedIndex(container)).toBe('0')
  })
})

describe('Deck character shortcut opt-out', () => {
  afterEach(() => {
    useSettings.setState({ keyboardShortcuts: true })
  })

  function activatable(onActivate: () => void, onExitStart?: () => void) {
    return (
      <Deck
        items={ITEMS}
        getKey={(item) => item}
        renderItem={(item) => <article className="b-frame">{item}</article>}
        onActivate={onActivate}
        {...(onExitStart === undefined ? {} : { onExitStart })}
        label="cards"
      />
    )
  }

  it('ignores its letters, digits and end aliases while the shortcuts are off', () => {
    useSettings.setState({ keyboardShortcuts: false })
    const onActivate = vi.fn()
    const onExitStart = vi.fn()
    const { container } = render(activatable(onActivate, onExitStart))

    // neither consumed nor acted on: no card move, no activation, no exit
    expect(keyConsumed({ key: 'g' })).toBe(false)
    fireEvent.keyDown(window, { key: '5' })
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'G' })

    expect(focusedIndex(container)).toBe('0')
    expect(onActivate).not.toHaveBeenCalled()
    expect(onExitStart).not.toHaveBeenCalled()
  })

  it('keeps arrows, activation and page scrolling while the shortcuts are off', () => {
    useSettings.setState({ keyboardShortcuts: false })
    const onActivate = vi.fn()
    const { container } = render(activatable(onActivate))

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedIndex(container)).toBe('1')

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(focusedIndex(container)).toBe('0')

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith(ITEMS[0], 0)

    // shifted arrows stay owned by the deck, page keys keep their edge rules
    const { container: bodyDeck } = render(postBodyDeck())
    sizeBody(bodyDeck, 120, 120)
    expect(keyConsumed({ key: 'ArrowDown', shiftKey: true })).toBe(true)
    expect(keyConsumed({ key: 'PageDown' })).toBe(false)
  })

  it('restores the shortcuts once the setting is back on', () => {
    const onActivate = vi.fn()
    const { container } = render(activatable(onActivate))
    useSettings.setState({ keyboardShortcuts: false })
    fireEvent.keyDown(window, { key: '3' })
    fireEvent.keyDown(window, { key: 'G' })
    expect(focusedIndex(container)).toBe('0')

    useSettings.setState({ keyboardShortcuts: true })
    fireEvent.keyDown(window, { key: '3' })
    expect(focusedIndex(container)).toBe('2')
    fireEvent.keyDown(window, { key: 'g' })
    expect(focusedIndex(container)).toBe('0')
    expect(onActivate).not.toHaveBeenCalled()
  })
})
