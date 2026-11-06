import { useQuery } from '@tanstack/react-query'
import { type ActorSuggestion, fetchActorSuggestions } from '../lib/atproto'
import { useDebouncedValue } from './useDebouncedValue'

export interface ActorSuggestionsState {
  suggestions: ActorSuggestion[]
  isPending: boolean
}

export interface MentionToken {
  start: number
  end: number
  query: string
}

export interface SuggestionToken extends MentionToken {
  kind: 'mention'
}

const TOKEN_CHAR = /[\p{L}\p{N}._-]/u
const WHITESPACE = /\s/u
const TRAILING_TOKEN_PUNCTUATION: Record<string, true> = { '.': true, '-': true }

export interface SuggestionItem {
  key: string
  value: string
  label: string
  detail: string
}

/**
 * The one list shape every suggestion surface shows: fetched accounts when they
 * answered, a nonempty literal handle otherwise, and nothing for an empty
 * mention (an empty replacement would delete the marker itself).
 */
export function buildSuggestions(
  token: SuggestionToken | null,
  actors: readonly ActorSuggestion[],
): SuggestionItem[] {
  if (token === null) return []

  if (token.query.length === 0) return []
  if (actors.length === 0) {
    return [
      { key: 'literal-handle', value: token.query, label: `@${token.query}`, detail: 'handle' },
    ]
  }
  return actors.map((actor) => ({
    key: actor.did,
    value: actor.handle,
    label: `@${actor.handle}`,
    detail: actor.displayName,
  }))
}

export function suggestionAt(text: string, cursor: number): SuggestionToken | null {
  const before = text.slice(0, cursor)
  const match = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before)
  if (match === null) return null

  const start = before.lastIndexOf('@')
  if (start < 0) return null

  let end = cursor
  while (end < text.length && TOKEN_CHAR.test(text.charAt(end))) end += 1
  // a handle never ends in `.` or `-`: those characters belong to the sentence
  // around the token, so the replacement span and its query stop before them
  while (end > start + 1 && TRAILING_TOKEN_PUNCTUATION[text.charAt(end - 1)] === true) end -= 1
  const query = text.slice(start + 1, Math.min(cursor, end))
  return { start, end, query, kind: 'mention' }
}

/**
 * Replacement for an accepted suggestion. The text around the token survives
 * byte for byte: at the end of the text one space follows the handle, and a
 * caret that already sits before whitespace or punctuation keeps its place.
 */
export function insertSuggestion(
  text: string,
  token: SuggestionToken,
  value: string,
): { text: string; cursor: number } {
  const inserted = `@${value}`
  const head = text.slice(0, token.start)
  const suffix = text.slice(token.end)
  let next = `${head}${inserted}${suffix}`
  let cursor = head.length + inserted.length

  if (suffix.length === 0) {
    next += ' '
    return { text: next, cursor: cursor + 1 }
  }

  // an existing separator is reused instead of doubled, and the caret lands
  // after the whole run so typing continues past it and never inside a CRLF
  while (cursor < next.length && WHITESPACE.test(next.charAt(cursor))) cursor += 1
  return { text: next, cursor }
}

export function useActorSuggestions(query: string, enabled: boolean): ActorSuggestionsState {
  const normalized = query.trim()
  const debounced = useDebouncedValue(normalized, 180)
  // a suggestion from the previous token must not answer for the current one
  const settled = debounced === normalized

  const result = useQuery({
    queryKey: ['actor-suggestions', debounced],
    queryFn: () => fetchActorSuggestions(debounced),
    enabled: enabled && debounced.length > 0,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  })

  return {
    suggestions: enabled && settled ? (result.data ?? []) : [],
    isPending: enabled && normalized.length > 0 && (!settled || result.isPending),
  }
}
