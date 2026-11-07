import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './auth'
import {
  clearDraft,
  type DraftWrite,
  draftKeyFor,
  purgeRetiredDrafts,
  readDraft,
  writeDraft,
} from './drafts'

// the portal is external I/O; sign-out itself stays real so the retention
// check exercises the same reset the app runs
vi.mock('./oauth', () => ({
  canUseOAuth: () => false,
  restoreOAuth: async () => null,
  signInOAuth: async () => {},
  signOutOAuth: async () => {},
}))

const KEY = 'benday:drafts'

function stored(): Record<string, unknown> {
  const raw = localStorage.getItem(KEY)
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>)
}

/** The revision a successful write returned, or a failed fixture. */
function revisionOf(write: DraftWrite): string {
  if (!write.ok || write.revision === null) throw new Error('draft was not written')
  return write.revision
}

describe('drafts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps separate drafts for a post and a reply', () => {
    const account = 'did:plc:test'
    const post = draftKeyFor('post', null, account)
    const reply = draftKeyFor('reply', 'at://post/a', account)

    writeDraft(post, 'a post')
    writeDraft(reply, 'a reply')

    expect(readDraft(post)).toEqual({
      text: 'a post',
      revision: expect.any(String),
      available: true,
    })
    expect(readDraft(reply).text).toBe('a reply')
  })

  it('names every key for its account', () => {
    expect(draftKeyFor('post', null, 'did:plc:test')).toBe('did:plc:test:post')
    expect(draftKeyFor('reply', 'at://post/a', 'did:plc:test')).toBe(
      'did:plc:test:reply:at://post/a',
    )
  })

  it('scopes drafts by account', () => {
    const first = draftKeyFor('post', null, 'did:plc:first')
    const second = draftKeyFor('post', null, 'did:plc:second')

    writeDraft(first, 'first account')
    writeDraft(second, 'second account')

    expect(readDraft(first).text).toBe('first account')
    expect(readDraft(second).text).toBe('second account')
    expect(readDraft(draftKeyFor('post', null, 'did:plc:third'))).toEqual({
      text: '',
      revision: null,
      available: true,
    })
  })

  it('returns a fresh lowercase hex revision per write', () => {
    const first = revisionOf(writeDraft('post', 'hello'))
    const second = revisionOf(writeDraft('post', 'hello'))

    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(second).toMatch(/^[0-9a-f]{32}$/)
    expect(first).not.toBe(second)
  })

  it('accepts an empty deletion and reports the deletion revision as null', () => {
    writeDraft('post', 'hello')
    expect(writeDraft('post', '   ')).toEqual({ ok: true, revision: null })
    expect(readDraft('post')).toEqual({ text: '', revision: null, available: true })

    // deleting an entry that is not there has nothing to fail about
    expect(writeDraft('missing', '')).toEqual({ ok: true, revision: null })
  })

  it('clears only the exact revision and text it wrote', () => {
    const revision = revisionOf(writeDraft('post', 'hello'))

    // a mismatched body or revision leaves the newer record alone, and counts
    // as nothing left to clear
    expect(clearDraft('post', revision, 'different text')).toBe(true)
    expect(readDraft('post').text).toBe('hello')

    expect(clearDraft('post', 'f'.repeat(32), 'hello')).toBe(true)
    expect(readDraft('post').text).toBe('hello')

    writeDraft('post', 'newer draft')
    expect(clearDraft('post', revision, 'hello')).toBe(true)
    expect(readDraft('post').text).toBe('newer draft')

    const latest = revisionOf(writeDraft('post', 'newer draft'))
    expect(clearDraft('post', latest, 'newer draft')).toBe(true)
    expect(readDraft('post').text).toBe('')
    // an absent record is already clear
    expect(clearDraft('post', null, 'anything')).toBe(true)
  })

  it('normalizes a legacy draft without a revision to null', () => {
    localStorage.setItem(KEY, JSON.stringify({ post: { text: 'legacy draft', updatedAt: 1 } }))

    expect(readDraft('post')).toEqual({ text: 'legacy draft', revision: null, available: true })
    expect(clearDraft('post', null, 'legacy draft')).toBe(true)
    expect(readDraft('post').text).toBe('')
  })

  it('treats malformed json and a wrong top-level value as an empty map', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readDraft('post')).toEqual({ text: '', revision: null, available: true })
    expect(writeDraft('post', 'fresh')).toEqual({ ok: true, revision: expect.any(String) })
    expect(readDraft('post').text).toBe('fresh')

    localStorage.setItem(KEY, JSON.stringify([{ text: 'nope', updatedAt: 1 }]))
    expect(readDraft('0')).toEqual({ text: '', revision: null, available: true })
    writeDraft('post', 'again')
    expect(readDraft('post').text).toBe('again')
    expect(Array.isArray(stored())).toBe(false)
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
    expect(readDraft('draft-0').text).toBe('')
    expect(readDraft('draft-1').text).toBe('')
    expect(readDraft('draft-3').text).toBe('text-3')
    expect(readDraft('draft-22').text).toBe('text-22')
    expect(kept['null-entry']).toBeUndefined()
    expect(kept['array-entry']).toBeUndefined()
  })

  it('reports an unreadable store instead of inventing an empty map', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(readDraft('post')).toEqual({ text: '', revision: null, available: false })
    expect(writeDraft('post', 'hello')).toEqual({ ok: false })
    expect(clearDraft('post', null, 'hello')).toBe(false)
    // a write must never replace every other account's drafts with an empty map
    expect(setItem).not.toHaveBeenCalled()
  })

  it('reports a write the store rejects and leaves the previous record intact', () => {
    writeDraft('post', 'kept')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(writeDraft('post', 'replacement')).toEqual({ ok: false })
    expect(writeDraft('other', '')).toEqual({ ok: true, revision: null })

    vi.restoreAllMocks()
    expect(readDraft('post').text).toBe('kept')
  })

  it('reports a deletion the store rejects', () => {
    const revision = revisionOf(writeDraft('post', 'hello'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(clearDraft('post', revision, 'hello')).toBe(false)
    vi.restoreAllMocks()
    expect(readDraft('post').text).toBe('hello')
  })
})

describe('purgeRetiredDrafts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('drops signed-out and quote records and keeps everything else', () => {
    const account = 'did:plc:test'
    localStorage.setItem(
      KEY,
      JSON.stringify({
        'signed-out:post': { text: 'old signed-out post', updatedAt: 1 },
        'signed-out:reply:at://post/b': { text: 'old signed-out reply', updatedAt: 2 },
        [`${account}:post`]: { text: 'post', updatedAt: 3 },
        [`${account}:reply:at://post/a`]: { text: 'reply', updatedAt: 4 },
        [`${account}:quote:at://post/a`]: { text: 'quote', updatedAt: 5 },
        'unknown-key': { text: 'unknown', updatedAt: 6 },
      }),
    )
    expect(stored()['signed-out:reply:at://post/b']).toBeDefined()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    purgeRetiredDrafts()

    // the map is rewritten once for the whole purge, not once per removed key
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem.mock.calls[0]?.[0]).toBe(KEY)
    const kept = stored()
    expect(Object.keys(kept).sort()).toEqual(
      [`${account}:post`, `${account}:reply:at://post/a`, 'unknown-key'].sort(),
    )
    expect(kept['signed-out:post']).toBeUndefined()
    expect(kept['signed-out:reply:at://post/b']).toBeUndefined()
    expect(kept[`${account}:quote:at://post/a`]).toBeUndefined()
    expect(readDraft(`${account}:post`).text).toBe('post')
    expect(readDraft(`${account}:reply:at://post/a`).text).toBe('reply')
    expect(readDraft('unknown-key').text).toBe('unknown')
  })

  it('deletes nothing when storage cannot be read', () => {
    const raw = JSON.stringify({ 'signed-out:post': { text: 'kept', updatedAt: 1 } })
    localStorage.setItem(KEY, raw)
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage read denied')
    })

    purgeRetiredDrafts()

    spy.mockRestore()
    expect(localStorage.getItem(KEY)).toBe(raw)
  })

  it('writes nothing when there is nothing retired to remove', () => {
    const account = 'did:plc:test'
    const raw = JSON.stringify({ [`${account}:post`]: { text: 'post', updatedAt: 1 } })
    localStorage.setItem(KEY, raw)
    const spy = vi.spyOn(Storage.prototype, 'setItem')

    purgeRetiredDrafts()

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('drafts across sign-out', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps an account post and reply readable after sign-out', async () => {
    const account = 'did:plc:test'
    const post = draftKeyFor('post', null, account)
    const reply = draftKeyFor('reply', 'at://post/a', account)
    const postRevision = revisionOf(writeDraft(post, 'unfinished post'))
    const replyRevision = revisionOf(writeDraft(reply, 'unfinished reply'))
    const before = localStorage.getItem(KEY)

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await useAuthStore.getState().signOut()
    purgeRetiredDrafts()

    // signing out ends the session, not the compositions: no draft key is
    // rewritten or removed, and both come back by their account-owned keys
    expect(setItem).not.toHaveBeenCalledWith(KEY, expect.anything())
    expect(localStorage.getItem(KEY)).toBe(before)
    expect(readDraft(post)).toEqual({
      text: 'unfinished post',
      revision: postRevision,
      available: true,
    })
    expect(readDraft(reply)).toEqual({
      text: 'unfinished reply',
      revision: replyRevision,
      available: true,
    })
  })
})
