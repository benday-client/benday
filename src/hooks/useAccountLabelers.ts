import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { clearAccountLabelers, setAccountLabelers } from '../lib/accountLabelers'
import { fetchLabelerPrefsFor } from '../lib/atproto'
import { getAuthAgent, useAuthStore } from '../lib/auth'
import { applyConfiguredLabelers } from '../lib/labelers'
import { invalidateNonFeedQueries } from '../lib/queries'

/**
 * Establishes the labeler list for the signed-in account. The account owns it,
 * so a new account clears the old list before its own preferences load, and a
 * failure leaves the empty list applied rather than borrowing another one.
 */
export function useAccountLabelers(): void {
  const did = useAuthStore((state) => state.account?.did ?? null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (did === null) {
      clearAccountLabelers()
      return
    }
    // the read agent may already exist for this account; it starts with no
    // labelers and receives the fetched list below
    setAccountLabelers(did, [])
    const agent = getAuthAgent()
    if (agent !== null) applyConfiguredLabelers(agent)
    void invalidateNonFeedQueries(queryClient)
  }, [did, queryClient])

  const query = useQuery({
    queryKey: ['account-labelers', did],
    queryFn: () => fetchLabelerPrefsFor(did ?? ''),
    enabled: did !== null,
    staleTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (did === null || query.data === undefined) return
    setAccountLabelers(did, query.data)
    const agent = getAuthAgent()
    if (agent !== null) applyConfiguredLabelers(agent)
    void invalidateNonFeedQueries(queryClient)
  }, [did, query.data, queryClient])
}
