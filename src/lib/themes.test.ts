import { describe, expect, it } from 'vitest'
import tokensCss from '../styles/tokens.css?raw'
import {
  availableThemeGroups,
  DEFAULT_IMAGE_EFFECT,
  isTheme,
  resolveTheme,
  SEASON_MONTHS,
  SEASONAL_THEMES,
  THEME_COLORS,
  THEME_EFFECTS,
  THEME_GROUPS,
  THEME_LABELS,
  THEME_SCHEMES,
  THEME_SEASONS,
  THEMES,
  themeAvailable,
  themeSeason,
} from './themes'
import type { Theme } from './types'

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

const RICH_THEMES = [
  'catppuccin-mocha',
  'catppuccin-latte',
  'dracula',
  'atom',
  'github-dark',
  'github-light',
  'cyberpunk',
  'cottagecore',
  'pumpkin-ember',
  'toxic-midnight',
  'candy-crypt',
  'dead-leaves',
] as const

// Fixed local dates, so the assertions do not depend on when the suite runs.
const OCTOBER_FIRST = new Date(2025, 9, 1, 0, 0, 0)
const OCTOBER_LAST = new Date(2025, 9, 31, 23, 59, 59)
const SEPTEMBER_LAST = new Date(2025, 8, 30, 23, 59, 59)
const NOVEMBER_FIRST = new Date(2025, 10, 1, 0, 0, 0)
const JULY = new Date(2026, 6, 4, 12, 0, 0)
const FEBRUARY = new Date(2026, 1, 14, 9, 30, 0)
const JANUARY = new Date(2026, 0, 15, 8, 0, 0)

function tokenBlock(theme: Theme): string {
  const start = tokensCss.indexOf(`[data-theme="${theme}"]`)
  if (start < 0) throw new Error(`no token block for ${theme}`)
  const open = tokensCss.indexOf('{', start)
  const close = tokensCss.indexOf('}', open)
  return tokensCss.slice(open + 1, close)
}

const ROOT_BLOCK = tokensCss.slice(0, tokensCss.indexOf('[data-theme='))

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

  it('uses readable labels for the expanded family', () => {
    expect(THEME_LABELS['catppuccin-mocha']).toBe('catppuccin mocha')
    expect(THEME_LABELS['catppuccin-latte']).toBe('catppuccin latte')
    expect(THEME_LABELS.atom).toBe('atom one dark')
    expect(THEME_LABELS['github-dark']).toBe('github dark')
    expect(THEME_LABELS['github-light']).toBe('github light')
    expect(THEME_LABELS.cyberpunk).toBe('cyberpunk 2077')
    expect(THEME_LABELS.cottagecore).toBe('cottagecore')
    expect(THEME_LABELS['truth-to-materials']).toBe('truth to materials')
    expect(THEME_LABELS.bluesky).toBe('bluesky')
    expect(THEME_LABELS['pumpkin-ember']).toBe('pumpkin ember')
    expect(THEME_LABELS['toxic-midnight']).toBe('toxic midnight')
    expect(THEME_LABELS['candy-crypt']).toBe('candy crypt')
    expect(THEME_LABELS['dead-leaves']).toBe('dead leaves')
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

  it('gives every theme a valid image effect and defaults to grunge', () => {
    expect(DEFAULT_IMAGE_EFFECT).toBe('grunge')
    for (const theme of THEMES) {
      expect(['grunge', 'clean', 'none', 'industrial']).toContain(THEME_EFFECTS[theme])
    }
    expect(THEME_EFFECTS.void).toBe('grunge')
    expect(THEME_EFFECTS['github-light']).toBe('clean')
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

  it('maps every theme to a browser meta color', () => {
    expect(THEME_COLORS).toEqual({
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
      'truth-to-materials': '#858585',
      bluesky: '#fbfdff',
      'pumpkin-ember': '#160b06',
      'toxic-midnight': '#05100b',
      'candy-crypt': '#1a0a1e',
      'dead-leaves': '#120f08',
    })
    expect(Object.keys(THEME_COLORS)).toHaveLength(THEMES.length)
  })

  it('keeps the meta colors distinct and well formed', () => {
    const colors = THEMES.map((theme) => THEME_COLORS[theme])
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(colors).size).toBe(THEMES.length)
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

describe('theme token depth', () => {
  it('gives the root a fallback depth pair', () => {
    expect(ROOT_BLOCK).toContain('--accent-4: var(--blue-hot);')
    expect(ROOT_BLOCK).toContain('--accent-5: var(--rust);')
  })

  it('gives every rich palette explicit accent-4 and accent-5 values', () => {
    for (const theme of RICH_THEMES) {
      const block = tokenBlock(theme)
      expect(block).toMatch(/--accent-4: #[0-9a-f]{6};/)
      expect(block).toMatch(/--accent-5: #[0-9a-f]{6};/)
    }
  })

  it('defines the shared texture and corner abilities', () => {
    expect(ROOT_BLOCK).toContain('--surface-texture: repeating-linear-gradient(')
    expect(ROOT_BLOCK).toContain('--theme-radius: 0px;')
    expect(ROOT_BLOCK).toContain('--theme-clip: none;')
  })

  it('removes surface texture for the honest themes', () => {
    for (const theme of ['truth-to-materials', 'bluesky'] as const) {
      const block = tokenBlock(theme)
      expect(block).toContain('--surface-texture: none;')
      expect(block).toContain('--scan-opacity: 0;')
      expect(block).toContain('--noise-opacity: 0;')
    }
  })

  it('gives every halloween theme its own texture', () => {
    const textures = new Set<string>()
    for (const theme of HALLOWEEN_THEMES) {
      const block = tokenBlock(theme)
      expect(block).toMatch(/--surface-texture:/)
      expect(block).not.toContain('--surface-texture: none;')
      textures.add(block.slice(block.indexOf('--surface-texture:')))
    }
    expect(textures.size).toBe(HALLOWEEN_THEMES.length)
  })

  it('rounds cottagecore and cuts cyberpunk corners', () => {
    expect(tokenBlock('cottagecore')).toContain('--theme-radius: 4px;')
    expect(tokenBlock('cyberpunk')).toContain('--theme-clip: polygon(')
    expect(tokenBlock('cyberpunk')).toContain('--theme-radius: 0px;')
  })
})
