import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createReply } from '../lib/actions'
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
  it('submits a reply and refreshes without opening an unindexed thread', async () => {
    const post = postFixture()
    const onClose = vi.fn()
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <ComposeDialog open request={{ mode: 'reply', post }} onClose={onClose} />
      </QueryClientProvider>,
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
    expect(invalidate).toHaveBeenCalled()
  })

  it('sends with ctrl+enter', async () => {
    const post = postFixture()
    const onClose = vi.fn()
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ComposeDialog open request={{ mode: 'reply', post }} onClose={onClose} />
      </QueryClientProvider>,
    )

    const input = screen.getByLabelText('compose post')
    fireEvent.change(input, { target: { value: 'sent fast' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    await vi.waitFor(() => {
      expect(createReply).toHaveBeenCalledWith('sent fast', post)
    })
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })
})
