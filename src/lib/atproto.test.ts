import type { AppBskyActorDefs, AtpAgent } from '@atproto/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISCOVER_FEED_URI, fetchFeedPage, pinnedFeedUris } from './atproto'
import { getAuthAgent } from './auth'
import type { AppViewTarget } from './types'

vi.mock('./auth', () => ({
  getAuthAgent: vi.fn(),
}))

const TARGET: AppViewTarget = {
  id: 'canonical',
  label: 'canonical',
  host: 'https://api.bsky.app',
  kind: 'official',
  note: 'test',
}

describe('fetchFeedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads discover through the signed-in agent when one exists', async () => {
    const getFeed = vi.fn(async () => ({ data: { feed: [] } }))
    vi.mocked(getAuthAgent).mockReturnValue({
      app: { bsky: { feed: { getFeed } } },
    } as unknown as AtpAgent)

    await fetchFeedPage(TARGET, { kind: 'discover' })

    expect(getFeed).toHaveBeenCalledWith({
      feed: DISCOVER_FEED_URI,
      limit: 30,
    })
  })

  it('reads custom feeds through the signed-in agent', async () => {
    const getFeed = vi.fn(async () => ({ data: { feed: [] } }))
    vi.mocked(getAuthAgent).mockReturnValue({
      app: { bsky: { feed: { getFeed } } },
    } as unknown as AtpAgent)

    await fetchFeedPage(TARGET, {
      kind: 'feed',
      uri: 'at://did:plc:test/app.bsky.feed.generator/for-you',
    })

    expect(getFeed).toHaveBeenCalledWith({
      feed: 'at://did:plc:test/app.bsky.feed.generator/for-you',
      limit: 30,
    })
  })
})

describe('pinnedFeedUris', () => {
  it('collects pinned feeds from current and legacy preferences', () => {
    const preferences = [
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: [
          { id: '1', type: 'feed', value: 'at://feed/one', pinned: true },
          { id: '2', type: 'feed', value: 'at://feed/two', pinned: false },
          { id: '3', type: 'timeline', value: 'at://timeline', pinned: true },
        ],
      },
      {
        $type: 'app.bsky.actor.defs#savedFeedsPref',
        pinned: ['at://feed/legacy', 'at://feed/one'],
        saved: [],
      },
    ] as unknown as AppBskyActorDefs.Preferences

    expect(pinnedFeedUris(preferences)).toEqual(['at://feed/one', 'at://feed/legacy'])
  })
})
