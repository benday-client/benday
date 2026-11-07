import { QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import App from './App'
import { Deck } from './components/Deck'
import { PostCard } from './components/PostCard'
import { useUiStore } from './lib/ui'
import { postFixture } from './test/fixtures'
import { createTestQueryClient } from './test/queryClient'
import { renderStage } from './test/stage'

async function mountApp(): Promise<() => void> {
  window.history.pushState({}, '', '/search')
  let unmount = () => {}
  await act(async () => {
    unmount = render(<App />).unmount
  })
  return unmount
}

describe('app shell', () => {
  it('gives main the route context after a cross-route swap', async () => {
    const unmount = await mountApp()
    try {
      const main = document.querySelector<HTMLElement>('.b-main')
      if (main === null) throw new Error('main missing')
      // the search field owns focus while its route is on screen
      expect(document.activeElement).not.toBe(main)

      await act(async () => {
        window.history.pushState({}, '', '/notifications')
      })
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(main)
      })
      // the focus move never scrolls the shell
      expect(window.scrollY).toBe(0)
    } finally {
      unmount()
    }
  })

  it('keeps escape owned by the open settings dialog', async () => {
    const unmount = await mountApp()
    try {
      await act(async () => {
        useUiStore.getState().openDialog('settings')
      })
      await vi.waitFor(() => {
        expect(document.querySelector('dialog[open]')).not.toBeNull()
      })
      expect(window.location.pathname).toBe('/search')

      await userEvent.keyboard('{Escape}')

      await vi.waitFor(() => {
        expect(document.querySelector('dialog[open]')).toBeNull()
      })
      // the app-level escape must not have taken the route away
      expect(window.location.pathname).toBe('/search')
    } finally {
      unmount()
    }
  })
})

const STILL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

/**
 * The app-wide reduced-motion rule floors every transition at 0.01ms so
 * transitionend listeners still fire, which Chrome serialises as `1e-05s`.
 * Suppressed motion therefore reads as that floor, never as the theme's
 * `--motion-dur`.
 */
function transitionMs(duration: string): number {
  const first = (duration.split(',')[0] ?? '0s').trim()
  const value = Number.parseFloat(first)
  return first.endsWith('ms') ? value : value * 1000
}

describe('reduced motion', () => {
  it('fills the deck and opens the viewer without starting an animation', async () => {
    // the browser project asks for reduced motion; a silent change here would
    // make every assertion below pass without proving the bypass
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)

    const queryClient = createTestQueryClient()
    const memory = memoryLocation({ path: '/feed' })
    const post = postFixture({
      text: 'card with a still',
      embed: {
        type: 'images',
        images: [{ thumb: STILL, fullsize: STILL, alt: 'a still', width: 8, height: 8 }],
      },
    })

    renderStage(
      <QueryClientProvider client={queryClient}>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <section className="b-view">
            <div className="b-view__body">
              <Deck
                items={[post]}
                getKey={(item) => item.uri}
                renderItem={(item, index, focused) => (
                  <PostCard post={item} index={index} focused={focused} />
                )}
                label="cards"
              />
            </div>
          </section>
        </Router>
      </QueryClientProvider>,
    )

    const item = document.querySelector<HTMLElement>('.b-deck__item')
    if (item === null) throw new Error('deck item missing')
    const itemStyle = getComputedStyle(item)
    expect(item.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(itemStyle.animationName).toBe('none')
    expect(transitionMs(itemStyle.transitionDuration)).toBeLessThanOrEqual(0.01)
    expect(item.getAnimations()).toHaveLength(0)
    // and it is painted at full weight straight away, not mid-fade
    expect(Number.parseFloat(itemStyle.opacity)).toBe(1)

    // the real shortcut on the focused card opens the real viewer
    await userEvent.keyboard('m')

    const stage = document.querySelector<HTMLElement>('.b-media-viewer__stage')
    if (stage === null) throw new Error('viewer stage missing')
    await vi.waitFor(() => {
      expect(stage.closest('dialog')?.open).toBe(true)
    })
    expect(stage.getBoundingClientRect().height).toBeGreaterThan(0)

    const stageStyle = getComputedStyle(stage)
    expect(stageStyle.animationName).toBe('none')
    expect(transitionMs(stageStyle.transitionDuration)).toBeLessThanOrEqual(0.01)
    // a zero-duration transition may exist for the opening frame; nothing may
    // still be running once the dialog has settled
    await vi.waitFor(() => {
      expect(
        stage.getAnimations().filter((animation) => animation.playState === 'running'),
      ).toHaveLength(0)
    })
    expect(Number.parseFloat(stageStyle.opacity)).toBe(1)
  })
})
