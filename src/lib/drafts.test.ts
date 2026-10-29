import { beforeEach, describe, expect, it } from 'vitest'
import { clearDraft, draftKeyFor, readDraft, writeDraft } from './drafts'

describe('drafts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps separate drafts for post reply and quote', () => {
    const post = draftKeyFor('post', null)
    const reply = draftKeyFor('reply', 'at://post/a')
    const quote = draftKeyFor('quote', 'at://post/a')

    writeDraft(post, 'a post')
    writeDraft(reply, 'a reply')
    writeDraft(quote, 'a quote')

    expect(readDraft(post)).toBe('a post')
    expect(readDraft(reply)).toBe('a reply')
    expect(readDraft(quote)).toBe('a quote')
  })

  it('removes empty drafts and clears on demand', () => {
    writeDraft('post', 'hello')
    expect(readDraft('post')).toBe('hello')
    writeDraft('post', '   ')
    expect(readDraft('post')).toBe('')
    writeDraft('post', 'again')
    clearDraft('post')
    expect(readDraft('post')).toBe('')
  })

  it('caps stored drafts at twenty entries', () => {
    for (let index = 0; index < 25; index += 1) {
      writeDraft(`draft-${index}`, `text-${index}`)
    }

    expect(readDraft('draft-0')).toBe('')
    expect(readDraft('draft-24')).toBe('text-24')
  })
})
