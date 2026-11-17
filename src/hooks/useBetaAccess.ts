import { useEffect, useState } from 'react'
import { type BetaAccess, betaAccess, loadBetaInvites } from '../lib/betaAccess'

/**
 * Reads the shipped invitation list once per page load and answers for the
 * committed account. `checking` covers the fetch; a list that cannot be read
 * answers `unreadable`, which the shell treats exactly like a refusal.
 */
export function useBetaAccess(
  account: { did: string; handle: string | null } | null,
): BetaAccess | 'checking' {
  const [state, setState] = useState<{ did: string | null; access: BetaAccess } | null>(null)

  useEffect(() => {
    if (account === null) {
      setState(null)
      return
    }
    let live = true
    void loadBetaInvites()
      .then((invites) => betaAccess(invites, account))
      .then((access) => {
        if (live) setState({ did: account.did, access })
      })
      .catch(() => {
        if (live) setState({ did: account.did, access: 'unreadable' })
      })
    return () => {
      live = false
    }
  }, [account])

  if (account === null) return 'checking'
  if (state === null || state.did !== account.did) return 'checking'
  return state.access
}
