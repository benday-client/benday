import { isDid } from '@atproto/api'

// The labeler list belongs to the signed-in account, not to portable settings:
// it is read from that account's preferences and applied to its read agents for
// the lifetime of the account. A switch clears it before the next fetch so an
// agent can never carry another account's list.
let accountDid: string | null = null
let labelers: readonly string[] = []

function sanitize(dids: readonly string[]): readonly string[] {
  const kept: string[] = []
  for (const did of dids) {
    if (!isDid(did) || kept.includes(did)) continue
    kept.push(did)
  }
  return kept
}

export function setAccountLabelers(did: string, dids: readonly string[]): void {
  if (accountDid !== did) labelers = []
  accountDid = did
  labelers = sanitize(dids)
}

export function clearAccountLabelers(): void {
  accountDid = null
  labelers = []
}

export function currentAccountLabelers(): readonly string[] {
  return labelers
}
