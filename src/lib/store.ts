import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isRecord } from './records'
import { normalizePortableSettings, normalizeTheme } from './settingsTransfer'
import { resolveTheme, THEME_SCHEMES } from './themes'
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

function selectedTheme(appearance: AppearanceMode, lightTheme: Theme, darkTheme: Theme): Theme {
  if (appearance === 'light') return lightTheme
  if (appearance === 'dark') return darkTheme
  return systemPrefersLight() ? lightTheme : darkTheme
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

interface SettingsState {
  theme: Theme
  appearance: AppearanceMode
  lightTheme: Theme
  darkTheme: Theme
  imageEffects: boolean
  highContrast: boolean
  keyboardShortcuts: boolean
  setTheme: (theme: Theme) => void
  setAppearance: (appearance: AppearanceMode) => void
  setLightTheme: (theme: Theme) => void
  setDarkTheme: (theme: Theme) => void
  setImageEffects: (enabled: boolean) => void
  setHighContrast: (enabled: boolean) => void
  setKeyboardShortcuts: (enabled: boolean) => void
  syncSystemTheme: () => void
  setActiveTheme: (theme: Theme) => void
  /**
   * Validates a bare portable settings snapshot and applies every portable
   * preference in one update. Invalid input leaves the existing state untouched.
   */
  importSettings: (value: unknown) => boolean
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'void',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
      highContrast: false,
      keyboardShortcuts: true,
      setTheme: (theme) =>
        set({
          theme,
          appearance: THEME_SCHEMES[theme],
          ...(THEME_SCHEMES[theme] === 'light' ? { lightTheme: theme } : { darkTheme: theme }),
        }),
      setAppearance: (appearance) =>
        set((state) => ({
          appearance,
          theme: selectedTheme(appearance, state.lightTheme, state.darkTheme),
        })),
      setLightTheme: (lightTheme) =>
        set((state) => ({
          lightTheme,
          theme:
            state.appearance === 'light' || (state.appearance === 'system' && systemPrefersLight())
              ? lightTheme
              : state.theme,
        })),
      setDarkTheme: (darkTheme) =>
        set((state) => ({
          darkTheme,
          theme:
            state.appearance === 'dark' || (state.appearance === 'system' && !systemPrefersLight())
              ? darkTheme
              : state.theme,
        })),
      setImageEffects: (imageEffects) => set({ imageEffects }),
      setHighContrast: (highContrast) => set({ highContrast }),
      setKeyboardShortcuts: (keyboardShortcuts) => set({ keyboardShortcuts }),
      syncSystemTheme: () => {
        // Resolve the saved pair, not the last rendered theme: October's
        // seasonal theme is unavailable in November and becomes available again
        // in October, so the pair has to survive the fallback either way.
        const state = get()
        const next = resolveTheme(
          selectedTheme(state.appearance, state.lightTheme, state.darkTheme),
          new Date(),
        )
        if (next !== state.theme) set({ theme: next })
      },
      setActiveTheme: (theme) => set({ theme }),
      importSettings: (value) => {
        const settings = normalizePortableSettings(value)
        if (settings === null) return false
        set({
          // the rendered theme follows the appearance pair, not a contradictory
          // file field
          theme: selectedTheme(settings.appearance, settings.lightTheme, settings.darkTheme),
          appearance: settings.appearance,
          lightTheme: settings.lightTheme,
          darkTheme: settings.darkTheme,
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
        theme: state.theme,
        appearance: state.appearance,
        lightTheme: state.lightTheme,
        darkTheme: state.darkTheme,
        imageEffects: state.imageEffects,
        highContrast: state.highContrast,
        keyboardShortcuts: state.keyboardShortcuts,
      }),
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current
        const stored = persisted
        // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
        const legacyTheme = normalizeTheme(stored['theme'])
        const lightTheme =
          normalizeTheme(stored['lightTheme']) ??
          (legacyTheme !== null && THEME_SCHEMES[legacyTheme] === 'light'
            ? legacyTheme
            : current.lightTheme)
        const darkTheme =
          normalizeTheme(stored['darkTheme']) ??
          (legacyTheme !== null && THEME_SCHEMES[legacyTheme] === 'dark'
            ? legacyTheme
            : current.darkTheme)
        const appearance = isAppearanceMode(stored['appearance'])
          ? stored['appearance']
          : legacyTheme !== null
            ? THEME_SCHEMES[legacyTheme]
            : current.appearance
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
          theme: selectedTheme(appearance, lightTheme, darkTheme),
          appearance,
          lightTheme,
          darkTheme,
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
