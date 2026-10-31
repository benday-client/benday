/**
 * One segmenter for the whole app: initials, composer length limits and any
 * other place that must agree on what "one character" means. Latin-1 slicing
 * splits emoji and combining marks, so nobody should do that locally.
 */
export const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The first whole grapheme cluster, or `''` for an empty string. */
export function firstGrapheme(value: string): string {
  if (value.length === 0) return ''
  for (const segment of graphemes.segment(value)) return segment.segment
  return ''
}

/**
 * At most `limit` whole grapheme clusters from the start of `value`, without
 * ever splitting a cluster. The whole value comes back when it is already
 * short enough; no ellipsis is appended here, the caller owns that.
 */
export function truncateGraphemes(value: string, limit: number): string {
  if (limit <= 0) return ''
  let taken = ''
  let count = 0
  for (const segment of graphemes.segment(value)) {
    if (count === limit) return taken
    taken += segment.segment
    count += 1
  }
  return taken
}
