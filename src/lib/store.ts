import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_APPVIEW, isAppViewTarget, toAppViewTarget } from './appviews'
import {
  normalizePortableSettings,
  normalizeTheme,
  SETTINGS_LABELER_LIMIT,
  sanitizeLabeler,
  sanitizeLabelers,
} from './settingsTransfer'
import { THEME_SCHEMES } from './themes'
import type { AppViewTarget, Theme } from './types'

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
  appView: AppViewTarget
  theme: Theme
  appearance: AppearanceMode
  lightTheme: Theme
  darkTheme: Theme
  imageEffects: boolean
  labelers: string[]
  setAppView: (appView: AppViewTarget) => void
  setTheme: (theme: Theme) => void
  setAppearance: (appearance: AppearanceMode) => void
  setLightTheme: (theme: Theme) => void
  setDarkTheme: (theme: Theme) => void
  setImageEffects: (enabled: boolean) => void
  syncSystemTheme: () => void
  setActiveTheme: (theme: Theme) => void
  addLabeler: (did: string) => void
  removeLabeler: (did: string) => void
  /**
   * Validates a bare portable settings snapshot and applies theme, appview and
   * labelers in one update. Invalid input leaves the existing state untouched.
   */
  importSettings: (value: unknown) => boolean
}

const INITIAL_APPVIEW = toAppViewTarget(DEFAULT_APPVIEW)

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appView: INITIAL_APPVIEW,
      theme: 'void',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'void',
      imageEffects: true,
      labelers: [],
      setAppView: (appView) => set({ appView }),
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
      syncSystemTheme: () =>
        set((state) => ({
          theme: selectedTheme(state.appearance, state.lightTheme, state.darkTheme),
        })),
      setActiveTheme: (theme) => set({ theme }),
      addLabeler: (did) => {
        const labeler = sanitizeLabeler(did)
        if (labeler === null) return
        set((state) => ({
          labelers: state.labelers.includes(labeler)
            ? state.labelers
            : [...state.labelers, labeler].slice(0, SETTINGS_LABELER_LIMIT),
        }))
      },
      removeLabeler: (did) => {
        set((state) => ({ labelers: state.labelers.filter((labeler) => labeler !== did) }))
      },
      importSettings: (value) => {
        const settings = normalizePortableSettings(value)
        if (settings === null) return false
        set({
          theme: settings.theme,
          appearance: settings.appearance,
          lightTheme: settings.lightTheme,
          darkTheme: settings.darkTheme,
          imageEffects: settings.imageEffects,
          appView: settings.appView,
          labelers: settings.labelers,
        })
        return true
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        appView: state.appView,
        theme: state.theme,
        appearance: state.appearance,
        lightTheme: state.lightTheme,
        darkTheme: state.darkTheme,
        imageEffects: state.imageEffects,
        labelers: state.labelers,
      }),
      merge: (persisted, current) => {
        if (typeof persisted !== 'object' || persisted === null) return current
        const stored = persisted as Record<string, unknown>
        // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
        const appView = isAppViewTarget(stored['appView']) ? stored['appView'] : current.appView
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
        const labelers = Array.isArray(stored['labelers'])
          ? sanitizeLabelers(stored['labelers'])
          : current.labelers
        return {
          ...current,
          appView,
          theme: selectedTheme(appearance, lightTheme, darkTheme),
          appearance,
          lightTheme,
          darkTheme,
          imageEffects,
          labelers,
        }
      },
    },
  ),
)
