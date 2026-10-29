import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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

export function mentionAt(text: string, cursor: number): MentionToken | null {
  const before = text.slice(0, cursor)
  const match = /(^|\s)@([a-zA-Z0-9._-]*)$/.exec(before)
  if (match === null) return null

  const query = match[2] ?? ''
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  return { start: at, end: cursor, query }
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
  const normalized = query.trim()
  const debounced = useDebouncedValue(normalized, 180)

  const result = useQuery({
    queryKey: ['actor-suggestions', target.host, debounced],
    queryFn: () => fetchActorSuggestions(target, debounced),
    enabled: enabled && debounced.length > 0,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  })

  return {
    suggestions: result.data ?? [],
    isPending: enabled && normalized.length > 0 && result.isPending,
  }
}
