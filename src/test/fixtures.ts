import type { PostModel, ProfileModel, ThreadModel } from '../lib/types'

export function postFixture(overrides: Partial<PostModel> = {}): PostModel {
  return {
    uri: 'at://did:plc:test/app.bsky.feed.post/1',
    cid: 'cid-1',
    author: {
      did: 'did:plc:test',
      handle: 'test.bsky.social',
      displayName: 'test',
      avatar: null,
      muted: false,
      blocked: false,
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
    replyParent: null,
    replyContext: null,
    labels: [],
    ...overrides,
  }
}

export function profileFixture(overrides: Partial<ProfileModel> = {}): ProfileModel {
  return {
    did: 'did:plc:test',
    handle: 'test.bsky.social',
    displayName: 'test',
    description: '',
    pronouns: '',
    avatar: null,
    banner: null,
    followersCount: 0,
    followsCount: 0,
    postsCount: 0,
    createdAt: null,
    labels: [],
    links: [],
    isBot: false,
    viewer: {
      following: null,
      followedBy: null,
      muted: false,
      mutedOnlyReposts: false,
      mutedOnlyQuoteposts: false,
      blocking: null,
      blockedBy: false,
      activitySubscription: null,
    },
    ...overrides,
  }
}

export function threadFixture(focus: PostModel, replies: PostModel[] = []): ThreadModel {
  return {
    focusUri: focus.uri,
    entries: [
      { post: focus, depth: 0, role: 'focus' },
      ...replies.map((post) => ({ post, depth: 1, role: 'reply' as const })),
    ],
  }
}

/** Body long enough that its card cannot fit inside the app shell. */
export function longPostFixture(overrides: Partial<PostModel> = {}): PostModel {
  return postFixture({ text: 'word '.repeat(1200), replyCount: 0, ...overrides })
}
