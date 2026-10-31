import { describe, expect, it } from 'vitest'
import { DISCOVER_FEED_URI } from './atproto'
import { feedbackTargetFor } from './feedFeedback'
import type { PinnedFeedModel } from './types'

const accepts = 'at://did:plc:test/app.bsky.feed.generator/accepts'
const silent = 'at://did:plc:test/app.bsky.feed.generator/silent'
const omitted = 'at://did:plc:test/app.bsky.feed.generator/omitted'
const didless = 'at://did:plc:test/app.bsky.feed.generator/didless'

const pinned: PinnedFeedModel[] = [
  {
    uri: accepts,
    name: 'accepts',
    description: '',
    avatar: null,
    generatorDid: 'did:web:feeds.test',
    acceptsInteractions: true,
  },
  {
    uri: silent,
    name: 'silent',
    description: '',
    avatar: null,
    generatorDid: 'did:web:feeds.test',
    acceptsInteractions: false,
  },
  {
    uri: omitted,
    name: 'omitted',
    description: '',
    avatar: null,
    generatorDid: 'did:web:feeds.test',
    // the generator metadata omitted the lexicon-optional field
    acceptsInteractions: null,
  },
  {
    uri: didless,
    name: 'didless',
    description: '',
    avatar: null,
    // the generator record never resolved, so no service is known
    generatorDid: null,
    acceptsInteractions: null,
  },
]

const discoverAccepts = { did: 'did:web:discover.bsky.app', acceptsInteractions: true }

describe('feedbackTargetFor', () => {
  it.each([
    {
      label: 'discover targets its own generator service',
      source: { kind: 'discover' } as const,
      discover: discoverAccepts,
      expected: { feed: DISCOVER_FEED_URI, generatorDid: 'did:web:discover.bsky.app' },
    },
    {
      label: 'discover without a resolved service did is not a target',
      source: { kind: 'discover' } as const,
      discover: { did: null, acceptsInteractions: true },
      expected: null,
    },
    {
      label: 'discover that explicitly refuses interactions is not a target',
      source: { kind: 'discover' } as const,
      discover: { did: 'did:web:discover.bsky.app', acceptsInteractions: false },
      expected: null,
    },
    {
      label: 'discover metadata that omits the capability keeps feedback offered',
      source: { kind: 'discover' } as const,
      discover: { did: 'did:web:discover.bsky.app', acceptsInteractions: null },
      expected: { feed: DISCOVER_FEED_URI, generatorDid: 'did:web:discover.bsky.app' },
    },
    {
      label: 'a pinned generator that accepts interactions is the target',
      source: { kind: 'feed', uri: accepts } as const,
      discover: discoverAccepts,
      expected: { feed: accepts, generatorDid: 'did:web:feeds.test' },
    },
    {
      label: 'a pinned generator that explicitly refuses interactions is not a target',
      source: { kind: 'feed', uri: silent } as const,
      discover: discoverAccepts,
      expected: null,
    },
    {
      label: 'metadata that omits acceptsInteractions keeps feedback offered',
      source: { kind: 'feed', uri: omitted } as const,
      discover: discoverAccepts,
      expected: { feed: omitted, generatorDid: 'did:web:feeds.test' },
    },
    {
      label: 'a pinned feed without a generator did is not a target',
      source: { kind: 'feed', uri: didless } as const,
      discover: discoverAccepts,
      expected: null,
    },
    {
      label: 'a feed that is not pinned has no generator metadata',
      source: { kind: 'feed', uri: 'at://explicit/feed' } as const,
      discover: discoverAccepts,
      expected: null,
    },
    {
      label: 'a pinned feed used as an author source is not a target',
      source: { kind: 'author', actor: 'alice.test' } as const,
      discover: discoverAccepts,
      expected: null,
    },
  ])('$label', ({ source, discover, expected }) => {
    expect(feedbackTargetFor(source, pinned, discover)).toEqual(expected)
  })
})
