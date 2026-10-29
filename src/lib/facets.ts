import type { FacetFeature, FacetSpan } from './types'

export interface TextSegment {
  text: string
  feature: FacetFeature | null
}

export interface FacetLink {
  href: string
  external: boolean
}

interface ResolvedSpan {
  start: number
  end: number
  feature: FacetFeature
}

/**
 * Facet offsets from the wire are UTF-8 byte offsets. Build a table that maps
 * every byte boundary to the UTF-16 index where the byte's code point starts.
 * Offsets that land inside a multi-byte code point therefore round down to the
 * start of that code point instead of splitting it.
 */
function buildByteIndex(text: string): number[] {
  const encoder = new TextEncoder()
  const byteLength = encoder.encode(text).length
  const map = new Array<number>(byteLength + 1).fill(0)
  let bytePosition = 0
  let utf16Position = 0
  for (const char of text) {
    const width = encoder.encode(char).length
    for (let offset = 0; offset < width; offset += 1) {
      map[bytePosition + offset] = utf16Position
    }
    bytePosition += width
    utf16Position += char.length
  }
  map[byteLength] = text.length
  return map
}

function resolveSpan(span: FacetSpan, map: number[], byteLength: number): ResolvedSpan | null {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) return null
  if (span.start < 0 || span.end <= span.start || span.start >= byteLength) return null
  if (span.end > byteLength) return null
  const start = map[span.start] ?? 0
  const end = map[span.end] ?? 0
  if (end <= start) return null
  return { start, end, feature: span.feature }
}

export function segmentText(text: string, facets: readonly FacetSpan[]): TextSegment[] {
  if (text.length === 0) return []
  const map = buildByteIndex(text)
  const byteLength = map.length - 1
  const spans: ResolvedSpan[] = []
  for (const facet of facets) {
    const resolved = resolveSpan(facet, map, byteLength)
    if (resolved !== null) spans.push(resolved)
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end)

  const segments: TextSegment[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start), feature: null })
    }
    segments.push({ text: text.slice(span.start, span.end), feature: span.feature })
    cursor = span.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), feature: null })
  }
  return segments
}

function linkHref(uri: string): FacetLink | null {
  if (uri.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname.length === 0) return null
  return { href: uri, external: true }
}

export function facetHref(feature: FacetFeature): FacetLink | null {
  switch (feature.kind) {
    case 'mention':
      return { href: `/profile/${encodeURIComponent(feature.handle)}`, external: false }
    case 'tag':
      return { href: `/search?q=${encodeURIComponent(`#${feature.tag}`)}`, external: false }
    case 'link':
      return linkHref(feature.uri)
    case 'unknown':
      return null
  }
}
