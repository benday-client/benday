import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'

// Deliberately not imported from the store: this file must prove the bootstrap
// paints before any app module is evaluated.
const SETTINGS_STORAGE_KEY = 'benday:settings'

// vite inlines the shipped document, so this executes the real bootstrap even
// though jsdom has no file:// url to read from.
const html = indexHtml

function bootstrapSource(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html)
  if (match === null) throw new Error('index.html no longer has an inline bootstrap')
  return match[1] ?? ''
}

const SOURCE = bootstrapSource()

function runBootstrap(): void {
  // exactly what a browser executes before the module graph loads
  new Function(SOURCE)()
}

function storedSettings(state: Record<string, unknown>): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ state, version: 1 }))
}

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null
}

function rootTheme(): string | undefined {
  return document.documentElement.dataset['theme']
}

beforeEach(() => {
  delete document.documentElement.dataset['theme']
  // jsdom starts from a blank document; the shipped head is not loaded here.
  let meta = document.querySelector('meta[name="theme-color"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', '#000000')
})

describe('the first-paint bootstrap', () => {
  it('paints an explicit dark mode as mocha before React', () => {
    storedSettings({ appearance: 'dark' })

    runBootstrap()

    expect(rootTheme()).toBe('catppuccin-mocha')
    expect(themeColor()).toBe('#1e1e2e')
  })

  it('paints an explicit light mode as latte', () => {
    storedSettings({ appearance: 'light' })

    runBootstrap()

    expect(rootTheme()).toBe('catppuccin-latte')
    expect(themeColor()).toBe('#eff1f5')
  })

  it('reads the system preference through matchMedia', () => {
    storedSettings({ appearance: 'system' })
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') }))
    runBootstrap()
    expect(rootTheme()).toBe('catppuccin-latte')

    delete document.documentElement.dataset['theme']
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    runBootstrap()
    expect(rootTheme()).toBe('catppuccin-mocha')
  })

  it('derives the mode from a legacy palette', () => {
    storedSettings({ theme: 'bone' })
    runBootstrap()
    expect(rootTheme()).toBe('catppuccin-latte')

    delete document.documentElement.dataset['theme']
    storedSettings({ theme: 'dracula' })
    runBootstrap()
    expect(rootTheme()).toBe('catppuccin-mocha')

    delete document.documentElement.dataset['theme']
    storedSettings({ theme: 'duotone' })
    runBootstrap()
    expect(rootTheme()).toBe('catppuccin-mocha')
  })

  it('falls back to system when the mode and legacy palette are unusable', () => {
    storedSettings({ appearance: 'void', theme: 'neon' })

    runBootstrap()

    expect(rootTheme()).toBe('catppuccin-mocha')
  })

  it('ignores the retired pair and labelers', () => {
    storedSettings({
      appearance: 'light',
      lightTheme: 'bone',
      darkTheme: 'dead-leaves',
      labelers: ['did:plc:junk'],
    })

    runBootstrap()

    expect(rootTheme()).toBe('catppuccin-latte')
  })

  it('uses the palette chrome colours', () => {
    storedSettings({ appearance: 'light' })
    runBootstrap()
    expect(themeColor()).toBe('#eff1f5')

    delete document.documentElement.dataset['theme']
    storedSettings({ appearance: 'dark' })
    runBootstrap()
    expect(themeColor()).toBe('#1e1e2e')
  })

  it('paints the system theme when stored settings cannot be read', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') }))

    localStorage.setItem(SETTINGS_STORAGE_KEY, 'not json at all')
    expect(() => runBootstrap()).not.toThrow()
    expect(rootTheme()).toBe('catppuccin-latte')
    expect(themeColor()).toBe('#eff1f5')

    delete document.documentElement.dataset['theme']
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    expect(() => runBootstrap()).not.toThrow()
    read.mockRestore()
    expect(rootTheme()).toBe('catppuccin-latte')
    expect(themeColor()).toBe('#eff1f5')

    // an explicit stored mode still wins over the system fallback
    delete document.documentElement.dataset['theme']
    storedSettings({ appearance: 'dark' })
    runBootstrap()
    expect(rootTheme()).toBe('catppuccin-mocha')
    expect(themeColor()).toBe('#1e1e2e')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
