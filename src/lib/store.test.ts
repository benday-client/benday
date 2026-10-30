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
      labelers: [],
    })
  })

  it('rehydrates settings written by another tab', async () => {
    const state = useSettings.getState()
    const stored = {
      version: 1,
      state: {
        appView: state.appView,
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
})
