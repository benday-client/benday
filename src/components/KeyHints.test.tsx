import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router, useLocation } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import type { FeedFeedbackEvent } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { bindingFor, displayKeys } from '../lib/keymap'
import { useSettings } from '../lib/store'
import type { PostModel } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { HOLD_PAINT_MS, HOLD_THRESHOLD_MS, KeyHints } from './KeyHints'
import { PostCard } from './PostCard'
import { TopBar } from './TopBar'

function registryLabel(id: string): string {
  return displayKeys(bindingFor(id))[0] ?? ''
}

function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

// jsdom has no layout, so the case supplies the geometry the overlay reads. The
// numbers are deliberately non-zero: a badge that ignored the owning rect would
// land somewhere else, and a control the overlay displaced would not read back
// the same box.
const GEOMETRY = { topbarTop: 20, hintTop: 480 }
function installGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const element = this as HTMLElement
    if (element.classList.contains('b-post-card')) return box(340, 180, 600, 420)
    if (element.dataset['keyhint'] === undefined) return box(0, 0, 0, 0)
    if (element.closest('.b-topbar') !== null) return box(1000, GEOMETRY.topbarTop, 38, 36)
    return box(400, GEOMETRY.hintTop, 60, 30)
  })
}

function imagePost(): PostModel {
  return postFixture({
    embed: {
      type: 'images',
      images: [{ thumb: 't', fullsize: 'f', alt: 'a', width: 4, height: 3 }],
    },
  })
}

function quotedPost(): PostModel {
  return postFixture({
    embed: {
      type: 'quote',
      post: {
        uri: 'at://did:plc:quoted/app.bsky.feed.post/q',
        cid: 'quoted-cid',
        author: {
          did: 'did:plc:quoted',
          handle: 'quoted.test',
          displayName: 'quoted',
          avatar: null,
          muted: false,
          blocked: false,
        },
        text: 'quoted text',
        facets: [],
        indexedAt: '2026-10-29T12:00:00.000Z',
        embedType: null,
      },
    },
  })
}

function ShowPath() {
  const [pathname] = useLocation()
  return <span data-testid="path">{pathname}</span>
}

interface DeckOptions {
  authed?: boolean
  onFeedback?: (post: PostModel, event: FeedFeedbackEvent) => Promise<void>
}

function renderDeck(post: PostModel, options: DeckOptions = {}) {
  if (options.authed === true) {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:test', handle: 'test.bsky.social' },
      pending: false,
      error: null,
    })
  }
  const location = memoryLocation({ path: '/feed' })
  const ui = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Router hook={location.hook}>
        <TopBar onSearch={vi.fn()} />
        <PostCard
          post={post}
          focused
          {...(options.onFeedback === undefined ? {} : { onFeedback: options.onFeedback })}
        />
        <ShowPath />
        <KeyHints route="/feed" />
      </Router>
    </QueryClientProvider>,
  )
  const layer = () => document.querySelector<HTMLElement>('[data-keyhint-layer]')
  const badges = () =>
    layer() === null
      ? []
      : [...(layer()?.querySelectorAll('.b-keyhint') ?? [])].map((badge) => badge.textContent)
  const groupFor = (label: string) => {
    const painted = layer()
    if (painted === null) return null
    const badge = [...painted.querySelectorAll('.b-keyhint')].find(
      (candidate) => candidate.textContent === label,
    )
    return badge?.closest<HTMLElement>('.b-keyhints__group') ?? null
  }
  return { ...ui, location, layer, badges, groupFor }
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** A full hold: past the threshold and past the paint debounce. */
function hold(): void {
  fireEvent.keyDown(window, { key: '?' })
  advance(HOLD_THRESHOLD_MS + HOLD_PAINT_MS)
}

beforeEach(() => {
  vi.useFakeTimers()
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null, openingPost: null })
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  useSettings.setState({ keyboardShortcuts: true })
  GEOMETRY.topbarTop = 20
  GEOMETRY.hintTop = 480
  installGeometry()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('KeyHints hold gesture', () => {
  it('paints the registry badges after the threshold and hides them on release', () => {
    const { layer, badges } = renderDeck(imagePost(), { authed: true })

    fireEvent.keyDown(window, { key: '?' })
    // the tap action is still pending, so nothing is painted yet
    advance(HOLD_THRESHOLD_MS)
    expect(layer()).toBeNull()

    // a repeat keydown is the same held key, not a second gesture
    fireEvent.keyDown(window, { key: '?', repeat: true })
    advance(HOLD_PAINT_MS)
    expect(layer()).not.toBeNull()

    const shown = badges()
    expect(shown).toContain(registryLabel('card-like'))
    expect(shown).toContain(registryLabel('card-repost'))
    expect(shown).toContain(registryLabel('card-reply'))
    expect(shown).toContain(registryLabel('card-quote'))
    expect(shown).toContain(registryLabel('card-copy'))
    expect(shown).toContain(registryLabel('card-media'))
    expect(shown).toContain(registryLabel('palette'))
    expect(shown).toContain(registryLabel('search'))
    expect(shown).toContain(registryLabel('compose'))
    expect(shown).toContain(registryLabel('appview'))
    expect(shown).toContain(registryLabel('settings'))
    expect(shown).toContain(registryLabel('help'))
    // this is the viewer's own post, so delete is offered, but it has no video
    // and no quote, so those keys stay silent
    expect(shown).toContain(registryLabel('card-delete'))
    expect(shown).not.toContain(registryLabel('card-video'))
    expect(shown).not.toContain(registryLabel('card-quoted'))

    fireEvent.keyUp(window, { key: '?' })
    expect(layer()).toBeNull()
    // a held gesture is not a tap: the help dialog stays closed
    expect(useUiStore.getState().dialog).toBeNull()
  })

  it('opens the help dialog on a quick tap and paints nothing', () => {
    const { layer } = renderDeck(imagePost(), { authed: true })

    fireEvent.keyDown(window, { key: '?' })
    advance(200)
    fireEvent.keyUp(window, { key: '?' })

    expect(useUiStore.getState().dialog).toBe('help')
    expect(layer()).toBeNull()
    advance(600)
    expect(layer()).toBeNull()
  })

  it('hides on any other key and lets that key keep its meaning', () => {
    const feedback = vi.fn(async (_post: PostModel, _event: FeedFeedbackEvent) => {})
    const { layer } = renderDeck(imagePost(), { authed: true, onFeedback: feedback })

    hold()
    expect(layer()).not.toBeNull()

    fireEvent.keyDown(window, { key: '+' })

    expect(layer()).toBeNull()
    expect(feedback.mock.calls[0]?.[1]).toBe('more')
    // the key that closed the overlay was not swallowed
    expect(useUiStore.getState().dialog).toBeNull()
  })

  it('is inert inside an editable field and while a dialog owns the keyboard', () => {
    const { layer, container } = renderDeck(imagePost(), { authed: true })
    const input = document.createElement('input')
    container.append(input)

    fireEvent.keyDown(input, { key: '?' })
    advance(420)
    expect(layer()).toBeNull()
    fireEvent.keyUp(input, { key: '?' })
    expect(useUiStore.getState().dialog).toBeNull()

    // a store-backed dialog already owns `?`; opening it must not open help too
    act(() => {
      useUiStore.getState().openDialog('settings')
    })
    hold()
    expect(layer()).toBeNull()
    fireEvent.keyUp(window, { key: '?' })
    expect(useUiStore.getState().dialog).toBe('settings')
  })

  it('lets Escape close the overlay without navigating', () => {
    const { layer } = renderDeck(imagePost(), { authed: true })

    hold()
    expect(layer()).not.toBeNull()
    expect(screen.getByTestId('path').textContent).toBe('/feed')

    const consumed = fireEvent.keyDown(window, { key: 'Escape' })

    expect(consumed).toBe(false)
    expect(layer()).toBeNull()
    expect(screen.getByTestId('path').textContent).toBe('/feed')
  })

  it('clears every timer on window blur, an editable focus, a hidden tab, a route swap and unmount', () => {
    const { layer, container, rerender, unmount } = renderDeck(imagePost(), { authed: true })
    const input = document.createElement('input')
    container.append(input)

    hold()
    expect(layer()).not.toBeNull()
    fireEvent(window, new Event('blur'))
    expect(layer()).toBeNull()

    // a blur during the pending threshold cancels the tap too
    fireEvent.keyDown(window, { key: '?' })
    advance(100)
    fireEvent(window, new Event('blur'))
    fireEvent.keyUp(window, { key: '?' })
    advance(600)
    expect(useUiStore.getState().dialog).toBeNull()

    // focus moving into an editable field ends the gesture too
    hold()
    expect(layer()).not.toBeNull()
    act(() => {
      input.focus()
    })
    expect(layer()).toBeNull()
    fireEvent.keyUp(window, { key: '?' })
    expect(useUiStore.getState().dialog).toBeNull()

    const previous = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    hold()
    expect(layer()).not.toBeNull()
    fireEvent(document, new Event('visibilitychange'))
    expect(layer()).toBeNull()
    if (previous === undefined) {
      Reflect.deleteProperty(Document.prototype, 'visibilityState')
    } else {
      Object.defineProperty(Document.prototype, 'visibilityState', previous)
    }

    hold()
    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <Router hook={memoryLocation({ path: '/feed' }).hook}>
          <TopBar onSearch={vi.fn()} />
          <PostCard post={imagePost()} focused />
          <KeyHints route="/search" />
        </Router>
      </QueryClientProvider>,
    )
    expect(layer()).toBeNull()

    fireEvent.keyDown(window, { key: '?' })
    unmount()
    advance(600)
    expect(useUiStore.getState().dialog).toBeNull()
    expect(layer()).toBeNull()
  })

  it('keeps the focused card in place and adds no accessible text', () => {
    const { layer, container } = renderDeck(imagePost(), { authed: true })
    const card = container.querySelector('.b-post-card')
    if (card === null) throw new Error('card missing')
    const before = card.getBoundingClientRect()
    const buttons = screen.queryAllByRole('button').length
    const active = document.activeElement

    hold()

    const painted = layer()
    if (painted === null) throw new Error('hint layer missing')
    // decorative by construction: nothing joins the accessibility tree, and the
    // card it describes neither moves nor grows an in-flow child
    expect(painted.getAttribute('aria-hidden')).toBe('true')
    expect(painted.contains(card)).toBe(false)
    expect(screen.queryAllByRole('button')).toHaveLength(buttons)
    for (const badge of painted.querySelectorAll('.b-keyhint')) {
      expect(badge.getAttribute('tabindex')).toBeNull()
    }
    const after = card.getBoundingClientRect()
    expect(after.left).toBe(before.left)
    expect(after.top).toBe(before.top)
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
    expect(document.activeElement).toBe(active)
  })

  it('anchors each group on its owning control and follows a scroll', () => {
    const { layer, groupFor } = renderDeck(imagePost(), { authed: true })

    hold()
    expect(layer()).not.toBeNull()

    // the toolbar sits against the top edge, so its groups flip below it
    const palette = groupFor(registryLabel('palette'))
    if (palette === null) throw new Error('palette badge missing')
    expect(palette.dataset['placement']).toBe('below')
    expect(parseFloat(palette.style.left)).toBe(1038)
    expect(parseFloat(palette.style.top)).toBe(64)

    const like = groupFor(registryLabel('card-like'))
    if (like === null) throw new Error('like badge missing')
    expect(like.dataset['placement']).toBe('above')
    expect(parseFloat(like.style.left)).toBe(460)
    expect(parseFloat(like.style.top)).toBe(472)

    // one animation frame after the scroll re-reads the rect
    GEOMETRY.topbarTop = 8
    fireEvent.scroll(window)
    advance(16)
    const moved = groupFor(registryLabel('palette'))
    if (moved === null) throw new Error('palette badge missing after scroll')
    expect(moved.dataset['placement']).toBe('below')
    expect(parseFloat(moved.style.top)).toBe(52)
  })

  it('advertises only the actions the current state can run', () => {
    const signedOut = renderDeck(imagePost())

    hold()
    // signed out: the interaction keys belong to a button that only offers a
    // login, so they are not painted
    const shown = signedOut.badges()
    expect(shown).toContain(registryLabel('card-copy'))
    expect(shown).not.toContain(registryLabel('card-like'))
    expect(shown).not.toContain(registryLabel('card-reply'))
    expect(shown).not.toContain(registryLabel('card-delete'))
    // an image embed answers to `m`
    expect(shown).toContain(registryLabel('card-media'))
    signedOut.unmount()

    const labelled = renderDeck(
      postFixture({
        labels: ['nudity'],
        embed: {
          type: 'images',
          images: [{ thumb: 't', fullsize: 'f', alt: 'a', width: 4, height: 3 }],
        },
      }),
    )
    hold()
    // labelled media stays closed, so neither the viewer nor its key is offered
    expect(labelled.badges()).not.toContain(registryLabel('card-media'))
    fireEvent.keyUp(window, { key: '?' })
    fireEvent.click(screen.getByRole('button', { name: /show image/i }))
    hold()
    expect(labelled.badges()).toContain(registryLabel('card-media'))
    labelled.unmount()

    const quoted = renderDeck(quotedPost())
    hold()
    expect(quoted.badges()).toContain(registryLabel('card-quoted'))
    quoted.unmount()

    const plain = renderDeck(postFixture())
    hold()
    const plainBadges = plain.badges()
    expect(plainBadges).not.toContain(registryLabel('card-quoted'))
    expect(plainBadges).not.toContain(registryLabel('card-video'))
    expect(plainBadges).not.toContain(registryLabel('card-media'))
    expect(plain.layer()).not.toBeNull()
  })

  it('skips owners that cannot run their action and tolerates unknown ids', () => {
    const { badges, container } = renderDeck(imagePost(), { authed: true })

    const disabled = document.createElement('button')
    disabled.setAttribute('data-keyhint', 'card-like')
    disabled.disabled = true
    const ariaDisabled = document.createElement('button')
    ariaDisabled.setAttribute('data-keyhint', 'card-repost')
    ariaDisabled.setAttribute('aria-disabled', 'true')
    // an owner typo must not take the overlay down with it
    const unknown = document.createElement('button')
    unknown.setAttribute('data-keyhint', 'not-a-registry-binding')
    container.append(disabled, ariaDisabled, unknown)

    expect(() => {
      hold()
    }).not.toThrow()

    const shown = badges()
    // the card's own live controls are the only owners of these keys
    expect(shown.filter((label) => label === registryLabel('card-like'))).toHaveLength(1)
    expect(shown.filter((label) => label === registryLabel('card-repost'))).toHaveLength(1)
    expect(shown).toContain(registryLabel('card-copy'))
  })

  it('obeys the character shortcut setting and clears a pending or painted hold', () => {
    const { layer } = renderDeck(imagePost(), { authed: true })

    hold()
    expect(layer()).not.toBeNull()
    act(() => {
      useSettings.setState({ keyboardShortcuts: false })
    })
    expect(layer()).toBeNull()

    // while off, `?` starts neither the hint hold nor the help tap
    fireEvent.keyDown(window, { key: '?' })
    advance(HOLD_THRESHOLD_MS + HOLD_PAINT_MS)
    expect(layer()).toBeNull()
    fireEvent.keyUp(window, { key: '?' })
    expect(useUiStore.getState().dialog).toBeNull()

    // back on, flipping the setting off during the paint beat cancels it too
    act(() => {
      useSettings.setState({ keyboardShortcuts: true })
    })
    fireEvent.keyDown(window, { key: '?' })
    advance(HOLD_THRESHOLD_MS)
    expect(layer()).toBeNull()
    act(() => {
      useSettings.setState({ keyboardShortcuts: false })
    })
    advance(HOLD_PAINT_MS)
    expect(layer()).toBeNull()
    fireEvent.keyUp(window, { key: '?' })
    expect(useUiStore.getState().dialog).toBeNull()
  })
})
