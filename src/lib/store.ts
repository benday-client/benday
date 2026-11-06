import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isRecord } from './records'
import { normalizePortableSettings } from './settingsTransfer'
import { legacyAppearanceForTheme } from './themes'
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

/**
 * Catppuccin is the fixed pair: light paints Latte, dark paints Mocha, and the
 * system mode follows the browser preference.
 */
export function themeForAppearance(appearance: AppearanceMode, systemLight: boolean): Theme {
  if (appearance === 'light') return 'catppuccin-latte'
  if (appearance === 'dark') return 'catppuccin-mocha'
  return systemLight ? 'catppuccin-latte' : 'catppuccin-mocha'
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

interface SettingsState {
  theme: Theme
  appearance: AppearanceMode
  imageEffects: boolean
  highContrast: boolean
  keyboardShortcuts: boolean
  setAppearance: (appearance: AppearanceMode) => void
  setImageEffects: (enabled: boolean) => void
  setHighContrast: (enabled: boolean) => void
  setKeyboardShortcuts: (enabled: boolean) => void
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
      imageEffects: true,
      highContrast: false,
      keyboardShortcuts: true,
      setAppearance: (appearance) =>
        set({ appearance, theme: themeForAppearance(appearance, systemPrefersLight()) }),
      setImageEffects: (imageEffects) => set({ imageEffects }),
      setHighContrast: (highContrast) => set({ highContrast }),
      setKeyboardShortcuts: (keyboardShortcuts) => set({ keyboardShortcuts }),
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
          imageEffects: settings.imageEffects,
          highContrast: settings.highContrast,
          keyboardShortcuts: settings.keyboardShortcuts,
        })
        return true
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        appearance: state.appearance,
        imageEffects: state.imageEffects,
        highContrast: state.highContrast,
        keyboardShortcuts: state.keyboardShortcuts,
      }),
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current
        const stored = persisted
        // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
        // a stored mode wins; an older stored palette names the scheme it painted
        const appearance = isAppearanceMode(stored['appearance'])
          ? stored['appearance']
          : (legacyAppearanceForTheme(stored['theme']) ?? 'system')
        const imageEffects =
          typeof stored['imageEffects'] === 'boolean'
            ? stored['imageEffects']
            : current.imageEffects
        const highContrast =
          typeof stored['highContrast'] === 'boolean'
            ? stored['highContrast']
            : current.highContrast
        const keyboardShortcuts =
          typeof stored['keyboardShortcuts'] === 'boolean'
            ? stored['keyboardShortcuts']
            : current.keyboardShortcuts
        return {
          ...current,
          theme: themeForAppearance(appearance, systemPrefersLight()),
          appearance,
          imageEffects,
          highContrast,
          keyboardShortcuts,
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
