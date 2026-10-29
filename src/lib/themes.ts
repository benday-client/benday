import type { Theme } from './types'

export const THEMES: readonly Theme[] = ['void', 'bone', 'oxide', 'phosphor']

export const THEME_LABELS: Record<Theme, string> = {
  void: 'void',
  bone: 'bone',
  oxide: 'oxide',
  phosphor: 'phosphor',
}

export const THEME_COLORS: Record<Theme, string> = {
  void: '#07090c',
  bone: '#ddd6c6',
  oxide: '#0b0705',
  phosphor: '#040906',
}

const THEME_LOOKUP: Record<string, true> = {
  void: true,
  bone: true,
  oxide: true,
  phosphor: true,
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEME_LOOKUP[value] === true
}

export function nextTheme(theme: Theme): Theme {
  const index = THEMES.indexOf(theme)
  return THEMES[(index + 1) % THEMES.length] ?? theme
}
