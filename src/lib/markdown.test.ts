import { describe, expect, it } from 'vitest'
import { markdownText, parseMarkdown } from './markdown'

describe('parseMarkdown', () => {
  it('leaves plain text untouched', () => {
    expect(parseMarkdown('hello world')).toEqual({ text: 'hello world', facets: [] })
  })

  it('converts bold, italic, strikethrough and code markers', () => {
    const parsed = parseMarkdown('**bold** *italic* _also_ ~~gone~~ `code`')

    expect(parsed.text).toBe('bold italic also gone code')
    expect(parsed.facets.map((facet) => facet.features[0]?.$type)).toEqual([
      'app.bsky.richtext.facet#bold',
      'app.bsky.richtext.facet#italic',
      'app.bsky.richtext.facet#italic',
      'app.bsky.richtext.facet#strikethrough',
      'app.bsky.richtext.facet#code',
    ])
  })

  it('converts markdown links to link facets and keeps the label', () => {
    const parsed = parseMarkdown('read [the site](https://example.com/a)')

    expect(parsed.text).toBe('read the site')
    expect(parsed.facets).toEqual([
      {
        index: { byteStart: 5, byteEnd: 13 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/a' }],
      },
    ])
  })

  it('uses UTF-8 byte offsets', () => {
    const parsed = parseMarkdown('hé **là**')
    const start = new TextEncoder().encode('hé ').length
    const end = start + new TextEncoder().encode('là').length

    expect(parsed.text).toBe('hé là')
    expect(parsed.facets[0]?.index).toEqual({ byteStart: start, byteEnd: end })
  })

  it('handles nested emphasis', () => {
    const parsed = parseMarkdown('**bold _and italic_**')

    expect(parsed.text).toBe('bold and italic')
    expect(parsed.facets.map((facet) => facet.features[0]?.$type)).toEqual([
      'app.bsky.richtext.facet#bold',
      'app.bsky.richtext.facet#bold',
      'app.bsky.richtext.facet#italic',
    ])
  })

  it('does not treat code contents as markdown', () => {
    const parsed = parseMarkdown('`**literal**`')

    expect(parsed.text).toBe('**literal**')
    expect(parsed.facets).toEqual([
      {
        index: { byteStart: 0, byteEnd: 11 },
        features: [{ $type: 'app.bsky.richtext.facet#code' }],
      },
    ])
  })
})

describe('markdownText', () => {
  it('strips markers for counting and validation', () => {
    expect(markdownText('**hello** [world](https://example.com)')).toBe('hello world')
    expect(markdownText('**')).toBe('**')
  })
})
