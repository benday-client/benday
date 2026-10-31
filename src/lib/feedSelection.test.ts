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
  it('uses the first pinned feed when signed in without a requested feed', () => {
    expect(chooseFeedUri('', true, pinned)).toBe(pinned[0]?.uri)
  })

  it('keeps an explicit requested feed', () => {
    expect(chooseFeedUri('at://explicit/feed', true, pinned)).toBe('at://explicit/feed')
  })

  it('falls back to discover when signed out or with no pinned feeds', () => {
    expect(chooseFeedUri('', false, pinned)).toBe('')
    expect(chooseFeedUri('at://explicit/feed', false, pinned)).toBe('')
    expect(chooseFeedUri('', true, [])).toBe('')
  })
})
