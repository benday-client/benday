import { beforeEach, describe, expect, it } from 'vitest'
import { clearDraft, draftKeyFor, readDraft, writeDraft } from './drafts'

const KEY = 'benday:drafts'

function stored(): Record<string, unknown> {
  const raw = localStorage.getItem(KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>)
}

describe('drafts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps separate drafts for post reply and quote', () => {
    const account = 'did:plc:test'
    const post = draftKeyFor('post', null, account)
    const reply = draftKeyFor('reply', 'at://post/a', account)
    const quote = draftKeyFor('quote', 'at://post/a', account)

    writeDraft(post, 'a post')
    writeDraft(reply, 'a reply')
    writeDraft(quote, 'a quote')

    expect(readDraft(post)).toBe('a post')
    expect(readDraft(reply)).toBe('a reply')
    expect(readDraft(quote)).toBe('a quote')
  })

  it('scopes drafts by account', () => {
    const first = draftKeyFor('post', null, 'did:plc:first')
    const second = draftKeyFor('post', null, 'did:plc:second')

    writeDraft(first, 'first account')
    writeDraft(second, 'second account')

    expect(readDraft(first)).toBe('first account')
    expect(readDraft(second)).toBe('second account')
    expect(readDraft(draftKeyFor('post', null, 'did:plc:third'))).toBe('')
  })

  it('returns a fresh lowercase hex revision per write', () => {
    const first = writeDraft('post', 'hello')
    const second = writeDraft('post', 'hello')

    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(second).toMatch(/^[0-9a-f]{32}$/)
    expect(first).not.toBe(second)
  })

  it('removes empty drafts without leaving a revision', () => {
    writeDraft('post', 'hello')
    expect(writeDraft('post', '   ')).toBeNull()
    expect(readDraft('post')).toBe('')
  })

  it('clears only the exact revision and text it wrote', () => {
    const revision = writeDraft('post', 'hello')
    if (revision === null) throw new Error('draft was not written')

    clearDraft('post', revision, 'different text')
    expect(readDraft('post')).toBe('hello')

    clearDraft('post', 'f'.repeat(32), 'hello')
    expect(readDraft('post')).toBe('hello')

    writeDraft('post', 'newer draft')
    clearDraft('post', revision, 'hello')
    expect(readDraft('post')).toBe('newer draft')

    const latest = writeDraft('post', 'newer draft')
    if (latest === null) throw new Error('draft was not written')
    clearDraft('post', latest, 'newer draft')
    expect(readDraft('post')).toBe('')
  })

  it('drops malformed entries before eviction and keeps the newest drafts', () => {
    const mixed: Record<string, unknown> = {
      'kept-legacy': { text: 'legacy record', updatedAt: 1 },
      'null-entry': null,
      'array-entry': ['text'],
      'string-entry': 'text',
      'missing-date': { text: 'no date' },
      'bad-date': { text: 'bad date', updatedAt: 'yesterday' },
      'bad-revision': { text: 'bad revision', updatedAt: 2, revision: 7 },
    }
    for (let index = 0; index < 22; index += 1) {
      mixed[`draft-${index}`] = { text: `text-${index}`, updatedAt: 100 + index }
    }
    localStorage.setItem(KEY, JSON.stringify(mixed))

    expect(() => writeDraft('draft-22', 'text-22')).not.toThrow()

    const kept = stored()
    expect(Object.keys(kept)).toHaveLength(20)
    expect(readDraft('draft-0')).toBe('')
    expect(readDraft('draft-1')).toBe('')
    expect(readDraft('draft-3')).toBe('text-3')
    expect(readDraft('draft-22')).toBe('text-22')
    expect(kept['null-entry']).toBeUndefined()
    expect(kept['array-entry']).toBeUndefined()
  })

  it('ignores a stored array instead of treating it as drafts', () => {
    localStorage.setItem(KEY, JSON.stringify([{ text: 'nope', updatedAt: 1 }]))
    expect(readDraft('0')).toBe('')
    writeDraft('post', 'fresh')
    expect(readDraft('post')).toBe('fresh')
    expect(Array.isArray(stored())).toBe(false)
  })
})
