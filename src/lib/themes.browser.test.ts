import { describe, expect, it } from 'vitest'
import { resolveSrgbColor } from '../test/colors'
import { THEMES, themeColor } from './themes'
import type { Theme } from './types'

/** A theme token as the page actually paints it. */
function paintedToken(name: string) {
  const probe = document.createElement('span')
  probe.setAttribute('style', `position:absolute;left:-9999px;color:var(${name})`)
  document.body.append(probe)
  try {
    return resolveSrgbColor(getComputedStyle(probe).color)
  } finally {
    probe.remove()
  }
}

describe('theme chrome colour', () => {
  it.each(THEMES)('matches the painted page for %s', (theme: Theme) => {
    document.documentElement.dataset['theme'] = theme
    const chrome = themeColor(theme, false)

    expect(CSS.supports('color', chrome)).toBe(true)
    expect(resolveSrgbColor(chrome)).toEqual(paintedToken('--void'))
  })

  it('keeps high-contrast chrome at the painted black or white page', () => {
    document.documentElement.dataset['contrast'] = 'high'
    try {
      for (const theme of THEMES) {
        document.documentElement.dataset['theme'] = theme
        expect(resolveSrgbColor(themeColor(theme, true))).toEqual(paintedToken('--void'))
      }
    } finally {
      delete document.documentElement.dataset['contrast']
    }
  })
})

/** The eleven benday originals, whose palettes are expressed in oklch. */
const ORIGINALS: readonly Theme[] = [
  'void',
  'bone',
  'oxide',
  'phosphor',
  'cyberpunk',
  'cottagecore',
  'truth-to-materials',
  'pumpkin-ember',
  'toxic-midnight',
  'candy-crypt',
  'dead-leaves',
]

interface Oklch {
  l: number
  c: number
  hue: number | null
}

function tokenValue(theme: Theme | null, name: string): string {
  if (theme === null) delete document.documentElement.dataset['theme']
  else document.documentElement.dataset['theme'] = theme
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function parseOklch(value: string): Oklch | null {
  const match = /^oklch\(([\d.]+) ([\d.]+) (none|[\d.]+)\)$/.exec(value)
  if (match === null) return null
  return {
    l: Number(match[1]),
    c: Number(match[2]),
    hue: match[3] === 'none' ? null : Number(match[3]),
  }
}

function paintedTokenValue(theme: Theme, name: string) {
  document.documentElement.dataset['theme'] = theme
  return paintedToken(name)
}

describe('benday original palettes', () => {
  it("keeps each family's measured surface order", () => {
    const orders: Record<string, readonly string[]> = {
      cottagecore: ['--panel', '--paper', '--void', '--panel-raised'],
      cyberpunk: ['--void', '--paper', '--panel', '--panel-raised'],
      default: ['--void', '--paper', '--panel', '--panel-raised'],
    }
    for (const theme of ORIGINALS) {
      const order = orders[theme] ?? orders['default'] ?? []
      const steps = order.map((name) => {
        const { l } = parseOklch(tokenValue(theme, name)) ?? { l: Number.NaN }
        return l
      })
      for (let index = 1; index < steps.length; index += 1) {
        const before = steps[index - 1] ?? Number.NaN
        const after = steps[index] ?? Number.NaN
        // cyberpunk's page and paper are the same black by design
        if (theme === 'cyberpunk' && index === 1) expect(after).toBe(before)
        else expect(after).toBeGreaterThan(before)
      }
    }
  })

  it('keeps the ink ramp readable in its own direction', () => {
    const light: readonly Theme[] = ['bone', 'cottagecore', 'truth-to-materials']
    for (const theme of ORIGINALS) {
      const ink = parseOklch(tokenValue(theme, '--ink'))?.l ?? Number.NaN
      const dim = parseOklch(tokenValue(theme, '--ink-dim'))?.l ?? Number.NaN
      const faint = parseOklch(tokenValue(theme, '--ink-faint'))?.l ?? Number.NaN
      if (light.includes(theme)) {
        expect(dim).toBeGreaterThan(ink)
        expect(faint).toBeGreaterThan(dim)
      } else {
        expect(dim).toBeLessThan(ink)
        expect(faint).toBeLessThan(dim)
      }
    }
  })

  it('keeps exact neutrals neutral and low-chroma tints tinted', () => {
    for (const theme of [null, ...ORIGINALS] as const) {
      const scope: Theme | null = theme
      const names = ['--void', '--paper', '--panel', '--panel-raised', '--ink', '--shadow']
      for (const name of names) {
        const parsed = parseOklch(tokenValue(scope, name))
        if (parsed === null) continue
        if (parsed.c === 0) expect(parsed.hue).toBeNull()
        else expect(parsed.hue).not.toBeNull()
      }
    }

    // the void palette is a warm ink on a cold page: neither may collapse to grey
    const warmInk = paintedTokenValue('void', '--ink')
    expect(warmInk.r).not.toBe(warmInk.b)
    // truth to materials is the achromatic family, so its page really is grey
    const page = paintedTokenValue('truth-to-materials', '--paper')
    expect(page.r).toBe(page.g)
    expect(page.g).toBe(page.b)
  })

  it('keeps the intentional accent hues per family', () => {
    const buckets: Record<string, number> = {}
    for (const theme of ORIGINALS) {
      const hues = ['--blue', '--blue-hot', '--rust', '--acid']
        .map((name) => parseOklch(tokenValue(theme, name))?.hue)
        .filter((hue): hue is number => hue !== undefined && hue !== null)
        .map((hue) => Math.round(hue / 20))
      buckets[theme] = [...new Set(hues)].length
    }
    // every family carries at least two accent hues except truth to materials,
    // whose single material hue is its identity
    for (const theme of ORIGINALS) {
      if (theme === 'truth-to-materials') continue
      expect(buckets[theme], theme).toBeGreaterThan(1)
    }
    expect(buckets['truth-to-materials']).toBe(1)
  })
})
