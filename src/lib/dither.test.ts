import { describe, expect, it } from 'vitest'
import { BAYER_MATRIX, buildBayerPatternDataUri, buildBayerPatternSvg } from './dither'

describe('BAYER_MATRIX', () => {
  it('is the classic 8x8 ordered-dither matrix', () => {
    expect(BAYER_MATRIX).toEqual([
      [0, 32, 8, 40, 2, 34, 10, 42],
      [48, 16, 56, 24, 50, 18, 58, 26],
      [12, 44, 4, 36, 14, 46, 6, 38],
      [60, 28, 52, 20, 62, 30, 54, 22],
      [3, 35, 11, 43, 1, 33, 9, 41],
      [51, 19, 59, 27, 49, 17, 57, 25],
      [15, 47, 7, 39, 13, 45, 5, 37],
      [63, 31, 55, 23, 61, 29, 53, 21],
    ])
  })
})

describe('buildBayerPatternSvg', () => {
  it('renders a 16x16 tile with sixty-four 2x2 cells', () => {
    const svg = buildBayerPatternSvg()

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('width="16"')
    expect(svg).toContain('height="16"')
    expect(svg).toContain('viewBox="0 0 16 16"')
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg.match(/<rect /g) ?? []).toHaveLength(64)
    expect(svg.match(/width="2" height="2"/g) ?? []).toHaveLength(64)
  })

  it('uses the black ground and inverted threshold fills', () => {
    const svg = buildBayerPatternSvg()

    expect(svg).toContain('fill="#000"')
    expect(svg).toContain('fill="rgb(99.219%, 99.219%, 99.219%)"')
    expect(svg).toContain('fill="rgb(0.781%, 0.781%, 0.781%)"')
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
