import type { AppBskyRichtextFacet } from '@atproto/api'

type Mark = 'bold' | 'italic' | 'strikethrough' | 'code'

interface Piece {
  text: string
  marks: readonly Mark[]
  link: string | null
}

export interface ParsedMarkdown {
  text: string
  facets: AppBskyRichtextFacet.Main[]
}

const TOKEN =
  /(?<bold>\*\*(?<boldText>[\s\S]+?)\*\*)|(?<italic>\*(?<italicText>[^*\n]+?)\*)|(?<underscore>_(?<underscoreText>[^_\n]+?)_)|(?<strike>~~(?<strikeText>[\s\S]+?)~~)|(?<code>`(?<codeText>[^`\n]+?)`)|(?<link>\[(?<linkText>[^\]]+)\]\((?<linkUrl>https?:\/\/[^\s)]+)\))/g

function parsePieces(input: string, marks: readonly Mark[], link: string | null): Piece[] {
  const pieces: Piece[] = []
  let cursor = 0

  for (const match of input.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      pieces.push({ text: input.slice(cursor, index), marks, link })
    }

    const groups = match.groups
    if (groups?.['boldText'] !== undefined) {
      pieces.push(...parsePieces(groups['boldText'], [...marks, 'bold'], link))
    } else if (groups?.['italicText'] !== undefined) {
      pieces.push(...parsePieces(groups['italicText'], [...marks, 'italic'], link))
    } else if (groups?.['underscoreText'] !== undefined) {
      pieces.push(...parsePieces(groups['underscoreText'], [...marks, 'italic'], link))
    } else if (groups?.['strikeText'] !== undefined) {
      pieces.push(...parsePieces(groups['strikeText'], [...marks, 'strikethrough'], link))
    } else if (groups?.['codeText'] !== undefined) {
      pieces.push({ text: groups['codeText'], marks: [...marks, 'code'], link })
    } else if (groups?.['linkText'] !== undefined && groups?.['linkUrl'] !== undefined) {
      pieces.push(...parsePieces(groups['linkText'], marks, groups['linkUrl']))
    }

    cursor = index + match[0].length
  }

  if (cursor < input.length) {
    pieces.push({ text: input.slice(cursor), marks, link })
  }

  return pieces
}

function markFeature(mark: Mark): AppBskyRichtextFacet.Main['features'][number] {
  return { $type: `app.bsky.richtext.facet#${mark}` }
}

export function parseMarkdown(input: string): ParsedMarkdown {
  const pieces = parsePieces(input, [], null)
  const encoder = new TextEncoder()
  const facets: AppBskyRichtextFacet.Main[] = []
  const seen = new Set<string>()
  let text = ''
  let byte = 0

  for (const piece of pieces) {
    if (piece.text.length === 0) continue

    const length = encoder.encode(piece.text).length
    const start = byte
    byte += length
    text += piece.text

    for (const mark of piece.marks) {
      const key = `${start}:${byte}:${mark}`
      if (seen.has(key)) continue
      seen.add(key)
      facets.push({
        index: { byteStart: start, byteEnd: byte },
        features: [markFeature(mark)],
      })
    }

    if (piece.link !== null) {
      const key = `${start}:${byte}:link:${piece.link}`
      if (!seen.has(key)) {
        seen.add(key)
        facets.push({
          index: { byteStart: start, byteEnd: byte },
          features: [{ $type: 'app.bsky.richtext.facet#link', uri: piece.link }],
        })
      }
    }
  }

  return { text, facets }
}

export function markdownText(input: string): string {
  return parsePieces(input, [], null)
    .map((piece) => piece.text)
    .join('')
}
