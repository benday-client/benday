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
    theme: 'dark',
    keyboardShortcuts: true,
    imageEffects: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('themeForAppearance', () => {
  it('keeps explicit modes independent of the browser preference', () => {
    expect(themeForAppearance('light', false)).toBe('light')
    expect(themeForAppearance('dark', true)).toBe('dark')
  })

  it('follows the system preference only in system mode', () => {
    expect(themeForAppearance('system', true)).toBe('light')
    expect(themeForAppearance('system', false)).toBe('dark')
  })
})

describe('appearance mode', () => {
  it('derives the theme when the mode changes', () => {
    useSettings.getState().setAppearance('light')
    expect(useSettings.getState().theme).toBe('light')

    useSettings.getState().setAppearance('dark')
    expect(useSettings.getState().theme).toBe('dark')
  })

  it('follows a system preference change only in system mode', () => {
    stubSystemPreference(true)
    useSettings.setState({ appearance: 'system', theme: 'dark' })
    useSettings.getState().syncSystemTheme()
    expect(useSettings.getState().theme).toBe('light')

    stubSystemPreference(false)
    useSettings.getState().syncSystemTheme()
    expect(useSettings.getState().theme).toBe('dark')

    // an explicit mode is fixed, not browser-dependent
    useSettings.getState().setAppearance('light')
    stubSystemPreference(false)
    useSettings.getState().syncSystemTheme()
    expect(useSettings.getState().theme).toBe('light')
  })
})

describe('settings persistence', () => {
  it('persists the portable preferences, never the derived theme', () => {
    useSettings.getState().setAppearance('light')

    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as {
      version?: number
      state?: Record<string, unknown>
    }
    expect(stored.version).toBe(3)
    expect(stored.state).toEqual({
      appearance: 'light',
      keyboardShortcuts: true,
      imageEffects: true,
    })
  })

  it('starts fresh at system with the browser preference', () => {
    expect(useSettings.getInitialState()).toMatchObject({
      appearance: 'system',
      keyboardShortcuts: true,
      imageEffects: true,
    })
  })

  it('rehydrates the appearance and effect changes written by another tab', async () => {
    const raw = JSON.stringify({
      version: 1,
      state: { appearance: 'light', imageEffects: false },
    })
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw)

    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY, newValue: raw }))

    await vi.waitFor(() => {
      expect(useSettings.getState().appearance).toBe('light')
    })
    expect(useSettings.getState().theme).toBe('light')
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

  it('defaults image effects on and persists a toggle', async () => {
    expect(useSettings.getInitialState().imageEffects).toBe(true)

    useSettings.getState().setImageEffects(false)
    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as {
      version?: number
      state?: { imageEffects?: boolean }
    }
    expect(stored.version).toBe(3)
    expect(stored.state?.imageEffects).toBe(false)

    await useSettings.persist.rehydrate()
    expect(useSettings.getState().imageEffects).toBe(false)
  })
})

describe('stored state migration', () => {
  function rehydrate(stored: Record<string, unknown>, version = 1) {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version, state: stored }))
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
    expect(useSettings.getState().theme).toBe('light')
  })

  it('ignores retired theme names when no appearance mode is stored', async () => {
    stubSystemPreference(true)
    await rehydrate({ theme: 'retired' })
    expect(useSettings.getState().appearance).toBe('system')
    expect(useSettings.getState().theme).toBe('light')
  })

  it('falls back to system for an unusable appearance mode', async () => {
    await rehydrate({ appearance: 'invalid' })
    expect(useSettings.getState().appearance).toBe('system')
    expect(useSettings.getState().theme).toBe('dark')
  })

  it('keeps a disabled effect preference through the migration', async () => {
    for (const version of [1, 2]) {
      await rehydrate({ appearance: 'dark', imageEffects: false }, version)
      expect(useSettings.getState().imageEffects, String(version)).toBe(false)
    }
  })

  it('defaults a missing or wrong-typed effect preference to on', async () => {
    for (const imageEffects of [undefined, 'off', 0, null, {}, []]) {
      useSettings.setState({ imageEffects: false })
      await rehydrate({ appearance: 'dark', imageEffects })
      expect(useSettings.getState().imageEffects, String(imageEffects)).toBe(true)
    }
  })

  it('drops the retired fields from the stored state', async () => {
    await rehydrate({
      appearance: 'dark',
      labelers: ['did:plc:junk'],
      imageEffects: false,
      highContrast: true,
    })

    // the next write stores the partialized shape, not the ignored fields
    useSettings.getState().setKeyboardShortcuts(false)
    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as {
      version?: number
      state?: Record<string, unknown>
    }
    expect(stored.version).toBe(3)
    expect(Object.keys(stored.state ?? {}).sort()).toEqual([
      'appearance',
      'imageEffects',
      'keyboardShortcuts',
    ])
    expect(stored.state).not.toHaveProperty('labelers')
    expect(stored.state).not.toHaveProperty('highContrast')
    expect(stored.state).not.toHaveProperty('theme')
    expect(stored.state?.['keyboardShortcuts']).toBe(false)
    expect(stored.state?.['imageEffects']).toBe(false)
  })
})
