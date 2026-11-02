import { describe, expect, it } from 'vitest'
import {
  buildSuggestions,
  insertSuggestion,
  type SuggestionToken,
  suggestionAt,
} from './useActorSuggestions'

function tokenAt(text: string, cursor: number): SuggestionToken {
  const token = suggestionAt(text, cursor)
  if (token === null) throw new Error(`no suggestion token at ${cursor} in ${JSON.stringify(text)}`)
  return token
}

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

describe('buildSuggestions', () => {
  const token = (text: string, cursor = text.length) => tokenAt(text, cursor)

  it('prefers fetched actors and falls back to the literal handle', () => {
    const actors = [
      { did: 'did:plc:ada', handle: 'ada.test', displayName: 'ada', avatar: null },
      { did: 'did:plc:amir', handle: 'amir.test', displayName: 'amir', avatar: null },
    ]

    expect(buildSuggestions(token('@ad'), actors, []).map((item) => item.value)).toEqual([
      'ada.test',
      'amir.test',
    ])
    expect(buildSuggestions(token('@nobody'), [], [])).toEqual([
      { key: 'literal-handle', value: 'nobody', label: '@nobody', detail: 'handle' },
    ])
  })

  it('never fabricates an empty mention or tag', () => {
    expect(buildSuggestions(token('hi @'), [], [])).toEqual([])
    expect(buildSuggestions(token('hi #'), [], [])).toEqual([])
    expect(buildSuggestions(null, [], [])).toEqual([])
  })

  it('prefers fetched tags and falls back to the nonempty literal', () => {
    expect(buildSuggestions(token('#ten'), [], ['tensorpunk', 'tensorfield'])).toEqual([
      { key: 'tag:tensorpunk', value: 'tensorpunk', label: '#tensorpunk', detail: 'tag' },
      { key: 'tag:tensorfield', value: 'tensorfield', label: '#tensorfield', detail: 'tag' },
    ])
    expect(buildSuggestions(token('#ten'), [], [])).toEqual([
      { key: 'tag:ten', value: 'ten', label: '#ten', detail: 'tag' },
    ])
  })
})
