import type { Theme } from './types'

export type ImageEffect = 'grunge' | 'clean'

export const DEFAULT_IMAGE_EFFECT: ImageEffect = 'grunge'

export const THEME_EFFECTS: Record<Theme, ImageEffect> = {
  void: 'grunge',
  bone: 'grunge',
  oxide: 'grunge',
  phosphor: 'clean',
  'catppuccin-mocha': 'grunge',
  'catppuccin-latte': 'clean',
  dracula: 'grunge',
  atom: 'clean',
  'github-dark': 'clean',
  'github-light': 'clean',
  cyberpunk: 'grunge',
  cottagecore: 'grunge',
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
}

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
  cyberpunk: '#05030d',
  cottagecore: '#f3ead8',
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
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && Object.hasOwn(THEME_LOOKUP, value)
}
