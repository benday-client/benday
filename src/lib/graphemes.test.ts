import { describe, expect, it } from 'vitest'
import { firstGrapheme, graphemes, truncateGraphemes } from './graphemes'

const FAMILY = '👩‍👩‍👧‍👦'
const ROCKET = '🚀'
const FLAG = '🇵🇱'

describe('firstGrapheme', () => {
  it('returns a whole emoji instead of a surrogate half', () => {
    expect(firstGrapheme(`${ROCKET} launch`)).toBe(ROCKET)
    expect(firstGrapheme(`${FAMILY} family`)).toBe(FAMILY)
    expect(firstGrapheme(`${FLAG} flag`)).toBe(FLAG)
  })

  it('keeps a combining mark attached to its base letter', () => {
    expect(firstGrapheme('e\u0301clair')).toBe('e\u0301')
    expect(firstGrapheme('\u0301leading mark')).toBe('\u0301')
  })

  it('is empty only for an empty string', () => {
    expect(firstGrapheme('')).toBe('')
    expect(firstGrapheme('a')).toBe('a')
  })

  it('agrees with the shared segmenter', () => {
    const segments = [...graphemes.segment(`${FAMILY}a${ROCKET}`)].map((segment) => segment.segment)
    expect(segments).toEqual([FAMILY, 'a', ROCKET])
  })
})

describe('truncateGraphemes', () => {
  it('returns nothing for a zero or negative limit', () => {
    expect(truncateGraphemes('abc', 0)).toBe('')
    expect(truncateGraphemes('abc', -3)).toBe('')
    expect(truncateGraphemes('', 0)).toBe('')
  })

  it('returns the original value untouched when it fits', () => {
    expect(truncateGraphemes('abc', 3)).toBe('abc')
    expect(truncateGraphemes('ab', 5)).toBe('ab')
    expect(truncateGraphemes('', 4)).toBe('')
  })

  it('takes at most the limit and never appends an ellipsis', () => {
    expect(truncateGraphemes('abcdef', 3)).toBe('abc')
    expect(truncateGraphemes('abcdef', 3).endsWith('…')).toBe(false)
    expect(truncateGraphemes('abcdef', 3).length).toBe(3)
  })

  it('never splits a family, flag or combining cluster', () => {
    expect(truncateGraphemes(`${FAMILY}${FAMILY}`, 1)).toBe(FAMILY)
    expect(truncateGraphemes(`${FLAG}${FLAG}${FLAG}`, 2)).toBe(`${FLAG}${FLAG}`)
    expect(truncateGraphemes(`e\u0301e\u0301`, 1)).toBe('e\u0301')
    expect(truncateGraphemes(`${ROCKET}${FAMILY}`, 1)).toBe(ROCKET)
  })

  it('counts astral characters as one cluster each', () => {
    expect(truncateGraphemes(`${ROCKET}${ROCKET}${ROCKET}`, 2)).toBe(`${ROCKET}${ROCKET}`)
    expect(truncateGraphemes(`${ROCKET}${ROCKET}`, 1)).toHaveLength(ROCKET.length)
  })

  it('keeps a leading combining mark as its own cluster rather than dropping it', () => {
    expect(truncateGraphemes('\u0301ab', 1)).toBe('\u0301')
    expect(truncateGraphemes('\u0301ab', 2)).toBe('\u0301a')
  })
})
