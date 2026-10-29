import { describe, expect, it } from 'vitest'
import { facetHref, segmentText } from './facets'
import type { FacetFeature, FacetSpan } from './types'

const mention: FacetFeature = { kind: 'mention', did: 'did:plc:ada', handle: 'ada.world' }
const tag: FacetFeature = { kind: 'tag', tag: 'tensorpunk' }

function spanAt(text: string, needle: string, feature: FacetFeature): FacetSpan {
  const index = text.indexOf(needle)
  if (index < 0) throw new Error(`missing substring: ${needle}`)
  const encoder = new TextEncoder()
  const start = encoder.encode(text.slice(0, index)).length
  return { start, end: start + encoder.encode(needle).length, feature }
}

describe('segmentText', () => {
  it('returns an empty list for empty text', () => {
    expect(segmentText('', [])).toEqual([])
    expect(segmentText('', [{ start: 0, end: 0, feature: mention }])).toEqual([])
  })

  it('returns one unfaceted segment when there are no facets', () => {
    expect(segmentText('plain text', [])).toEqual([{ text: 'plain text', features: [] }])
  })

  it('splits ascii text around a mention', () => {
    const text = 'hello @ada.world'
    expect(segmentText(text, [spanAt(text, '@ada.world', mention)])).toEqual([
      { text: 'hello ', features: [] },
      { text: '@ada.world', features: [mention] },
    ])
  })

  it('maps utf-8 byte offsets across polish diacritics and an emoji', () => {
    const text = 'zażółć @ada.world 🚀'
    const segments = segmentText(text, [spanAt(text, '@ada.world', mention)])
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
    expect(segments).toEqual([
      { text: 'zażółć ', features: [] },
      { text: '@ada.world', features: [mention] },
      { text: ' 🚀', features: [] },
    ])
  })

  it('covers a multi-byte emoji without splitting its surrogate pair', () => {
    const text = 'a🚀b'
    expect(segmentText(text, [spanAt(text, '🚀', tag)])).toEqual([
      { text: 'a', features: [] },
      { text: '🚀', features: [tag] },
      { text: 'b', features: [] },
    ])
  })

  it('orders unsorted facets and fills gaps', () => {
    const text = 'one two three'
    const segments = segmentText(text, [spanAt(text, 'three', tag), spanAt(text, 'one', mention)])
    expect(segments).toEqual([
      { text: 'one', features: [mention] },
      { text: ' two ', features: [] },
      { text: 'three', features: [tag] },
    ])
  })

  it('keeps every feature when facets share a range', () => {
    const text = 'abcdef'
    const bold: FacetFeature = { kind: 'bold' }
    const link: FacetFeature = { kind: 'link', uri: 'https://example.com' }
    expect(
      segmentText(text, [
        { start: 1, end: 4, feature: bold },
        { start: 1, end: 4, feature: link },
      ]),
    ).toEqual([
      { text: 'a', features: [] },
      { text: 'bcd', features: [bold, link] },
      { text: 'ef', features: [] },
    ])
  })

  it('splits overlapping facets at every boundary and keeps both active', () => {
    const text = 'abcdef'
    const first: FacetFeature = { kind: 'tag', tag: 'first' }
    const second: FacetFeature = { kind: 'tag', tag: 'second' }
    expect(
      segmentText(text, [
        { start: 1, end: 4, feature: first },
        { start: 3, end: 6, feature: second },
      ]),
    ).toEqual([
      { text: 'a', features: [] },
      { text: 'bc', features: [first] },
      { text: 'd', features: [first, second] },
      { text: 'ef', features: [second] },
    ])
  })

  it('composes a bold link in the same range', () => {
    const text = 'click here'
    const bold: FacetFeature = { kind: 'bold' }
    const link: FacetFeature = { kind: 'link', uri: 'https://example.com' }
    expect(segmentText(text, [spanAt(text, 'here', bold), spanAt(text, 'here', link)])).toEqual([
      { text: 'click ', features: [] },
      { text: 'here', features: [bold, link] },
    ])
  })

  it('ignores invalid, zero width, and out of range spans', () => {
    const text = 'hello world'
    const segments = segmentText(text, [
      { start: -2, end: 3, feature: tag },
      { start: 5, end: 5, feature: tag },
      { start: 0, end: 999, feature: tag },
      { start: 1.5, end: 3, feature: tag },
      { start: 0, end: 5, feature: mention },
    ])
    expect(segments).toEqual([
      { text: 'hello', features: [mention] },
      { text: ' world', features: [] },
    ])
  })

  it('drops spans whose byte offsets fall inside a multi-byte code point', () => {
    expect(segmentText('🚀', [{ start: 0, end: 2, feature: tag }])).toEqual([
      { text: '🚀', features: [] },
    ])
  })
})

describe('facetHref', () => {
  it('links mentions internally', () => {
    expect(facetHref({ kind: 'mention', did: 'did:plc:ada', handle: 'ada.world' })).toEqual({
      href: '/profile/ada.world',
      external: false,
    })
    expect(facetHref({ kind: 'mention', did: 'did:plc:ada', handle: 'ada world' })).toEqual({
      href: '/profile/ada%20world',
      external: false,
    })
  })

  it('links tags to search with an encoded hash', () => {
    expect(facetHref({ kind: 'tag', tag: 'tensorpunk' })).toEqual({
      href: '/search?q=%23tensorpunk',
      external: false,
    })
    expect(facetHref({ kind: 'tag', tag: 'a b' })).toEqual({
      href: '/search?q=%23a%20b',
      external: false,
    })
  })

  it('marks http and https links external', () => {
    expect(facetHref({ kind: 'link', uri: 'https://example.com/a?b=c#d' })).toEqual({
      href: 'https://example.com/a?b=c#d',
      external: true,
    })
    expect(facetHref({ kind: 'link', uri: 'http://example.com' })).toEqual({
      href: 'http://example.com',
      external: true,
    })
  })

  it('rejects unsafe, relative, and malformed links', () => {
    expect(facetHref({ kind: 'link', uri: 'javascript:alert(1)' })).toBeNull()
    expect(facetHref({ kind: 'link', uri: 'data:text/html,hi' })).toBeNull()
    expect(facetHref({ kind: 'link', uri: 'ftp://example.com' })).toBeNull()
    expect(facetHref({ kind: 'link', uri: '/relative/path' })).toBeNull()
    expect(facetHref({ kind: 'link', uri: 'example.com' })).toBeNull()
    expect(facetHref({ kind: 'link', uri: 'http://' })).toBeNull()
    expect(facetHref({ kind: 'link', uri: '' })).toBeNull()
  })

  it('returns null for unknown features', () => {
    expect(facetHref({ kind: 'unknown', typeName: 'app.bsky.richtext.facet#other' })).toBeNull()
  })
})
