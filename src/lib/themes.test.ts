import { describe, expect, it } from 'vitest'
import {
  availableThemeGroups,
  isTheme,
  resolveTheme,
  SEASON_MONTHS,
  SEASONAL_THEMES,
  THEME_EFFECTS,
  THEME_GROUPS,
  THEME_LABELS,
  THEME_SCHEMES,
  THEME_SEASONS,
  THEMES,
  themeAvailable,
  themeSeason,
} from './themes'

const EXPECTED_THEMES = [
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
] as const

const HALLOWEEN_THEMES = ['pumpkin-ember', 'toxic-midnight', 'candy-crypt', 'dead-leaves'] as const

// Fixed local dates, so the assertions do not depend on when the suite runs.
const OCTOBER_FIRST = new Date(2025, 9, 1, 0, 0, 0)
const OCTOBER_LAST = new Date(2025, 9, 31, 23, 59, 59)
const SEPTEMBER_LAST = new Date(2025, 8, 30, 23, 59, 59)
const NOVEMBER_FIRST = new Date(2025, 10, 1, 0, 0, 0)
const JULY = new Date(2026, 6, 4, 12, 0, 0)
const FEBRUARY = new Date(2026, 1, 14, 9, 30, 0)
const JANUARY = new Date(2026, 0, 15, 8, 0, 0)

describe('themes', () => {
  it('lists the themes in display order', () => {
    expect(THEMES).toEqual(EXPECTED_THEMES)
  })

  it('splits every theme into dark and light groups', () => {
    expect(THEME_GROUPS.map((group) => group.scheme)).toEqual(['dark', 'light'])
    const grouped = THEME_GROUPS.flatMap((group) => group.themes)
    expect(grouped).toHaveLength(THEMES.length)
    expect(new Set(grouped)).toEqual(new Set(THEMES))
    expect(THEME_SCHEMES.void).toBe('dark')
    expect(THEME_SCHEMES['github-dark']).toBe('dark')
    expect(THEME_SCHEMES.bone).toBe('light')
    expect(THEME_SCHEMES['github-light']).toBe('light')
  })

  it('keeps the seasonal themes dark and grouped with the other dark themes', () => {
    for (const theme of HALLOWEEN_THEMES) {
      expect(THEME_SCHEMES[theme]).toBe('dark')
      expect(THEME_GROUPS[0]?.themes).toContain(theme)
    }
  })

  it('places the honest light themes in the light group', () => {
    expect(THEME_SCHEMES['truth-to-materials']).toBe('light')
    expect(THEME_SCHEMES.bluesky).toBe('light')
    expect(THEME_GROUPS[1]?.themes).toEqual(
      expect.arrayContaining(['truth-to-materials', 'bluesky']),
    )
  })

  it('labels every theme in lowercase', () => {
    for (const theme of THEMES) {
      const label = THEME_LABELS[theme]
      expect(label).toBe(label.toLowerCase())
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('labels every theme uniquely', () => {
    const labels = THEMES.map((theme) => THEME_LABELS[theme])
    expect(new Set(labels).size).toBe(THEMES.length)
  })

  it('accepts only the known theme names', () => {
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true)
    expect(isTheme('void')).toBe(true)
    expect(isTheme('catppuccin-mocha')).toBe(true)
    expect(isTheme('github-light')).toBe(true)
    expect(isTheme('truth-to-materials')).toBe(true)
    expect(isTheme('bluesky')).toBe(true)
    expect(isTheme('pumpkin-ember')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isTheme('VOID')).toBe(false)
    expect(isTheme('oxide ')).toBe(false)
    expect(isTheme('amber')).toBe(false)
    expect(isTheme('catppuccin')).toBe(false)
    expect(isTheme('github')).toBe(false)
    expect(isTheme('Atom')).toBe(false)
    expect(isTheme('pumpkin')).toBe(false)
    expect(isTheme('halloween')).toBe(false)
    expect(isTheme('')).toBe(false)
    expect(isTheme(null)).toBe(false)
    expect(isTheme(undefined)).toBe(false)
    expect(isTheme(0)).toBe(false)
    expect(isTheme({ theme: 'oxide' })).toBe(false)
  })

  it('gives every theme a valid image effect', () => {
    for (const theme of THEMES) {
      expect(['grunge', 'clean', 'none', 'industrial', 'halftone']).toContain(THEME_EFFECTS[theme])
    }
    expect(THEME_EFFECTS.void).toBe('grunge')
    expect(THEME_EFFECTS['github-light']).toBe('clean')
    // cottagecore prints instead of grunging: its screen is the halftone tile
    expect(THEME_EFFECTS.cottagecore).toBe('halftone')
  })

  it('keeps bluesky undithered and gives truth an industrial dither', () => {
    expect(THEME_EFFECTS.bluesky).toBe('none')
    expect(THEME_EFFECTS['truth-to-materials']).toBe('industrial')
  })

  it('keeps every halloween theme dithered', () => {
    for (const theme of HALLOWEEN_THEMES) {
      expect(THEME_EFFECTS[theme]).toBe('grunge')
    }
  })
})

describe('theme seasons', () => {
  it('marks only the halloween themes as seasonal', () => {
    expect(SEASONAL_THEMES).toEqual(HALLOWEEN_THEMES)
    for (const theme of HALLOWEEN_THEMES) {
      expect(themeSeason(theme)).toBe('october')
      expect(THEME_SEASONS[theme]).toBe('october')
    }
    for (const theme of THEMES) {
      if (themeSeason(theme) !== null) continue
      expect(THEME_SEASONS[theme]).toBeNull()
    }
  })

  it('opens the seasonal window for all of october', () => {
    expect(SEASON_MONTHS.october).toEqual([9])
    for (const theme of HALLOWEEN_THEMES) {
      expect(themeAvailable(theme, OCTOBER_FIRST)).toBe(true)
      expect(themeAvailable(theme, OCTOBER_LAST)).toBe(true)
    }
  })

  it('closes the seasonal window outside october', () => {
    for (const theme of HALLOWEEN_THEMES) {
      expect(themeAvailable(theme, SEPTEMBER_LAST)).toBe(false)
      expect(themeAvailable(theme, NOVEMBER_FIRST)).toBe(false)
      expect(themeAvailable(theme, JULY)).toBe(false)
      expect(themeAvailable(theme, FEBRUARY)).toBe(false)
    }
  })

  it('keeps the year-round themes available on every date', () => {
    const yearRound = THEMES.filter((theme) => !SEASONAL_THEMES.includes(theme))
    for (const theme of yearRound) {
      expect(themeAvailable(theme, OCTOBER_FIRST)).toBe(true)
      expect(themeAvailable(theme, SEPTEMBER_LAST)).toBe(true)
      expect(themeAvailable(theme, NOVEMBER_FIRST)).toBe(true)
      expect(themeAvailable(theme, JANUARY)).toBe(true)
    }
  })

  it('shows the seasonal themes in the october picker', () => {
    expect(availableThemeGroups(OCTOBER_LAST)).toEqual(THEME_GROUPS)
  })

  it('hides the seasonal themes outside october but keeps both groups', () => {
    const groups = availableThemeGroups(NOVEMBER_FIRST)
    expect(groups.map((group) => group.scheme)).toEqual(['dark', 'light'])
    const shown = groups.flatMap((group) => group.themes)
    for (const theme of HALLOWEEN_THEMES) expect(shown).not.toContain(theme)
    expect(shown).toContain('bluesky')
    expect(shown).toContain('cottagecore')
    expect(shown).toHaveLength(THEMES.length - HALLOWEEN_THEMES.length)
  })

  it('falls back to void when a seasonal theme is selected out of season', () => {
    expect(resolveTheme('pumpkin-ember', OCTOBER_FIRST)).toBe('pumpkin-ember')
    expect(resolveTheme('dead-leaves', OCTOBER_LAST)).toBe('dead-leaves')
    expect(resolveTheme('pumpkin-ember', NOVEMBER_FIRST)).toBe('void')
    expect(resolveTheme('toxic-midnight', SEPTEMBER_LAST)).toBe('void')
    expect(resolveTheme('candy-crypt', FEBRUARY)).toBe('void')
    expect(resolveTheme('bluesky', NOVEMBER_FIRST)).toBe('bluesky')
    expect(resolveTheme('void', NOVEMBER_FIRST)).toBe('void')
  })
})
