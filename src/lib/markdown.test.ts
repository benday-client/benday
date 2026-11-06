import { describe, expect, it } from 'vitest'
import { markdownText, parseMarkdown } from './markdown'

describe('parseMarkdown', () => {
  it('leaves plain text untouched', () => {
    expect(parseMarkdown('hello world')).toEqual({ text: 'hello world', facets: [] })
  })

  it('publishes style markers literally with no style facets', () => {
    const source = '**bold** *italic* _also_ ~~gone~~ `code`'
    const parsed = parseMarkdown(source)

    expect(parsed.text).toBe(source)
    expect(parsed.facets).toEqual([])
  })

  it('publishes a hashtag literally', () => {
    expect(parseMarkdown('#tag stays text')).toEqual({ text: '#tag stays text', facets: [] })
  })

  it('converts labelled links to link facets and keeps the label', () => {
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
    const parsed = parseMarkdown('hé [là](https://example.com)')
    const start = new TextEncoder().encode('hé ').length
    const end = start + new TextEncoder().encode('là').length

    expect(parsed.text).toBe('hé là')
    expect(parsed.facets[0]?.index).toEqual({ byteStart: start, byteEnd: end })
  })

  it('keeps nested emphasis literal', () => {
    const parsed = parseMarkdown('**bold _and italic_**')

    expect(parsed.text).toBe('**bold _and italic_**')
    expect(parsed.facets).toEqual([])
  })

  it('keeps code contents and backticks literal', () => {
    const parsed = parseMarkdown('`**literal**`')

    expect(parsed.text).toBe('`**literal**`')
    expect(parsed.facets).toEqual([])
  })

  it('keeps intraword underscores and asterisks literal', () => {
    expect(parseMarkdown('snake_case_name')).toEqual({
      text: 'snake_case_name',
      facets: [],
    })
    expect(parseMarkdown('2*3*4')).toEqual({ text: '2*3*4', facets: [] })
  })

  it('keeps bare urls literal with no facet', () => {
    const source = 'see https://example.com/some_path_here'
    expect(parseMarkdown(source)).toEqual({ text: source, facets: [] })
  })

  it('only accepts an http labelled link', () => {
    expect(parseMarkdown('[label](ftp://example.com)')).toEqual({
      text: '[label](ftp://example.com)',
      facets: [],
    })
  })

  it('keeps balanced parentheses in link destinations', () => {
    const parsed = parseMarkdown('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))')

    expect(parsed.text).toBe('wiki')
    expect(parsed.facets).toEqual([
      {
        index: { byteStart: 0, byteEnd: 4 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://en.wikipedia.org/wiki/Foo_(bar)',
          },
        ],
      },
    ])
  })
})

describe('markdownText', () => {
  it('counts the text that is actually sent', () => {
    expect(markdownText('**hello** [world](https://example.com)')).toBe('**hello** world')
    expect(markdownText('**')).toBe('**')
    expect(markdownText('~~x~~ `x`')).toBe('~~x~~ `x`')
  })
})
