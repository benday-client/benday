import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isRecord } from './records'
import { normalizePortableSettings } from './settingsTransfer'
import type { Theme } from './types'

export const SETTINGS_STORAGE_KEY = 'benday:settings'
export type AppearanceMode = 'light' | 'dark' | 'system'

function systemPrefersLight(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  )
}

/** An explicit mode is fixed; system follows the browser preference. */
export function themeForAppearance(appearance: AppearanceMode, systemLight: boolean): Theme {
  if (appearance === 'light') return 'light'
  if (appearance === 'dark') return 'dark'
  return systemLight ? 'light' : 'dark'
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** Only the stored appearance mode controls the scheme. */
function storedAppearance(stored: Record<string, unknown>): AppearanceMode {
  return isAppearanceMode(stored['appearance']) ? stored['appearance'] : 'system'
}

function storedShortcuts(stored: Record<string, unknown>, fallback: boolean): boolean {
  return typeof stored['keyboardShortcuts'] === 'boolean' ? stored['keyboardShortcuts'] : fallback
}

interface SettingsState {
  theme: Theme
  appearance: AppearanceMode
  keyboardShortcuts: boolean
  imageEffects: boolean
  setAppearance: (appearance: AppearanceMode) => void
  setKeyboardShortcuts: (enabled: boolean) => void
  setImageEffects: (enabled: boolean) => void
  syncSystemTheme: () => void
  /**
   * Validates a bare portable settings snapshot and applies every portable
   * preference in one update. Invalid input leaves the existing state untouched.
   */
  importSettings: (value: unknown) => boolean
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: themeForAppearance('system', systemPrefersLight()),
      appearance: 'system',
      keyboardShortcuts: true,
      imageEffects: true,
      setAppearance: (appearance) =>
        set({ appearance, theme: themeForAppearance(appearance, systemPrefersLight()) }),
      setKeyboardShortcuts: (keyboardShortcuts) => set({ keyboardShortcuts }),
      setImageEffects: (imageEffects) => set({ imageEffects }),
      syncSystemTheme: () => {
        // only the system mode follows the browser; an explicit mode is fixed
        const state = get()
        if (state.appearance !== 'system') return
        const next = themeForAppearance('system', systemPrefersLight())
        if (next !== state.theme) set({ theme: next })
      },
      importSettings: (value) => {
        const settings = normalizePortableSettings(value)
        if (settings === null) return false
        set({
          // the rendered theme follows the mode, not a contradictory file field
          theme: themeForAppearance(settings.appearance, systemPrefersLight()),
          appearance: settings.appearance,
          keyboardShortcuts: settings.keyboardShortcuts,
          imageEffects: settings.imageEffects,
        })
        return true
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 3,
      // older versions also stored retired palettes and chrome fields; the mode,
      // the shortcut preference and the dither preference survive the migration
      migrate: (persisted) => {
        if (!isRecord(persisted)) return persisted
        return {
          appearance: storedAppearance(persisted),
          keyboardShortcuts: storedShortcuts(persisted, true),
          imageEffects:
            typeof persisted['imageEffects'] === 'boolean' ? persisted['imageEffects'] : true,
        }
      },
      partialize: (state) => ({
        appearance: state.appearance,
        keyboardShortcuts: state.keyboardShortcuts,
        imageEffects: state.imageEffects,
      }),
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current
        // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
        const appearance = storedAppearance(persisted)
        return {
          ...current,
          theme: themeForAppearance(appearance, systemPrefersLight()),
          appearance,
          keyboardShortcuts: storedShortcuts(persisted, true),
          imageEffects:
            typeof persisted['imageEffects'] === 'boolean' ? persisted['imageEffects'] : true,
        }
      },
    },
  ),
)

// The persist middleware only reads storage at startup. Rehydrate when another
// tab writes the same key so appearance changes follow the user
// across tabs without a reload.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SETTINGS_STORAGE_KEY) return
    void useSettings.persist.rehydrate()
  })
}
