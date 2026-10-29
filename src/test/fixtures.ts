import type { PostModel } from '../lib/types'

export function postFixture(overrides: Partial<PostModel> = {}): PostModel {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/1',
    cid: 'cid-1',
    author: {
      did: 'did:plc:test',
      handle: 'test.bsky.social',
      displayName: 'test',
      avatar: null,
    },
    text: 'hello',
    facets: [],
    indexedAt: '2026-10-29T12:00:00.000Z',
    replyCount: 0,
    repostCount: 1,
    likeCount: 2,
    quoteCount: 0,
    embed: null,
    reason: null,
    isReply: false,
    replyRoot: null,
    labels: [],
    ...overrides,
  }
}
