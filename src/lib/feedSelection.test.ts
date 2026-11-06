import { describe, expect, it } from 'vitest'
import { chooseFeedUri } from './feedSelection'
import type { PinnedFeedModel } from './types'

const pinned: PinnedFeedModel[] = [
  {
    uri: 'at://did:plc:test/app.bsky.feed.generator/first',
    name: 'first',
    description: '',
    avatar: null,
    generatorDid: 'did:web:feeds.test',
    acceptsInteractions: false,
  },
  {
    uri: 'at://did:plc:test/app.bsky.feed.generator/second',
    name: 'second',
    description: '',
    avatar: null,
    generatorDid: 'did:web:feeds.test',
    acceptsInteractions: false,
  },
]

describe('chooseFeedUri', () => {
  it('uses the first pinned feed when nothing is requested', () => {
    expect(chooseFeedUri('', pinned)).toBe(pinned[0]?.uri)
  })

  it('honors a request that names a pinned feed', () => {
    expect(chooseFeedUri(pinned[1]?.uri ?? '', pinned)).toBe(pinned[1]?.uri)
  })

  it('falls back to the first pin for any other generator', () => {
    expect(chooseFeedUri('at://explicit/feed', pinned)).toBe(pinned[0]?.uri)
  })

  it('has no feed when the account pinned none', () => {
    expect(chooseFeedUri('', [])).toBe('')
    expect(chooseFeedUri('at://explicit/feed', [])).toBe('')
  })
})
