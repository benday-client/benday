import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_APPVIEW, isAppViewTarget, toAppViewTarget } from './appviews'
import { isTheme } from './themes'
import type { AppViewTarget, Theme } from './types'

export const SETTINGS_STORAGE_KEY = 'benday:settings'

interface SettingsState {
  appView: AppViewTarget
  theme: Theme
  setAppView: (appView: AppViewTarget) => void
  setTheme: (theme: Theme) => void
}

const INITIAL_APPVIEW = toAppViewTarget(DEFAULT_APPVIEW)

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appView: INITIAL_APPVIEW,
      theme: 'void',
      setAppView: (appView) => set({ appView }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        appView: state.appView,
        theme: state.theme,
      }),
      merge: (persisted, current) => {
        if (typeof persisted !== 'object' || persisted === null) return current
        const stored = persisted as Record<string, unknown>
        // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
        const appView = isAppViewTarget(stored['appView']) ? stored['appView'] : current.appView
        const theme = isTheme(stored['theme']) ? stored['theme'] : current.theme
        return { ...current, appView, theme }
      },
    },
  ),
)
