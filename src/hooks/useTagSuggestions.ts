import { useQuery } from '@tanstack/react-query'
import { capabilitiesFor } from '../lib/appviews'
import { fetchTagSuggestions } from '../lib/atproto'
import { useSettings } from '../lib/store'
import { useDebouncedValue } from './useDebouncedValue'

export interface TagSuggestionsState {
  tags: string[]
  isPending: boolean
}

export function useTagSuggestions(query: string, enabled: boolean): TagSuggestionsState {
  const target = useSettings((state) => state.appView)
  const searchSupported = capabilitiesFor(target).search
  const normalized = query.trim()
  const debounced = useDebouncedValue(normalized, 220)
  const settled = debounced === normalized

  const result = useQuery({
    queryKey: ['tag-suggestions', target.host, debounced],
    queryFn: () => fetchTagSuggestions(target, debounced),
    enabled: searchSupported && enabled && debounced.length > 0,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  })

  return {
    tags: searchSupported && enabled && settled ? (result.data ?? []) : [],
    isPending:
      searchSupported && enabled && normalized.length > 0 && (!settled || result.isPending),
  }
}
