import type { Theme } from './types'

export type ImageEffect = 'grunge' | 'clean' | 'none' | 'industrial' | 'halftone'
export type ThemeScheme = 'light' | 'dark'
export type ThemeSeason = 'october'

export const THEME_EFFECTS: Record<Theme, ImageEffect> = {
  void: 'grunge',
  bone: 'grunge',
  oxide: 'grunge',
  phosphor: 'grunge',
  'catppuccin-mocha': 'clean',
  'catppuccin-latte': 'clean',
  dracula: 'grunge',
  atom: 'clean',
  'github-dark': 'clean',
  'github-light': 'clean',
  cyberpunk: 'grunge',
  cottagecore: 'halftone',
  'truth-to-materials': 'industrial',
  bluesky: 'none',
  'pumpkin-ember': 'grunge',
  'toxic-midnight': 'grunge',
  'candy-crypt': 'grunge',
  'dead-leaves': 'grunge',
}

export const THEMES: readonly Theme[] = [
  'void',
  'bone',
  'oxide',
  'phosphor',
  'catppuccin-mocha',
  'catppuccin-latte',
  'dracula',
  'atom',
  'github-dark',
  'github-light',
  'cyberpunk',
  'cottagecore',
  'truth-to-materials',
  'bluesky',
  'pumpkin-ember',
  'toxic-midnight',
  'candy-crypt',
  'dead-leaves',
]

export const THEME_LABELS: Record<Theme, string> = {
  void: 'void',
  bone: 'bone',
  oxide: 'oxide',
  phosphor: 'phosphor',
  'catppuccin-mocha': 'catppuccin mocha',
  'catppuccin-latte': 'catppuccin latte',
  dracula: 'dracula',
  atom: 'atom one dark',
  'github-dark': 'github dark',
  'github-light': 'github light',
  cyberpunk: 'cyberpunk 2077',
  cottagecore: 'cottagecore',
  'truth-to-materials': 'truth to materials',
  bluesky: 'bluesky',
  'pumpkin-ember': 'pumpkin ember',
  'toxic-midnight': 'toxic midnight',
  'candy-crypt': 'candy crypt',
  'dead-leaves': 'dead leaves',
}

export const THEME_SCHEMES: Record<Theme, ThemeScheme> = {
  void: 'dark',
  bone: 'light',
  oxide: 'dark',
  phosphor: 'dark',
  'catppuccin-mocha': 'dark',
  'catppuccin-latte': 'light',
  dracula: 'dark',
  atom: 'dark',
  'github-dark': 'dark',
  'github-light': 'light',
  cyberpunk: 'dark',
  cottagecore: 'light',
  'truth-to-materials': 'light',
  bluesky: 'light',
  'pumpkin-ember': 'dark',
  'toxic-midnight': 'dark',
  'candy-crypt': 'dark',
  'dead-leaves': 'dark',
}

/**
 * Seasonal windows are calendar months in the viewer's local time: the caller
 * supplies the date, so a persisted theme never depends on when the module was
 * evaluated. `getMonth()` reads the local month of that date (0 = january).
 */
export const SEASON_MONTHS: Record<ThemeSeason, readonly number[]> = {
  october: [9],
}

export const THEME_SEASONS: Record<Theme, ThemeSeason | null> = {
  void: null,
  bone: null,
  oxide: null,
  phosphor: null,
  'catppuccin-mocha': null,
  'catppuccin-latte': null,
  dracula: null,
  atom: null,
  'github-dark': null,
  'github-light': null,
  cyberpunk: null,
  cottagecore: null,
  'truth-to-materials': null,
  bluesky: null,
  'pumpkin-ember': 'october',
  'toxic-midnight': 'october',
  'candy-crypt': 'october',
  'dead-leaves': 'october',
}

export const SEASONAL_THEMES: readonly Theme[] = THEMES.filter(
  (theme) => THEME_SEASONS[theme] !== null,
)

export const THEME_GROUPS: readonly {
  scheme: ThemeScheme
  themes: readonly Theme[]
}[] = [
  { scheme: 'dark', themes: THEMES.filter((theme) => THEME_SCHEMES[theme] === 'dark') },
  { scheme: 'light', themes: THEMES.filter((theme) => THEME_SCHEMES[theme] === 'light') },
]

// the chrome colour each theme's page paints. it is the same value as that
// theme's --void; keep index.html's pre-hydration table in step with it.
export const THEME_COLORS: Record<Theme, string> = {
  void: '#07090c',
  bone: '#ddd6c6',
  oxide: '#0b0705',
  phosphor: '#040906',
  'catppuccin-mocha': '#1e1e2e',
  'catppuccin-latte': '#eff1f5',
  dracula: '#282a36',
  atom: '#282c34',
  'github-dark': '#0d1117',
  'github-light': '#ffffff',
  cyberpunk: '#000000',
  cottagecore: '#f2ebd8',
  'truth-to-materials': '#858585',
  bluesky: '#f9fafb',
  'pumpkin-ember': '#160b06',
  'toxic-midnight': '#05100b',
  'candy-crypt': '#1a0a1e',
  'dead-leaves': '#120f08',
}

/**
 * The browser chrome colour for a theme. High contrast keeps one system pair so
 * the browser toolbar never sits on a low-contrast palette surface.
 */
export function themeColor(theme: Theme, highContrast = false): string {
  if (!highContrast) return THEME_COLORS[theme]
  return THEME_SCHEMES[theme] === 'light' ? '#ffffff' : '#000000'
}

const THEME_LOOKUP: Record<Theme, true> = {
  void: true,
  bone: true,
  oxide: true,
  phosphor: true,
  'catppuccin-mocha': true,
  'catppuccin-latte': true,
  dracula: true,
  atom: true,
  'github-dark': true,
  'github-light': true,
  cyberpunk: true,
  cottagecore: true,
  'truth-to-materials': true,
  bluesky: true,
  'pumpkin-ember': true,
  'toxic-midnight': true,
  'candy-crypt': true,
  'dead-leaves': true,
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && Object.hasOwn(THEME_LOOKUP, value)
}

export function themeSeason(theme: Theme): ThemeSeason | null {
  return THEME_SEASONS[theme]
}

export function themeAvailable(theme: Theme, date: Date): boolean {
  const season = THEME_SEASONS[theme]
  if (season === null) return true
  return SEASON_MONTHS[season].includes(date.getMonth())
}

/** The theme groups the picker may show for the given date, keeping scheme order. */
export function availableThemeGroups(date: Date): readonly {
  scheme: ThemeScheme
  themes: readonly Theme[]
}[] {
  return THEME_GROUPS.flatMap((group) => {
    const themes = group.themes.filter((theme) => themeAvailable(theme, date))
    return themes.length > 0 ? [{ scheme: group.scheme, themes }] : []
  })
}

/** Resolves a persisted selection to something usable on the given date. */
export function resolveTheme(theme: Theme, date: Date): Theme {
  return themeAvailable(theme, date) ? theme : 'void'
}
