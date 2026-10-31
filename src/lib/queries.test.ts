import { describe, expect, it } from 'vitest'
import { createTestQueryClient } from '../test/queryClient'
import { invalidateNonFeedQueries } from './queries'

describe('invalidateNonFeedQueries', () => {
  it('leaves feed queries untouched', async () => {
    const queryClient = createTestQueryClient()
    const feedKey = ['feed', 'app.bsky.feed', 'discover', 'anonymous']
    const profileKey = ['profile', 'app.bsky.feed', 'alice.test']
    queryClient.setQueryData(feedKey, ['post'])
    queryClient.setQueryData(profileKey, { handle: 'alice.test' })

    await invalidateNonFeedQueries(queryClient)

    expect(queryClient.getQueryState(feedKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(profileKey)?.isInvalidated).toBe(true)
  })
})
