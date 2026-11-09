import { RichText } from '@atproto/api'

export const MAX_POST_GRAPHEMES = 300
export const MAX_POST_BYTES = 3000

export interface PostLimits {
  graphemes: number
  bytes: number
}

/** Measures the outgoing text once, in the units the wire contract checks. */
export function measurePost(text: string): PostLimits {
  const rich = new RichText({ text })
  return { graphemes: rich.graphemeLength, bytes: rich.length }
}

/** The first limit the text violates, describing the grapheme cap first. */
export function postLimitError(limits: PostLimits): string | null {
  if (limits.graphemes > MAX_POST_GRAPHEMES) return 'post is over 300 graphemes'
  if (limits.bytes > MAX_POST_BYTES) return 'post is over 3000 bytes'
  return null
}
