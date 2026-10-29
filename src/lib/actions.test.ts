import type { AtpAgent } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { postFixture } from '../test/fixtures'
import { createPost, deletePost, fetchViewerStates, sendFeedFeedback } from './actions'
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

  it('deletes a post record by at-uri', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await deletePost('at://did:plc:test/app.bsky.feed.post/abc123')

    expect(deleteRecord).toHaveBeenCalledWith({
      repo: 'did:plc:test',
      collection: 'app.bsky.feed.post',
      rkey: 'abc123',
    })
  })

  it('refuses to delete a record outside the post collection', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await expect(deletePost('at://did:plc:test/app.bsky.feed.like/abc123')).rejects.toThrow(
      'invalid post uri',
    )
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('refuses to delete a post owned by another repo', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await expect(deletePost('at://did:plc:other/app.bsky.feed.post/abc123')).rejects.toThrow(
      'invalid post uri',
    )
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('refuses an at-uri with more than five segments', async () => {
    const deleteRecord = vi.fn(async () => ({}))
    vi.mocked(getAuthAgent).mockReturnValue({
      did: 'did:plc:test',
      com: { atproto: { repo: { deleteRecord } } },
    } as unknown as AtpAgent)

    await expect(deletePost('at://did:plc:test/app.bsky.feed.post/abc123/extra')).rejects.toThrow(
      'invalid post uri',
    )
    expect(deleteRecord).not.toHaveBeenCalled()
  })

  it('sends more and less feed interactions with feed context', async () => {
    const sendInteractions = vi.fn(async () => ({}))
    const withProxy = vi.fn(() => ({ app: { bsky: { feed: { sendInteractions } } } }))
    vi.mocked(getAuthAgent).mockReturnValue({ withProxy } as unknown as AtpAgent)
    const post = { ...postFixture(), feedContext: 'ctx-1', reqId: 'req-1' }

    await sendFeedFeedback('at://did:plc:test/app.bsky.feed.generator/one', post, 'more')
    await sendFeedFeedback('at://did:plc:test/app.bsky.feed.generator/one', post, 'less')

    expect(withProxy).toHaveBeenCalledWith('bsky_appview', 'did:web:api.bsky.app')
    expect(sendInteractions).toHaveBeenNthCalledWith(1, {
      feed: 'at://did:plc:test/app.bsky.feed.generator/one',
      interactions: [
        {
          $type: 'app.bsky.feed.defs#interaction',
          item: post.uri,
          event: 'app.bsky.feed.defs#requestMore',
          feedContext: 'ctx-1',
          reqId: 'req-1',
        },
      ],
    })
    expect(sendInteractions).toHaveBeenNthCalledWith(2, {
      feed: 'at://did:plc:test/app.bsky.feed.generator/one',
      interactions: [
        {
          $type: 'app.bsky.feed.defs#interaction',
          item: post.uri,
          event: 'app.bsky.feed.defs#requestLess',
          feedContext: 'ctx-1',
          reqId: 'req-1',
        },
      ],
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
