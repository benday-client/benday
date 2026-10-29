import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { capabilitiesFor } from '../lib/appviews'
import { type ActorSuggestion, fetchActorSuggestions } from '../lib/atproto'
import { useSettings } from '../lib/store'

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
  kind: 'mention' | 'tag'
}

const TOKEN_CHAR = /[\p{L}\p{N}._-]/u

export function suggestionAt(text: string, cursor: number): SuggestionToken | null {
  const before = text.slice(0, cursor)
  const match = /(^|\s)([@#])([\p{L}\p{N}._-]*)$/u.exec(before)
  if (match === null) return null

  const marker = match[2]
  if (marker !== '@' && marker !== '#') return null
  const query = match[3] ?? ''
  const start = before.lastIndexOf(marker)
  if (start < 0) return null

  let end = cursor
  while (end < text.length && TOKEN_CHAR.test(text.charAt(end))) end += 1
  return { start, end, query, kind: marker === '@' ? 'mention' : 'tag' }
}

export function mentionAt(text: string, cursor: number): MentionToken | null {
  const token = suggestionAt(text, cursor)
  if (token === null || token.kind !== 'mention') return null
  return { start: token.start, end: token.end, query: token.query }
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delay])

  return debounced
}

export function useActorSuggestions(query: string, enabled: boolean): ActorSuggestionsState {
  const target = useSettings((state) => state.appView)
  const searchSupported = capabilitiesFor(target).search
  const normalized = query.trim()
  const debounced = useDebouncedValue(normalized, 180)

  const result = useQuery({
    queryKey: ['actor-suggestions', target.host, debounced],
    queryFn: () => fetchActorSuggestions(target, debounced),
    enabled: searchSupported && enabled && debounced.length > 0,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  })

  return {
    suggestions: searchSupported ? (result.data ?? []) : [],
    isPending: searchSupported && enabled && normalized.length > 0 && result.isPending,
  }
}
