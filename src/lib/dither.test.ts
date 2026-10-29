import { describe, expect, it } from 'vitest'
import {
  BAYER_MATRIX,
  bayerThreshold,
  buildBayerPatternDataUri,
  buildBayerPatternSvg,
} from './dither'

describe('BAYER_MATRIX', () => {
  it('is the classic 4x4 ordered-dither matrix', () => {
    expect(BAYER_MATRIX).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ])
  })
})

describe('bayerThreshold', () => {
  it('returns the midpoint threshold at the corners', () => {
    expect(bayerThreshold(0, 0)).toBe(0.03125)
    expect(bayerThreshold(1, 0)).toBe(0.53125)
    expect(bayerThreshold(0, 1)).toBe(0.78125)
    expect(bayerThreshold(3, 3)).toBe(0.34375)
  })

  it('produces sixteen distinct levels inside the open unit interval', () => {
    const levels = BAYER_MATRIX.flatMap((row, y) => row.map((_, x) => bayerThreshold(x, y)))
    const expected = BAYER_MATRIX.flat().map((value) => (value + 0.5) / 16)

    expect(levels).toEqual(expected)
    expect(new Set(expected).size).toBe(16)
    for (const level of expected) {
      expect(level).toBeGreaterThan(0)
      expect(level).toBeLessThan(1)
    }
  })

  it('wraps coordinates in both directions', () => {
    expect(bayerThreshold(4, 0)).toBe(bayerThreshold(0, 0))
    expect(bayerThreshold(-4, -4)).toBe(bayerThreshold(0, 0))
    expect(bayerThreshold(-1, 0)).toBe(bayerThreshold(3, 0))
    expect(bayerThreshold(0, -1)).toBe(bayerThreshold(0, 3))
    expect(bayerThreshold(5, 7)).toBe(bayerThreshold(1, 3))
  })
})

describe('buildBayerPatternSvg', () => {
  it('renders a 16x16 tile with sixteen 4x4 cells', () => {
    const svg = buildBayerPatternSvg()

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('width="16"')
    expect(svg).toContain('height="16"')
    expect(svg).toContain('viewBox="0 0 16 16"')
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg.match(/<rect /g) ?? []).toHaveLength(16)
    expect(svg.match(/width="4" height="4"/g) ?? []).toHaveLength(16)
  })

  it('uses the black ground and inverted threshold fills', () => {
    const svg = buildBayerPatternSvg()

    expect(svg).toContain('fill="#000"')
    expect(svg).toContain('fill="rgb(96.875%, 96.875%, 96.875%)"')
    expect(svg).toContain('fill="rgb(3.125%, 3.125%, 3.125%)"')
  })

  it('is deterministic', () => {
    expect(buildBayerPatternSvg()).toBe(buildBayerPatternSvg())
  })
})

describe('buildBayerPatternDataUri', () => {
  it('encodes the same svg as base64', () => {
    const svg = buildBayerPatternSvg()
    const uri = buildBayerPatternDataUri()
    const prefix = 'data:image/svg+xml;base64,'

    expect(uri.startsWith(prefix)).toBe(true)
    expect(atob(uri.slice(prefix.length))).toBe(svg)
  })
})
