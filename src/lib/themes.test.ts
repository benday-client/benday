import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_EFFECT,
  isTheme,
  THEME_COLORS,
  THEME_EFFECTS,
  THEME_LABELS,
  THEMES,
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
] as const

describe('themes', () => {
  it('lists the themes in display order', () => {
    expect(THEMES).toEqual(EXPECTED_THEMES)
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
  })

  it('rejects anything else', () => {
    expect(isTheme('VOID')).toBe(false)
    expect(isTheme('oxide ')).toBe(false)
    expect(isTheme('amber')).toBe(false)
    expect(isTheme('catppuccin')).toBe(false)
    expect(isTheme('github')).toBe(false)
    expect(isTheme('Atom')).toBe(false)
    expect(isTheme('')).toBe(false)
    expect(isTheme(null)).toBe(false)
    expect(isTheme(undefined)).toBe(false)
    expect(isTheme(0)).toBe(false)
    expect(isTheme({ theme: 'oxide' })).toBe(false)
  })

  it('gives every theme a valid image effect and defaults to grunge', () => {
    expect(DEFAULT_IMAGE_EFFECT).toBe('grunge')
    for (const theme of THEMES) {
      expect(['grunge', 'clean']).toContain(THEME_EFFECTS[theme])
    }
    expect(THEME_EFFECTS.void).toBe('grunge')
    expect(THEME_EFFECTS['github-light']).toBe('clean')
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
    })
    expect(Object.keys(THEME_COLORS)).toHaveLength(THEMES.length)
  })

  it('keeps the meta colors distinct and well formed', () => {
    const colors = THEMES.map((theme) => THEME_COLORS[theme])
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(colors).size).toBe(THEMES.length)
  })
})
