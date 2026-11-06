import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_STORAGE_KEY, themeForAppearance, useSettings } from './store'

function stubSystemPreference(light: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-color-scheme: light') ? light : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  localStorage.clear()
  stubSystemPreference(false)
  useSettings.setState({
    appearance: 'system',
    theme: 'catppuccin-mocha',
    imageEffects: true,
    highContrast: false,
    keyboardShortcuts: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('themeForAppearance', () => {
  it('maps light and dark to the cat pair', () => {
    expect(themeForAppearance('light', false)).toBe('catppuccin-latte')
    expect(themeForAppearance('dark', true)).toBe('catppuccin-mocha')
  })

  it('follows the system preference only in system mode', () => {
    expect(themeForAppearance('system', true)).toBe('catppuccin-latte')
    expect(themeForAppearance('system', false)).toBe('catppuccin-mocha')
  })
})

describe('appearance mode', () => {
  it('derives the theme when the mode changes', () => {
    useSettings.getState().setAppearance('light')
    expect(useSettings.getState().theme).toBe('catppuccin-latte')

    useSettings.getState().setAppearance('dark')
    expect(useSettings.getState().theme).toBe('catppuccin-mocha')
  })

  it('follows a system preference change only in system mode', () => {
    stubSystemPreference(true)
    useSettings.setState({ appearance: 'system', theme: 'catppuccin-mocha' })
    useSettings.getState().syncSystemTheme()
    expect(useSettings.getState().theme).toBe('catppuccin-latte')

    stubSystemPreference(false)
    useSettings.getState().syncSystemTheme()
    expect(useSettings.getState().theme).toBe('catppuccin-mocha')

    // an explicit mode is fixed, not browser-dependent
    useSettings.getState().setAppearance('light')
    stubSystemPreference(false)
    useSettings.getState().syncSystemTheme()
    expect(useSettings.getState().theme).toBe('catppuccin-latte')
  })
})

describe('settings persistence', () => {
  it('persists only the mode, effects and shortcuts, never the derived theme', () => {
    useSettings.getState().setAppearance('light')
    useSettings.getState().setImageEffects(false)
    useSettings.getState().setHighContrast(true)

    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as { state?: Record<string, unknown> }
    expect(stored.state).toEqual({
      appearance: 'light',
      imageEffects: false,
      highContrast: true,
      keyboardShortcuts: true,
    })
  })

  it('rehydrates a change written by another tab', async () => {
    const raw = JSON.stringify({
      version: 1,
      state: { appearance: 'light', imageEffects: false },
    })
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw)

    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY, newValue: raw }))

    await vi.waitFor(() => {
      expect(useSettings.getState().appearance).toBe('light')
    })
    expect(useSettings.getState().theme).toBe('catppuccin-latte')
    expect(useSettings.getState().imageEffects).toBe(false)
  })

  it('defaults keyboard shortcuts on and persists a toggle', async () => {
    expect(useSettings.getInitialState().keyboardShortcuts).toBe(true)

    useSettings.getState().setKeyboardShortcuts(false)
    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as { state?: { keyboardShortcuts?: boolean } }
    expect(stored.state?.keyboardShortcuts).toBe(false)

    await useSettings.persist.rehydrate()
    expect(useSettings.getState().keyboardShortcuts).toBe(false)
  })
})

describe('stored state migration', () => {
  function rehydrate(stored: Record<string, unknown>) {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, state: stored }))
    return useSettings.persist.rehydrate()
  }

  it('keeps a stored mode and ignores the retired palette pair', async () => {
    await rehydrate({
      appearance: 'light',
      theme: 'dead-leaves',
      lightTheme: 'bone',
      darkTheme: 'dead-leaves',
      labelers: ['did:plc:junk'],
    })

    expect(useSettings.getState().appearance).toBe('light')
    expect(useSettings.getState().theme).toBe('catppuccin-latte')
  })

  it('derives the mode from an old light palette', async () => {
    await rehydrate({ theme: 'bone' })
    expect(useSettings.getState().appearance).toBe('light')
    expect(useSettings.getState().theme).toBe('catppuccin-latte')
  })

  it('derives the mode from an old dark palette, including duotone', async () => {
    await rehydrate({ theme: 'cyberpunk' })
    expect(useSettings.getState().appearance).toBe('dark')
    expect(useSettings.getState().theme).toBe('catppuccin-mocha')

    await rehydrate({ theme: 'duotone' })
    expect(useSettings.getState().appearance).toBe('dark')
  })

  it('falls back to system for an unknown palette and no mode', async () => {
    await rehydrate({ theme: 'neon' })
    expect(useSettings.getState().appearance).toBe('system')
    expect(useSettings.getState().theme).toBe('catppuccin-mocha')
  })

  it('drops the removed fields from the stored state', async () => {
    await rehydrate({
      appearance: 'dark',
      labelers: ['did:plc:junk'],
      imageEffects: false,
    })

    // the next write stores the partialized shape, not the ignored fields
    useSettings.getState().setKeyboardShortcuts(false)
    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as { state?: Record<string, unknown> }
    expect(stored.state).not.toHaveProperty('labelers')
    expect(stored.state?.['imageEffects']).toBe(false)
  })
})
