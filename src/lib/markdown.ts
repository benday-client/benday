import type { AppBskyRichtextFacet } from '@atproto/api'

export interface ParsedMarkdown {
  text: string
  facets: AppBskyRichtextFacet.Main[]
}

// A labelled link is the only markup the composer interprets: the label becomes
// the literal text and the destination becomes one link facet. Every other
// marker — emphasis delimiters, backticks, bare urls and hashtags — stays
// literal text, so what the editor sends is exactly what the reader typed.
const LINK = /\[(?<label>[^\]]+)\]\((?<url>https?:\/\/[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/gu

export function parseMarkdown(input: string): ParsedMarkdown {
  const encoder = new TextEncoder()
  const facets: ParsedMarkdown['facets'] = []
  let text = ''
  let byte = 0
  let cursor = 0

  for (const match of input.matchAll(LINK)) {
    const index = match.index ?? 0
    const label = match.groups?.['label']
    const url = match.groups?.['url']
    if (label === undefined || url === undefined) continue

    const literal = input.slice(cursor, index)
    if (literal.length > 0) {
      text += literal
      byte += encoder.encode(literal).length
    }

    const start = byte
    text += label
    byte += encoder.encode(label).length
    facets.push({
      index: { byteStart: start, byteEnd: byte },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    })

    cursor = index + match[0].length
  }

  const rest = input.slice(cursor)
  if (rest.length > 0) text += rest

  return { text, facets }
}

export function markdownText(input: string): string {
  return parseMarkdown(input).text
}
