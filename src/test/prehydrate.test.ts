import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import { THEME_COLORS } from '../lib/themes'

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
const OCTOBER = new Date(2026, 9, 15, 12, 0, 0)
const NOVEMBER = new Date(2026, 10, 15, 12, 0, 0)

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
  delete document.documentElement.dataset['contrast']
  // jsdom starts from a blank document; the shipped head is not loaded here.
  let meta = document.querySelector('meta[name="theme-color"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', '#000000')
  vi.useFakeTimers({ now: NOVEMBER })
})

describe('the first-paint bootstrap', () => {
  it('applies an explicit dark pair before React and keeps the meta in step', () => {
    storedSettings({ appearance: 'dark', lightTheme: 'bone', darkTheme: 'phosphor' })

    runBootstrap()

    expect(rootTheme()).toBe('phosphor')
    expect(themeColor()).toBe('#040906')
  })

  it('applies an explicit light pair', () => {
    storedSettings({ appearance: 'light', lightTheme: 'github-light', darkTheme: 'void' })

    runBootstrap()

    expect(rootTheme()).toBe('github-light')
    expect(themeColor()).toBe('#ffffff')
  })

  it('reads the system preference through matchMedia', () => {
    storedSettings({ appearance: 'system', lightTheme: 'cottagecore', darkTheme: 'dracula' })
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') }))

    runBootstrap()

    expect(rootTheme()).toBe('cottagecore')
  })

  it('uses the legacy theme only for its own scheme', () => {
    storedSettings({ theme: 'dracula' })

    runBootstrap()

    expect(rootTheme()).toBe('dracula')
  })

  it('falls back to bone and void when the pair is missing or invalid', () => {
    storedSettings({ appearance: 'light', lightTheme: 'not-a-theme', darkTheme: 42 })
    runBootstrap()
    expect(rootTheme()).toBe('bone')

    delete document.documentElement.dataset['theme']
    storedSettings({ appearance: 'dark' })
    runBootstrap()
    expect(rootTheme()).toBe('void')
  })

  it('normalizes the legacy duotone name in the pair', () => {
    storedSettings({ appearance: 'light', lightTheme: 'duotone', darkTheme: 'void' })

    runBootstrap()

    expect(rootTheme()).toBe('cyberpunk')
  })

  it('keeps an October pair in October and falls back to void in November', () => {
    storedSettings({ appearance: 'dark', lightTheme: 'bone', darkTheme: 'dead-leaves' })

    vi.setSystemTime(OCTOBER)
    runBootstrap()
    expect(rootTheme()).toBe('dead-leaves')

    delete document.documentElement.dataset['theme']
    vi.setSystemTime(NOVEMBER)
    runBootstrap()
    expect(rootTheme()).toBe('void')
  })

  it('keeps the stored pair when the seasonal fallback fires', () => {
    storedSettings({ appearance: 'dark', lightTheme: 'bone', darkTheme: 'dead-leaves' })
    vi.setSystemTime(NOVEMBER)

    runBootstrap()

    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')
    expect(stored.state.darkTheme).toBe('dead-leaves')
    expect(stored.state.lightTheme).toBe('bone')
    expect(stored.state.theme).toBe('void')
  })

  it('still paints when the normalization write-back throws', () => {
    storedSettings({
      highContrast: true,
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'dead-leaves',
    })
    vi.setSystemTime(NOVEMBER)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    try {
      expect(() => runBootstrap()).not.toThrow()
    } finally {
      setItem.mockRestore()
    }

    expect(rootTheme()).toBe('void')
    expect(document.documentElement.dataset['contrast']).toBe('high')
    expect(themeColor()).toBe('#000000')
  })

  it('uses a white chrome colour for a high contrast light theme', () => {
    storedSettings({
      highContrast: true,
      appearance: 'light',
      lightTheme: 'catppuccin-latte',
      darkTheme: 'void',
    })

    runBootstrap()

    expect(rootTheme()).toBe('catppuccin-latte')
    expect(themeColor()).toBe('#ffffff')
  })

  it('uses a black chrome colour for a high contrast dark theme', () => {
    storedSettings({
      highContrast: true,
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'phosphor',
    })

    runBootstrap()

    expect(rootTheme()).toBe('phosphor')
    expect(themeColor()).toBe('#000000')
  })

  it('uses the palette chrome colour when contrast is normal', () => {
    storedSettings({ highContrast: false, appearance: 'dark', darkTheme: 'oxide' })

    runBootstrap()

    expect(themeColor()).toBe(THEME_COLORS.oxide)
  })

  it('keeps the saved contrast and guards malformed storage', () => {
    storedSettings({ highContrast: true, appearance: 'dark', darkTheme: 'oxide' })
    runBootstrap()
    expect(document.documentElement.dataset['contrast']).toBe('high')

    localStorage.setItem(SETTINGS_STORAGE_KEY, 'not json at all')
    delete document.documentElement.dataset['theme']
    expect(() => runBootstrap()).not.toThrow()
    expect(rootTheme()).toBeUndefined()

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ state: 'nonsense' }))
    runBootstrap()
    expect(rootTheme()).toBe('void')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
