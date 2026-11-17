import type { Theme } from './types'

// Browser chrome follows the page surface. Keep index.html's first paint in step.
const THEME_COLORS: Record<Theme, string> = {
  dark: '#090909',
  light: '#f4f2ef',
}

/** The browser chrome colour for a theme. */
export function themeColor(theme: Theme): string {
  return THEME_COLORS[theme]
}
