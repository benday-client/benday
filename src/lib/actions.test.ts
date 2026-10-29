import type { AtpAgent } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { fetchViewerStates } from './actions'
import { getAuthAgent } from './auth'

vi.mock('./auth', () => ({
  getAuthAgent: vi.fn(),
}))

describe('fetchViewerStates', () => {
  it('routes viewer-state reads through the official appview proxy', async () => {
    const getPosts = vi.fn(async () => ({
      data: {
        posts: [
          {
            uri: 'at://did:plc:test/app.bsky.feed.post/1',
            viewer: { like: 'at://like/1', repost: null },
          },
        ],
      },
    }))
    const withProxy = vi.fn(() => ({
      app: { bsky: { feed: { getPosts } } },
    }))

    vi.mocked(getAuthAgent).mockReturnValue({ withProxy } as unknown as AtpAgent)

    const states = await fetchViewerStates(['at://did:plc:test/app.bsky.feed.post/1'])

    expect(withProxy).toHaveBeenCalledWith('bsky_appview', 'did:web:api.bsky.app')
    expect(getPosts).toHaveBeenCalledWith({
      uris: ['at://did:plc:test/app.bsky.feed.post/1'],
    })
    expect(states.get('at://did:plc:test/app.bsky.feed.post/1')).toEqual({
      likeUri: 'at://like/1',
      repostUri: null,
    })
  })
})
