import { describe, expect, it } from 'vitest'
import {
  insertSuggestion,
  mentionAt,
  type SuggestionToken,
  suggestionAt,
} from './useActorSuggestions'

function tokenAt(text: string, cursor: number): SuggestionToken {
  const token = suggestionAt(text, cursor)
  if (token === null) throw new Error(`no suggestion token at ${cursor} in ${JSON.stringify(text)}`)
  return token
}

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

  it('extends a mid-token mention over the remaining handle characters', () => {
    expect(mentionAt('@alice', 4)).toEqual({ start: 0, end: 6, query: 'ali' })
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

describe('suggestionAt punctuation boundaries', () => {
  it('keeps a trailing dot outside the replacement span', () => {
    expect(suggestionAt('hi @ad.', 7)).toEqual({
      start: 3,
      end: 6,
      query: 'ad',
      kind: 'mention',
    })
    expect(suggestionAt('look #tag.', 10)).toEqual({
      start: 5,
      end: 9,
      query: 'tag',
      kind: 'tag',
    })
  })

  it('keeps a trailing hyphen outside the replacement span', () => {
    expect(suggestionAt('hi @ad-', 7)).toEqual({
      start: 3,
      end: 6,
      query: 'ad',
      kind: 'mention',
    })
  })

  it('stops the query at punctuation that follows the token', () => {
    expect(suggestionAt('hi @ad, there', 6)).toEqual({
      start: 3,
      end: 6,
      query: 'ad',
      kind: 'mention',
    })
  })

  it('keeps dotted and interior-hyphen handles whole', () => {
    expect(suggestionAt('hi @alice.bsky.social', 21)).toEqual({
      start: 3,
      end: 21,
      query: 'alice.bsky.social',
      kind: 'mention',
    })
    expect(suggestionAt('hi @some-handle', 15)).toEqual({
      start: 3,
      end: 15,
      query: 'some-handle',
      kind: 'mention',
    })
  })
})

describe('insertSuggestion', () => {
  it('adds exactly one trailing space at the end of the text', () => {
    expect(insertSuggestion('hi @ad', tokenAt('hi @ad', 6), 'ada.test')).toEqual({
      text: 'hi @ada.test ',
      cursor: 13,
    })
  })

  it('reuses an existing separator instead of doubling it', () => {
    expect(insertSuggestion('hi @ad there', tokenAt('hi @ad there', 6), 'ada.test')).toEqual({
      text: 'hi @ada.test there',
      cursor: 13,
    })
  })

  it('moves the caret past a whole whitespace run, never into CRLF', () => {
    expect(
      insertSuggestion('hi @ad\r\n\r\n  there', tokenAt('hi @ad\r\n\r\n  there', 6), 'ada.test'),
    ).toEqual({
      text: 'hi @ada.test\r\n\r\n  there',
      cursor: 18,
    })
  })

  it('leaves punctuation in place and the caret before it', () => {
    expect(insertSuggestion('hi @ad, there', tokenAt('hi @ad, there', 6), 'ada.test')).toEqual({
      text: 'hi @ada.test, there',
      cursor: 12,
    })
    expect(insertSuggestion('hi @ad.', tokenAt('hi @ad.', 7), 'ad')).toEqual({
      text: 'hi @ad.',
      cursor: 6,
    })
  })

  it('inserts hashtags with their marker', () => {
    expect(insertSuggestion('look #ph', tokenAt('look #ph', 8), 'photography')).toEqual({
      text: 'look #photography ',
      cursor: 18,
    })
  })
})
