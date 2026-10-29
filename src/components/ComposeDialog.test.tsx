import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { createReply } from '../lib/actions'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { ComposeDialog } from './ComposeDialog'

vi.mock('../lib/actions', () => ({
  createPost: vi.fn(),
  createReply: vi.fn(async () => ({ uri: 'at://reply', cid: 'reply-cid' })),
  createQuote: vi.fn(),
  likePost: vi.fn(),
  unlikePost: vi.fn(),
  repostPost: vi.fn(),
  unrepostPost: vi.fn(),
  fetchViewerStates: vi.fn(),
}))

describe('ComposeDialog', () => {
  it('submits a reply and navigates to the new post', async () => {
    useUiStore.setState({ dialog: null, compose: null })
    const post = postFixture()
    const location = memoryLocation({ path: '/', record: true })
    const onClose = vi.fn()

    render(
      <Router hook={location.hook}>
        <ComposeDialog open request={{ mode: 'reply', post }} onClose={onClose} />
      </Router>,
    )

    const input = screen.getByLabelText('compose post')
    fireEvent.change(input, { target: { value: 'hello' } })
    const form = input.closest('form')
    if (!(form instanceof HTMLFormElement)) throw new Error('missing compose form')
    fireEvent.submit(form)

    await vi.waitFor(() => {
      expect(createReply).toHaveBeenCalledWith('hello', post)
    })
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(location.history.at(-1)).toBe('/thread?uri=at%3A%2F%2Freply')
  })
})
