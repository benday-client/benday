import { describe, expect, it } from 'vitest'
import { isTheme, nextTheme, THEME_COLORS, THEME_LABELS, THEMES } from './themes'
import type { Theme } from './types'

describe('themes', () => {
  it('lists the four themes in cycle order', () => {
    expect(THEMES).toEqual(['void', 'bone', 'oxide', 'phosphor'])
  })

  it('labels every theme in lowercase', () => {
    for (const theme of THEMES) {
      const label = THEME_LABELS[theme]
      expect(label).toBe(label.toLowerCase())
    }
    expect(THEME_LABELS.oxide).toBe('oxide')
    expect(THEME_LABELS.phosphor).toBe('phosphor')
  })

  it('cycles through every theme and wraps to void', () => {
    const cycle: Theme[] = []
    let current: Theme = 'void'
    for (let step = 0; step < THEMES.length; step += 1) {
      cycle.push(current)
      current = nextTheme(current)
    }
    expect(cycle).toEqual(['void', 'bone', 'oxide', 'phosphor'])
    expect(current).toBe('void')
  })

  it('accepts only the known theme names', () => {
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true)
    expect(isTheme('void')).toBe(true)
    expect(isTheme('bone')).toBe(true)
    expect(isTheme('oxide')).toBe(true)
    expect(isTheme('phosphor')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isTheme('VOID')).toBe(false)
    expect(isTheme('oxide ')).toBe(false)
    expect(isTheme('amber')).toBe(false)
    expect(isTheme('')).toBe(false)
    expect(isTheme(null)).toBe(false)
    expect(isTheme(undefined)).toBe(false)
    expect(isTheme(0)).toBe(false)
    expect(isTheme({ theme: 'oxide' })).toBe(false)
  })

  it('maps every theme to a browser meta color', () => {
    expect(THEME_COLORS).toEqual({
      void: '#07090c',
      bone: '#ddd6c6',
      oxide: '#0b0705',
      phosphor: '#040906',
    })
    expect(Object.keys(THEME_COLORS)).toHaveLength(THEMES.length)
  })
})
