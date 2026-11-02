import type { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { createTestQueryClient } from '../test/queryClient'
import { invalidateNonFeedQueries } from './queries'

const HOST = 'https://api.bsky.app'
const VIEWER = 'did:plc:viewer'
const POST = 'at://did:plc:ada/app.bsky.feed.post/1'
const GENERATOR = 'at://did:plc:gen/app.bsky.feed.generator/cats'

// real viewer-scoped and host-scoped keys, not an abstract naming scheme
const STABLE_KEYS = [
  ['feed', HOST, 'discover', VIEWER],
  ['pinned-feeds', VIEWER],
  ['feed-generator', GENERATOR],
  ['labeler-details', HOST, 'did:plc:lab,did:plc:lab2'],
] as const

const CHANGED_KEYS = [
  ['profile', HOST, 'ada.test', VIEWER],
  ['thread', HOST, POST],
  ['top-comments', HOST, POST],
  ['feed-preview', HOST, { kind: 'discover' }, VIEWER],
  ['notifications', 'list', VIEWER],
  ['actor-suggestions', HOST, 'ad'],
  ['tag-suggestions', HOST, 'tensorpunk'],
  ['search-actors', HOST, 'ad'],
  ['search-feeds', HOST, 'cats'],
] as const

async function seed(client: QueryClient, key: readonly unknown[], counts: Map<string, number>) {
  const root = String(key[0])
  await client.fetchQuery({
    queryKey: key,
    queryFn: async () => {
      counts.set(root, (counts.get(root) ?? 0) + 1)
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

    // refetching only what the policy invalidated: the changed roots run again
    // and the stable ones never do
    await client.refetchQueries({ predicate: (query) => query.state.isInvalidated })
    for (const key of STABLE_KEYS) expect(counts.get(String(key[0]))).toBe(1)
    for (const key of CHANGED_KEYS) expect(counts.get(String(key[0]))).toBe(2)
  })
})
