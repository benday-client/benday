import type { AtpAgent } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { createPost, fetchViewerStates } from './actions'
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

  it('converts markdown markers into record facets', async () => {
    const post = vi.fn(async (_record: unknown) => ({ uri: 'at://new', cid: 'new-cid' }))
    vi.mocked(getAuthAgent).mockReturnValue({ post } as unknown as AtpAgent)

    await createPost('**bold** and ~~gone~~')

    expect(post).toHaveBeenCalledTimes(1)
    const record = post.mock.calls[0]?.[0] as {
      text: string
      facets: { index: { byteStart: number; byteEnd: number }; features: { $type?: string }[] }[]
    }
    expect(record.text).toBe('bold and gone')
    expect(record.facets).toEqual([
      {
        index: { byteStart: 0, byteEnd: 4 },
        features: [{ $type: 'app.bsky.richtext.facet#bold' }],
      },
      {
        index: { byteStart: 9, byteEnd: 13 },
        features: [{ $type: 'app.bsky.richtext.facet#strikethrough' }],
      },
    ])
  })
})
