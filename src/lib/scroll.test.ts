import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollCardBody, scrollThreadPage } from './scroll'

const cleanups: Array<() => void> = []

function stubMetrics(
  element: Element,
  metrics: { clientHeight?: number; scrollHeight?: number; scrollTop?: number },
): void {
  for (const [key, value] of Object.entries(metrics)) {
    if (value === undefined) continue
    const original = Object.getOwnPropertyDescriptor(element, key)
    cleanups.push(() => {
      if (original === undefined) Reflect.deleteProperty(element, key)
      else Object.defineProperty(element, key, original)
    })
    Object.defineProperty(element, key, { value, configurable: true, writable: true })
  }
}

function stubDocumentScroller(metrics: {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}): void {
  const scroller = document.documentElement
  Object.defineProperty(document, 'scrollingElement', { value: scroller, configurable: true })
  cleanups.push(() => Reflect.deleteProperty(document, 'scrollingElement'))
  stubMetrics(scroller, metrics)
}

function stubPrefersReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

interface CardBody {
  root: HTMLElement
  body: HTMLElement
}

/** A card root containing a body fragment of the given class. */
function cardBody(className: string): CardBody {
  const root = document.createElement('div')
  const body = document.createElement('div')
  body.className = className
  root.append(body)
  document.body.append(root)
  return { root, body }
}

function bodyMetrics(
  body: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  stubMetrics(body, metrics)
  const scrollBy = vi.fn()
  body.scrollBy = scrollBy
  return scrollBy
}

beforeEach(() => {
  document.body.replaceChildren()
  vi.stubGlobal('innerHeight', 900)
  stubPrefersReducedMotion(false)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.replaceChildren()
})

describe('scrollThreadPage', () => {
  it('scrolls the document by most of a viewport when nothing closer can scroll', () => {
    const wrapper = document.createElement('div')
    const thread = document.createElement('div')
    thread.className = 'b-thread'
    wrapper.append(thread)
    document.body.append(wrapper)
    stubDocumentScroller({ clientHeight: 900, scrollHeight: 4000, scrollTop: 0 })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    expect(scrollThreadPage(1)).toBe(true)

    expect(scrollBy).toHaveBeenCalledTimes(1)
    const options = scrollBy.mock.calls[0]?.[0] as ScrollToOptions
    expect(options.behavior).toBe('smooth')
    expect(options.top).toBeGreaterThanOrEqual(0.6 * 900)
    expect(options.top).toBeLessThanOrEqual(900)
  })

  it('does not scroll when the document is already at the bottom', () => {
    stubDocumentScroller({ clientHeight: 900, scrollHeight: 4000, scrollTop: 3100 })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    expect(scrollThreadPage(1)).toBe(false)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('scrolls instantly when the reader asked for reduced motion', () => {
    stubPrefersReducedMotion(true)
    stubDocumentScroller({ clientHeight: 900, scrollHeight: 4000, scrollTop: 0 })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    expect(scrollThreadPage(1)).toBe(true)

    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy.mock.calls[0]?.[0]).toMatchObject({ behavior: 'auto' })
  })

  it('scrolls the nearest scrollable ancestor instead of the document', () => {
    const pane = document.createElement('div')
    pane.style.overflowY = 'auto'
    const thread = document.createElement('div')
    thread.className = 'b-thread'
    pane.append(thread)
    document.body.append(pane)
    stubMetrics(pane, { clientHeight: 500, scrollHeight: 2000, scrollTop: 0 })
    const paneScrollBy = vi.fn()
    pane.scrollBy = paneScrollBy
    stubDocumentScroller({ clientHeight: 900, scrollHeight: 4000, scrollTop: 0 })
    const windowScrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    expect(scrollThreadPage(1)).toBe(true)

    expect(paneScrollBy).toHaveBeenCalledTimes(1)
    const options = paneScrollBy.mock.calls[0]?.[0] as ScrollToOptions
    expect(options.behavior).toBe('smooth')
    expect(options.top).toBeGreaterThanOrEqual(0.6 * 500)
    expect(options.top).toBeLessThanOrEqual(500)
    expect(windowScrollBy).not.toHaveBeenCalled()
  })
})

describe('scrollCardBody', () => {
  it('scrolls an overflowing post body by most of its own height', () => {
    const { root, body } = cardBody('b-post-card__body')
    const scrollBy = bodyMetrics(body, { clientHeight: 400, scrollHeight: 1600, scrollTop: 0 })

    expect(scrollCardBody(root, 1)).toBe(true)

    expect(scrollBy).toHaveBeenCalledTimes(1)
    const options = scrollBy.mock.calls[0]?.[0] as ScrollToOptions
    expect(options.behavior).toBe('smooth')
    expect(options.top).toBeGreaterThanOrEqual(0.6 * 400)
    expect(options.top).toBeLessThanOrEqual(400)
  })

  it('treats an overflowing profile body the same way', () => {
    const { root, body } = cardBody('b-profile__body')
    const scrollBy = bodyMetrics(body, { clientHeight: 500, scrollHeight: 2500, scrollTop: 0 })

    expect(scrollCardBody(root, 1)).toBe(true)

    expect(scrollBy).toHaveBeenCalledTimes(1)
    const options = scrollBy.mock.calls[0]?.[0] as ScrollToOptions
    expect(options.top).toBeGreaterThanOrEqual(0.6 * 500)
    expect(options.top).toBeLessThanOrEqual(500)
  })

  it('scrolls a profile body upward when it is below the top', () => {
    const { root, body } = cardBody('b-profile__body')
    const scrollBy = bodyMetrics(body, { clientHeight: 400, scrollHeight: 1600, scrollTop: 800 })

    expect(scrollCardBody(root, -1)).toBe(true)
    const options = scrollBy.mock.calls[0]?.[0] as ScrollToOptions | undefined
    if (options === undefined) throw new Error('scroll options missing')
    expect(options.top).toBeLessThan(0)
  })

  it('returns false when the card has neither a post nor a profile body', () => {
    const root = document.createElement('div')
    root.append(document.createElement('span'))
    document.body.append(root)

    expect(scrollCardBody(root, 1)).toBe(false)
    expect(scrollCardBody(null, 1)).toBe(false)
  })

  it('returns false when the body does not overflow', () => {
    const { root, body } = cardBody('b-post-card__body')
    const scrollBy = bodyMetrics(body, { clientHeight: 400, scrollHeight: 400, scrollTop: 0 })

    expect(scrollCardBody(root, 1)).toBe(false)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('returns false at the bottom when paging down and at the top when paging up', () => {
    const down = cardBody('b-post-card__body')
    const downScrollBy = bodyMetrics(down.body, {
      clientHeight: 400,
      scrollHeight: 1600,
      scrollTop: 1200,
    })
    expect(scrollCardBody(down.root, 1)).toBe(false)

    const up = cardBody('b-profile__body')
    const upScrollBy = bodyMetrics(up.body, { clientHeight: 400, scrollHeight: 1600, scrollTop: 0 })
    expect(scrollCardBody(up.root, -1)).toBe(false)

    expect(downScrollBy).not.toHaveBeenCalled()
    expect(upScrollBy).not.toHaveBeenCalled()
  })

  it('scrolls instantly when the reader asked for reduced motion', () => {
    stubPrefersReducedMotion(true)
    const { root, body } = cardBody('b-profile__body')
    const scrollBy = bodyMetrics(body, { clientHeight: 400, scrollHeight: 1600, scrollTop: 400 })

    expect(scrollCardBody(root, 1)).toBe(true)
    expect(scrollBy.mock.calls[0]?.[0]).toMatchObject({ behavior: 'auto' })
  })
})
