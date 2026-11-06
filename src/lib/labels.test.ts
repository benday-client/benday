import { describe, expect, it } from 'vitest'
import { displayContentLabel } from './labels'

describe('displayContentLabel', () => {
  it('names the known content labels', () => {
    expect(displayContentLabel('sexual')).toBe('nsfw')
    expect(displayContentLabel('porn')).toBe('explicit sexual content')
    expect(displayContentLabel('nudity')).toBe('nudity')
    expect(displayContentLabel('graphic-media')).toBe('graphic content')
  })

  it('keeps an unknown label verbatim', () => {
    expect(displayContentLabel('twitter-screenshot')).toBe('twitter-screenshot')
    expect(displayContentLabel('')).toBe('')
  })
})
