import type { Theme } from './types'

export type ImageEffect = 'grunge' | 'clean' | 'none' | 'industrial' | 'halftone'
export type ThemeScheme = 'light' | 'dark'

// both shipped palettes keep the grunge dither; the effect families leave in the
// following cut, so the records stay until then.
export const THEME_EFFECTS: Record<Theme, ImageEffect> = {
  'catppuccin-mocha': 'grunge',
  'catppuccin-latte': 'grunge',
}

export const THEME_SCHEMES: Record<Theme, ThemeScheme> = {
  'catppuccin-mocha': 'dark',
  'catppuccin-latte': 'light',
}

// the chrome colour each theme's page paints. it is the same value as that
// theme's --void; keep index.html's pre-hydration table in step with it.
export const THEME_COLORS: Record<Theme, string> = {
  'catppuccin-mocha': '#1e1e2e',
  'catppuccin-latte': '#eff1f5',
}

/**
 * The browser chrome colour for a theme. High contrast keeps one system pair so
 * the browser toolbar never sits on a low-contrast palette surface.
 */
export function themeColor(theme: Theme, highContrast = false): string {
  if (!highContrast) return THEME_COLORS[theme]
  return THEME_SCHEMES[theme] === 'light' ? '#ffffff' : '#000000'
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
