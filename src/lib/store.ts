import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_APPVIEW, isAppViewTarget, toAppViewTarget } from './appviews'
import { isTheme } from './themes'
import type { AppViewTarget, Theme } from './types'

export const SETTINGS_STORAGE_KEY = 'benday:settings'

interface SettingsState {
  appView: AppViewTarget
  theme: Theme
  labelers: string[]
  setAppView: (appView: AppViewTarget) => void
  setTheme: (theme: Theme) => void
  addLabeler: (did: string) => void
  removeLabeler: (did: string) => void
}

function cleanLabeler(did: string): string | null {
  const trimmed = did.trim()
  return trimmed.startsWith('did:') && trimmed.length > 4 ? trimmed : null
}

const INITIAL_APPVIEW = toAppViewTarget(DEFAULT_APPVIEW)

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appView: INITIAL_APPVIEW,
      theme: 'void',
      labelers: [],
      setAppView: (appView) => set({ appView }),
      setTheme: (theme) => set({ theme }),
      addLabeler: (did) => {
        const labeler = cleanLabeler(did)
        if (labeler === null) return
        set((state) => ({
          labelers: state.labelers.includes(labeler)
            ? state.labelers
            : [...state.labelers, labeler].slice(0, 20),
        }))
      },
      removeLabeler: (did) => {
        set((state) => ({ labelers: state.labelers.filter((labeler) => labeler !== did) }))
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        appView: state.appView,
        theme: state.theme,
        labelers: state.labelers,
      }),
      merge: (persisted, current) => {
        if (typeof persisted !== 'object' || persisted === null) return current
        const stored = persisted as Record<string, unknown>
        // bracket access is deliberate: noPropertyAccessFromIndexSignature is enabled
        const appView = isAppViewTarget(stored['appView']) ? stored['appView'] : current.appView
        const storedTheme = stored['theme'] === 'duotone' ? 'cyberpunk' : stored['theme']
        const theme = isTheme(storedTheme) ? storedTheme : current.theme
        const labelers = Array.isArray(stored['labelers'])
          ? [
              ...new Set(
                stored['labelers'].filter(
                  (value): value is string =>
                    typeof value === 'string' && cleanLabeler(value) !== null,
                ),
              ),
            ].slice(0, 20)
          : current.labelers
        return { ...current, appView, theme, labelers }
      },
    },
  ),
)
