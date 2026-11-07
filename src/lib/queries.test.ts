import type { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createTestQueryClient } from '../test/queryClient'
import { invalidateNonFeedQueries } from './queries'

const VIEWER = 'did:plc:viewer'
const POST = 'at://did:plc:ada/app.bsky.feed.post/1'
const ACTOR = 'did:plc:ada'
const QUERY = 'cats'

// real production key shapes, not an abstract naming scheme
const STABLE_KEYS = [
  ['feed', 'feed', 'at://did:plc:ada/app.bsky.feed.generator/cats', VIEWER],
  ['feed', 'author', ACTOR, 'anonymous'],
  ['feed', 'search', QUERY, VIEWER],
  ['pinned-feeds', VIEWER],
  ['account-labelers', ACTOR],
] as const

const CHANGED_KEYS = [
  ['thread', VIEWER, POST],
  ['profile', ACTOR, VIEWER],
  ['notifications', 'list', VIEWER],
  ['actor-suggestions', 'ad'],
  ['search-actors', 'ad'],
] as const

async function seed(client: QueryClient, key: readonly unknown[], counts: Map<string, number>) {
  const id = JSON.stringify(key)
  await client.fetchQuery({
    queryKey: key,
    queryFn: async () => {
      counts.set(id, (counts.get(id) ?? 0) + 1)
      return { key }
    },
  })
}

describe('invalidateNonFeedQueries', () => {
  it('invalidates the reads a write changes and leaves the stable roots alone', async () => {
    const client = createTestQueryClient()
    const counts = new Map<string, number>()
    for (const key of STABLE_KEYS) await seed(client, key, counts)
    for (const key of CHANGED_KEYS) await seed(client, key, counts)

    await invalidateNonFeedQueries(client)

    for (const key of STABLE_KEYS) {
      expect(client.getQueryState(key)?.isInvalidated, String(key[0])).toBe(false)
    }
    for (const key of CHANGED_KEYS) {
      expect(client.getQueryState(key)?.isInvalidated, String(key[0])).toBe(true)
    }

    // refetching only what the policy invalidated: the changed keys run again
    // and the stable ones never do
    await client.refetchQueries({ predicate: (query) => query.state.isInvalidated })
    for (const key of STABLE_KEYS) expect(counts.get(JSON.stringify(key))).toBe(1)
    for (const key of CHANGED_KEYS) expect(counts.get(JSON.stringify(key))).toBe(2)
  })
})
