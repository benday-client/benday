import type { Theme } from './types'

// the chrome colour each theme's page paints. it is the same value as that
// theme's --void; keep index.html's pre-hydration table in step with it.
export const THEME_COLORS: Record<Theme, string> = {
  'catppuccin-mocha': '#1e1e2e',
  'catppuccin-latte': '#eff1f5',
}

/** The browser chrome colour for a theme. */
export function themeColor(theme: Theme): string {
  return THEME_COLORS[theme]
}

export function isTheme(value: unknown): value is Theme {
  return value === 'catppuccin-mocha' || value === 'catppuccin-latte'
}

// the light palettes the retired picker offered. every other known palette was
// dark, including the legacy `duotone` alias for cyberpunk.
const LEGACY_LIGHT_THEMES: Record<string, true> = {
  bone: true,
  'catppuccin-latte': true,
  cottagecore: true,
  'truth-to-materials': true,
  bluesky: true,
  'github-light': true,
}

const LEGACY_DARK_THEMES: Record<string, true> = {
  void: true,
  oxide: true,
  phosphor: true,
  'catppuccin-mocha': true,
  dracula: true,
  atom: true,
  'github-dark': true,
  cyberpunk: true,
  'pumpkin-ember': true,
  'toxic-midnight': true,
  'candy-crypt': true,
  'dead-leaves': true,
  duotone: true,
}

/**
 * Maps a stored palette name from the retired picker to the appearance mode it
 * implied. Unknown or non-string values have no opinion.
 */
export function legacyAppearanceForTheme(value: unknown): 'light' | 'dark' | null {
  if (typeof value !== 'string') return null
  if (Object.hasOwn(LEGACY_LIGHT_THEMES, value)) return 'light'
  if (Object.hasOwn(LEGACY_DARK_THEMES, value)) return 'dark'
  return null
}
