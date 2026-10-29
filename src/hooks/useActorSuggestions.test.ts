import { describe, expect, it } from 'vitest'
import { mentionAt, suggestionAt } from './useActorSuggestions'

describe('mentionAt', () => {
  it('finds a mention at the cursor', () => {
    expect(mentionAt('hello @ada', 10)).toEqual({ start: 6, end: 10, query: 'ada' })
    expect(mentionAt('@ada', 4)).toEqual({ start: 0, end: 4, query: 'ada' })
  })

  it('ignores emails and completed mentions', () => {
    expect(mentionAt('mail a@b', 8)).toBeNull()
    expect(mentionAt('hello @ada ', 11)).toBeNull()
  })

  it('returns the prefix at the cursor only', () => {
    expect(mentionAt('@ada and @bea', 4)).toEqual({ start: 0, end: 4, query: 'ada' })
    expect(mentionAt('@ada and @bea', 13)).toEqual({ start: 9, end: 13, query: 'bea' })
  })

  it('finds hashtags as well as mentions', () => {
    expect(suggestionAt('look #pho', 9)).toEqual({
      start: 5,
      end: 9,
      query: 'pho',
      kind: 'tag',
    })
    expect(suggestionAt('look @ada', 9)).toEqual({
      start: 5,
      end: 9,
      query: 'ada',
      kind: 'mention',
    })
  })
})
