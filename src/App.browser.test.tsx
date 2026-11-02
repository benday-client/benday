import { QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import App from './App'
import { Deck } from './components/Deck'
import { PostCard } from './components/PostCard'
import { installCursors } from './lib/cursors'
import { useSettings } from './lib/store'
import { useUiStore } from './lib/ui'
import { resolveSrgbColor } from './test/colors'
import { postFixture } from './test/fixtures'
import { createTestQueryClient } from './test/queryClient'
import { renderStage } from './test/stage'

function cursorSvg(property: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(property)
  const match = /url\("data:image\/svg\+xml,([^"]+)"\)/.exec(value)
  if (match?.[1] === undefined) throw new Error(`no svg cursor in ${property}: ${value}`)
  return decodeURIComponent(match[1])
}

function paintedColors(svg: string): string[] {
  return [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1] ?? '')
}

/** Whether every painted channel of a cursor colour is the same extreme. */
function isChannel(color: string, expected: 0 | 255): boolean {
  const { r, g, b } = resolveSrgbColor(color)
  return r === expected && g === expected && b === expected
}

/** Resolves a theme token as the reader's browser actually paints it. */
function paintedToken(name: string) {
  const holder = document.createElement('span')
  holder.setAttribute('style', `position:absolute;left:-9999px;color:var(${name})`)
  document.body.append(holder)
  try {
    return resolveSrgbColor(getComputedStyle(holder).color)
  } finally {
    holder.remove()
  }
}

function expectConcrete(svg: string): string[] {
  const colors = paintedColors(svg)
  expect(colors.length).toBeGreaterThan(0)
  for (const color of colors) {
    expect(color).not.toContain('light-dark(')
    expect(color).not.toContain('var(')
    // resolving throws for anything the browser cannot paint, which is exactly
    // the failure a cursor asset would show as a missing image
    resolveSrgbColor(color)
  }
  return colors
}

async function mountApp(): Promise<() => void> {
  window.history.pushState({}, '', '/search')
  let unmount = () => {}
  await act(async () => {
    unmount = render(<App />).unmount
  })
  return unmount
}

describe('live appearance', () => {
  it('repaints cursors with real high-contrast colors on a dark scheme', async () => {
    useSettings.setState({
      appearance: 'dark',
      theme: 'void',
      lightTheme: 'bone',
      darkTheme: 'void',
      highContrast: false,
    })
    const unmount = await mountApp()
    try {
      const normal = cursorSvg('--cursor-default')
      expect(paintedColors(normal).map(resolveSrgbColor)).toContainEqual(paintedToken('--blue'))
      expectConcrete(normal)

      await act(async () => {
        useSettings.getState().setHighContrast(true)
      })
      const high = cursorSvg('--cursor-default')
      expect(high).not.toBe(normal)
      const colors = expectConcrete(high)
      // dark scheme ink is white, not the unresolved light-dark() pair
      expect(colors.some((color) => isChannel(color, 255))).toBe(true)
      // the theme itself did not change; only the palette did
      expect(document.documentElement.dataset['theme']).toBe('void')
      expect(document.documentElement.dataset['contrast']).toBe('high')

      await act(async () => {
        useSettings.getState().setHighContrast(false)
      })
      expect(cursorSvg('--cursor-default')).toBe(normal)
    } finally {
      unmount()
    }
  })

  it('resolves the light half of the high-contrast pair on a light scheme', async () => {
    useSettings.setState({
      appearance: 'light',
      theme: 'bone',
      lightTheme: 'bone',
      darkTheme: 'void',
      highContrast: true,
    })
    const unmount = await mountApp()
    try {
      expect(document.documentElement.dataset['contrast']).toBe('high')
      const colors = expectConcrete(cursorSvg('--cursor-default'))
      expect(colors.some((color) => isChannel(color, 0))).toBe(true)
    } finally {
      unmount()
    }
  })

  it('serializes oklch cursor tokens to the colours they paint', async () => {
    const root = document.documentElement
    const saved = {
      ink: root.style.getPropertyValue('--ink'),
      blue: root.style.getPropertyValue('--blue'),
      paper: root.style.getPropertyValue('--paper'),
    }
    const tokens = {
      '--ink': 'oklch(0.85 0.04 250)',
      '--blue': 'oklch(0.72 0.14 260)',
      '--paper': 'oklch(0.22 0.02 250)',
    }
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
    try {
      installCursors()
      const colors = expectConcrete(cursorSvg('--cursor-pointer')).map(resolveSrgbColor)
      for (const value of Object.values(tokens)) {
        expect(colors).toContainEqual(resolveSrgbColor(value))
      }
    } finally {
      root.style.setProperty('--ink', saved.ink)
      root.style.setProperty('--blue', saved.blue)
      root.style.setProperty('--paper', saved.paper)
      installCursors()
    }
  })

  it('paints a stored high-contrast preference in the same commit as the theme', async () => {
    useSettings.setState({
      appearance: 'dark',
      theme: 'oxide',
      lightTheme: 'bone',
      darkTheme: 'oxide',
      highContrast: true,
    })
    const unmount = await mountApp()
    try {
      expect(document.documentElement.dataset['theme']).toBe('oxide')
      expect(document.documentElement.dataset['contrast']).toBe('high')
      expect(
        expectConcrete(cursorSvg('--cursor-default')).some((color) => isChannel(color, 255)),
      ).toBe(true)
    } finally {
      unmount()
    }
  })

  it('keeps the chrome meta readable in high contrast', async () => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const created = meta === null
    if (meta === null) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.append(meta)
    }
    useSettings.setState({
      appearance: 'dark',
      theme: 'void',
      lightTheme: 'bone',
      darkTheme: 'void',
      highContrast: false,
    })
    const unmount = await mountApp()
    try {
      await vi.waitFor(() =>
        expect(resolveSrgbColor(meta?.content ?? '')).toEqual(resolveSrgbColor('#07090c')),
      )

      await act(async () => {
        useSettings.getState().setHighContrast(true)
      })
      // a dark scheme asks the browser for black chrome instead of the palette
      await vi.waitFor(() =>
        expect(resolveSrgbColor(meta?.content ?? '')).toEqual(resolveSrgbColor('#000000')),
      )

      await act(async () => {
        useSettings.setState({ appearance: 'light', lightTheme: 'bone', theme: 'bone' })
      })
      await vi.waitFor(() =>
        expect(resolveSrgbColor(meta?.content ?? '')).toEqual(resolveSrgbColor('#ffffff')),
      )
    } finally {
      unmount()
      if (created) meta.remove()
    }
  })

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
    expect(stage.getAnimations()).toHaveLength(0)
    expect(Number.parseFloat(stageStyle.opacity)).toBe(1)
  })
})
