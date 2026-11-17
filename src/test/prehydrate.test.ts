import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import { themeColor as chromeColor } from '../lib/themes'

// Deliberately not imported from the store: this file must prove the bootstrap
// paints without loading the app or its persisted store.
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
  it('paints an explicit dark mode before React', () => {
    storedSettings({ appearance: 'dark' })

    runBootstrap()

    expect(rootTheme()).toBe('dark')
    expect(themeColor()).toBe(chromeColor('dark'))
  })

  it('paints an explicit light mode before React', () => {
    storedSettings({ appearance: 'light' })

    runBootstrap()

    expect(rootTheme()).toBe('light')
    expect(themeColor()).toBe(chromeColor('light'))
  })

  it('reads the system preference through matchMedia', () => {
    storedSettings({ appearance: 'system' })
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') }))
    runBootstrap()
    expect(rootTheme()).toBe('light')

    delete document.documentElement.dataset['theme']
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    runBootstrap()
    expect(rootTheme()).toBe('dark')
  })

  it('ignores a retired theme and follows the system when no mode is stored', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') }))
    storedSettings({ theme: 'retired' })
    runBootstrap()
    expect(rootTheme()).toBe('light')
  })

  it('falls back to system when the mode is unusable', () => {
    storedSettings({ appearance: 'invalid' })

    runBootstrap()

    expect(rootTheme()).toBe('dark')
  })

  it('ignores the retired pair and labelers', () => {
    storedSettings({
      appearance: 'light',
      lightTheme: 'bone',
      darkTheme: 'dead-leaves',
      labelers: ['did:plc:junk'],
    })

    runBootstrap()

    expect(rootTheme()).toBe('light')
  })

  it('paints the system theme when stored settings cannot be read', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('light') }))

    localStorage.setItem(SETTINGS_STORAGE_KEY, 'not json at all')
    expect(() => runBootstrap()).not.toThrow()
    expect(rootTheme()).toBe('light')
    expect(themeColor()).toBe(chromeColor('light'))

    delete document.documentElement.dataset['theme']
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    expect(() => runBootstrap()).not.toThrow()
    read.mockRestore()
    expect(rootTheme()).toBe('light')
    expect(themeColor()).toBe(chromeColor('light'))

    // an explicit stored mode still wins over the system fallback
    delete document.documentElement.dataset['theme']
    storedSettings({ appearance: 'dark' })
    runBootstrap()
    expect(rootTheme()).toBe('dark')
    expect(themeColor()).toBe(chromeColor('dark'))
  })
})

afterEach(() => {
  vi.useRealTimers()
})
