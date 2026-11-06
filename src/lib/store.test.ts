import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_STORAGE_KEY, useSettings } from './store'

describe('settings storage sync', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState({
      theme: 'void',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
      highContrast: false,
      keyboardShortcuts: true,
      labelers: [],
    })
  })

  it('applies an imported appearance pair and high contrast in one update', async () => {
    const applied = useSettings.getState().importSettings({
      theme: 'void',
      appearance: 'light',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
      highContrast: true,
      labelers: [],
    })

    expect(applied).toBe(true)
    // the rendered theme follows the appearance pair the file also carries
    expect(useSettings.getState().theme).toBe('bone')
    expect(useSettings.getState().highContrast).toBe(true)

    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as { state?: { highContrast?: boolean } }
    expect(stored.state?.highContrast).toBe(true)

    // a later write must not erase what a reload reads back
    useSettings.setState({ highContrast: false, theme: 'void' })
    localStorage.setItem(SETTINGS_STORAGE_KEY, persisted)
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().highContrast).toBe(true)
  })

  it('rehydrates a high contrast change from another tab', async () => {
    const stored = {
      version: 1,
      state: {
        theme: 'void',
        appearance: 'dark',
        lightTheme: 'bone',
        darkTheme: 'void',
        imageEffects: true,
        highContrast: true,
        labelers: [],
      },
    }
    const raw = JSON.stringify(stored)
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw)

    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY, newValue: raw }))

    await vi.waitFor(() => {
      expect(useSettings.getState().highContrast).toBe(true)
    })
  })

  it('rehydrates settings written by another tab', async () => {
    const stored = {
      version: 1,
      state: {
        theme: 'oxide',
        appearance: 'dark',
        lightTheme: 'bone',
        darkTheme: 'oxide',
        imageEffects: false,
        labelers: ['did:plc:ar7c4by46qjdydhdevvrndac'],
      },
    }
    const raw = JSON.stringify(stored)
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw)

    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY, newValue: raw }))

    await vi.waitFor(() => {
      expect(useSettings.getState().theme).toBe('oxide')
    })
    expect(useSettings.getState().imageEffects).toBe(false)
    expect(useSettings.getState().labelers).toEqual(['did:plc:ar7c4by46qjdydhdevvrndac'])
  })

  it('defaults keyboard shortcuts on and persists a toggle', async () => {
    expect(useSettings.getInitialState().keyboardShortcuts).toBe(true)

    useSettings.getState().setKeyboardShortcuts(false)
    expect(useSettings.getState().keyboardShortcuts).toBe(false)
    // the toggle is one setting only
    expect(useSettings.getState().theme).toBe('void')
    expect(useSettings.getState().highContrast).toBe(false)

    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as { state?: { keyboardShortcuts?: boolean } }
    expect(stored.state?.keyboardShortcuts).toBe(false)

    // a reload reads the stored choice back rather than the default
    await useSettings.persist.rehydrate()
    expect(useSettings.getState().keyboardShortcuts).toBe(false)
  })

  it('rehydrates a keyboard shortcuts change from another tab', async () => {
    const raw = JSON.stringify({
      version: 1,
      state: {
        theme: 'void',
        appearance: 'dark',
        lightTheme: 'bone',
        darkTheme: 'void',
        imageEffects: true,
        keyboardShortcuts: false,
        labelers: [],
      },
    })
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw)

    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY, newValue: raw }))

    await vi.waitFor(() => {
      expect(useSettings.getState().keyboardShortcuts).toBe(false)
    })
  })

  it('ignores a non-boolean stored keyboard shortcut field', async () => {
    useSettings.setState({ keyboardShortcuts: true })
    const raw = JSON.stringify({
      version: 1,
      state: {
        theme: 'void',
        appearance: 'dark',
        lightTheme: 'bone',
        darkTheme: 'void',
        imageEffects: true,
        keyboardShortcuts: 'off',
        labelers: [],
      },
    })
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw)

    await useSettings.persist.rehydrate()

    expect(useSettings.getState().keyboardShortcuts).toBe(true)
  })

  it('imports the portable keyboard shortcut setting and defaults a missing field to on', () => {
    const snapshot = {
      theme: 'void',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
      highContrast: false,
      labelers: [],
    } as const

    useSettings.getState().setKeyboardShortcuts(false)
    // a file written before the option existed keeps shortcuts available
    expect(useSettings.getState().importSettings({ ...snapshot })).toBe(true)
    expect(useSettings.getState().keyboardShortcuts).toBe(true)

    expect(useSettings.getState().importSettings({ ...snapshot, keyboardShortcuts: false })).toBe(
      true,
    )
    expect(useSettings.getState().keyboardShortcuts).toBe(false)

    // a malformed field is ignored rather than adopted or rejected
    expect(useSettings.getState().importSettings({ ...snapshot, keyboardShortcuts: 'off' })).toBe(
      true,
    )
    expect(useSettings.getState().keyboardShortcuts).toBe(true)

    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as { state?: { keyboardShortcuts?: boolean } }
    expect(stored.state?.keyboardShortcuts).toBe(true)
  })
})

describe('labeler validation', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState({ labelers: [] })
  })

  it('refuses a did the sdk would reject when adding one', () => {
    const { addLabeler } = useSettings.getState()
    addLabeler('did:plc')
    addLabeler('did:plcabc')
    addLabeler('did:plc:')
    expect(useSettings.getState().labelers).toEqual([])

    addLabeler('did:plc:bendaylabeler')
    expect(useSettings.getState().labelers).toEqual(['did:plc:bendaylabeler'])
  })

  it('drops invalid dids from an imported settings file', () => {
    const applied = useSettings.getState().importSettings({
      theme: 'void',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
      highContrast: false,
      labelers: ['did:plc:bendaylabeler', 'did:plc', 'did:plcabc', 'did:plc:'],
    })

    expect(applied).toBe(true)
    expect(useSettings.getState().labelers).toEqual(['did:plc:bendaylabeler'])
  })

  it('drops invalid dids from storage written by another tab', async () => {
    const stored = {
      version: 1,
      state: {
        theme: 'void',
        appearance: 'dark',
        lightTheme: 'bone',
        darkTheme: 'void',
        imageEffects: true,
        labelers: ['did:plc:bendaylabeler', 'did:plc', 'did:plcabc'],
      },
    }
    const raw = JSON.stringify(stored)
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw)

    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_STORAGE_KEY, newValue: raw }))

    await vi.waitFor(() => {
      expect(useSettings.getState().labelers).toEqual(['did:plc:bendaylabeler'])
    })
  })
})
