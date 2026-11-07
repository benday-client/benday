import { describe, expect, it } from 'vitest'
import { isTheme, legacyAppearanceForTheme, THEME_COLORS, themeColor } from './themes'

describe('themes', () => {
  it('ships exactly the catppuccin pair', () => {
    expect(isTheme('catppuccin-mocha')).toBe(true)
    expect(isTheme('catppuccin-latte')).toBe(true)
    expect(isTheme('void')).toBe(false)
    expect(isTheme('bone')).toBe(false)
    expect(isTheme(3)).toBe(false)
  })

  it('paints the chrome colour the page uses', () => {
    expect(themeColor('catppuccin-mocha')).toBe('#1e1e2e')
    expect(themeColor('catppuccin-latte')).toBe('#eff1f5')
    expect(THEME_COLORS['catppuccin-mocha']).toBe('#1e1e2e')
  })
})

describe('legacyAppearanceForTheme', () => {
  it.each([
    ['bone', 'light'],
    ['catppuccin-latte', 'light'],
    ['cottagecore', 'light'],
    ['truth-to-materials', 'light'],
    ['bluesky', 'light'],
    ['github-light', 'light'],
  ])('maps the light palette %s to light', (theme, appearance) => {
    expect(legacyAppearanceForTheme(theme)).toBe(appearance)
  })

  it.each([
    'void',
    'oxide',
    'phosphor',
    'catppuccin-mocha',
    'dracula',
    'atom',
    'github-dark',
    'cyberpunk',
    'pumpkin-ember',
    'toxic-midnight',
    'candy-crypt',
    'dead-leaves',
    'duotone',
  ])('maps the dark palette %s to dark', (theme) => {
    expect(legacyAppearanceForTheme(theme)).toBe('dark')
  })

  it('has no opinion about unknown or non-string values', () => {
    expect(legacyAppearanceForTheme('neon')).toBeNull()
    expect(legacyAppearanceForTheme(null)).toBeNull()
    expect(legacyAppearanceForTheme(3)).toBeNull()
    expect(legacyAppearanceForTheme({})).toBeNull()
  })
})
