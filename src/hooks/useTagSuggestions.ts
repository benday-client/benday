import { useQuery } from '@tanstack/react-query'
import { fetchTagSuggestions } from '../lib/atproto'
import { useDebouncedValue } from './useDebouncedValue'

export interface TagSuggestionsState {
  tags: string[]
  isPending: boolean
}

export function useTagSuggestions(query: string, enabled: boolean): TagSuggestionsState {
  const normalized = query.trim()
  const debounced = useDebouncedValue(normalized, 220)
  const settled = debounced === normalized

  const result = useQuery({
    queryKey: ['tag-suggestions', debounced],
    queryFn: () => fetchTagSuggestions(debounced),
    enabled: enabled && debounced.length > 0,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  })

  return {
    tags: enabled && settled ? (result.data ?? []) : [],
    isPending: enabled && normalized.length > 0 && (!settled || result.isPending),
  }
}
