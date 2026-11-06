import { useQuery } from '@tanstack/react-query'
import { fetchLabelerSummaries, type LabelerSummary } from '../lib/atproto'

export interface LabelerDetailsState {
  labelers: LabelerSummary[]
  isPending: boolean
  error: Error | null
}

export function useLabelerDetails(dids: readonly string[], active = true): LabelerDetailsState {
  const key = dids.join('\n')
  const enabled = active && dids.length > 0
  const query = useQuery({
    queryKey: ['labeler-details', key],
    queryFn: () => fetchLabelerSummaries(dids),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    labelers: query.data ?? [],
    isPending: enabled && query.isPending,
    error: query.error instanceof Error ? query.error : null,
  }
}
