import { describe, expect, it } from 'vitest'
import { parseCommand } from './command'

describe('parseCommand', () => {
  it('returns null for empty input', () => {
    expect(parseCommand('')).toBeNull()
    expect(parseCommand('   ')).toBeNull()
    expect(parseCommand('\n\t')).toBeNull()
  })

  it('routes handles to profiles', () => {
    expect(parseCommand('@alice.bsky.social')).toEqual({
      type: 'navigate',
      href: '/profile/alice.bsky.social',
      label: 'profile @alice.bsky.social',
    })
  })

  it('encodes handle characters', () => {
    expect(parseCommand('@alice+test.bsky.social')).toEqual({
      type: 'navigate',
      href: '/profile/alice%2Btest.bsky.social',
      label: 'profile @alice+test.bsky.social',
    })
  })

  it('routes post at-uris to threads', () => {
    const uri = 'at://did:plc:abc123/app.bsky.feed.post/3k2f'
    expect(parseCommand(uri)).toEqual({
      type: 'navigate',
      href: `/thread?uri=${encodeURIComponent(uri)}`,
      label: 'thread',
    })
  })

  it('routes generator at-uris to search text', () => {
    const uri = 'at://did:plc:abc123/app.bsky.feed.generator/whats-hot'
    expect(parseCommand(uri)).toEqual({
      type: 'navigate',
      href: `/search?q=${encodeURIComponent(uri)}`,
      label: `search “${uri}”`,
    })
  })

  it('routes other at-uris to threads', () => {
    const uri = 'at://did:plc:abc123/app.bsky.actor.profile/self'
    expect(parseCommand(uri)).toEqual({
      type: 'navigate',
      href: `/thread?uri=${encodeURIComponent(uri)}`,
      label: 'thread',
    })
  })

  it('routes tags to search', () => {
    expect(parseCommand('#cats')).toEqual({
      type: 'navigate',
      href: '/search?q=cats',
      label: 'search “cats”',
    })
  })

  it('routes plain text to search', () => {
    expect(parseCommand('hello world')).toEqual({
      type: 'navigate',
      href: '/search?q=hello%20world',
      label: 'search “hello world”',
    })
  })

  it('encodes search characters', () => {
    expect(parseCommand('a&b c/d')).toEqual({
      type: 'navigate',
      href: '/search?q=a%26b%20c%2Fd',
      label: 'search “a&b c/d”',
    })
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parseCommand('  @alice.bsky.social  ')).toEqual({
      type: 'navigate',
      href: '/profile/alice.bsky.social',
      label: 'profile @alice.bsky.social',
    })
  })
})
