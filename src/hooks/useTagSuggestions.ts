import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { fetchTagSuggestions } from '../lib/atproto'
import { useSettings } from '../lib/store'

export interface TagSuggestionsState {
  tags: string[]
  isPending: boolean
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

export function useTagSuggestions(query: string, enabled: boolean): TagSuggestionsState {
  const target = useSettings((state) => state.appView)
  const normalized = query.trim()
  const debounced = useDebouncedValue(normalized, 220)

  const result = useQuery({
    queryKey: ['tag-suggestions', target.host, debounced],
    queryFn: () => fetchTagSuggestions(target, debounced),
    enabled: enabled && debounced.length > 0,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  })

  return {
    tags: result.data ?? [],
    isPending: enabled && normalized.length > 0 && result.isPending,
  }
}
