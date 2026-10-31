import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQuote, createReply } from '../lib/actions'
import { draftKeyFor, readDraft } from '../lib/drafts'
import type { ComposeRequest } from '../lib/ui'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse } from '../test/transport'
import { ComposeDialog } from './ComposeDialog'
import { InlineComposer } from './InlineComposer'

vi.mock('../lib/actions', () => ({
  createPost: vi.fn(async () => ({ uri: 'at://post', cid: 'post-cid' })),
  createReply: vi.fn(async () => ({ uri: 'at://reply', cid: 'reply-cid' })),
  createQuote: vi.fn(async () => ({ uri: 'at://quote', cid: 'quote-cid' })),
}))

const MODES = ['reply', 'quote'] as const
// the dock is only opened for replies and quotes, but the field name derives
// from the request mode, so every mode has to name its editor the same way
const ALL_MODES = ['post', 'reply', 'quote'] as const

function dockClientWithActor() {
  const queryClient = createTestQueryClient()
  const key = ['actor-suggestions', 'https://api.bsky.app', 'ad']
  queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY })
  queryClient.setQueryData(key, [
    { did: 'did:plc:ada', handle: 'ada.test', displayName: '', avatar: null },
  ])
  return queryClient
}

function awaitingQuoteGate() {
  const gate = Promise.withResolvers<{ uri: string; cid: string }>()
  vi.mocked(createQuote).mockReturnValueOnce(gate.promise)
  return gate
}

/** A send invalidates the still-watched suggestion query, which refetches. */
function stubTypeahead() {
  const transport = installTransport()
  transport.route('GET', 'https://api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead', () =>
    jsonResponse(200, {
      actors: [{ did: 'did:plc:ada', handle: 'ada.test', displayName: '', avatar: null }],
    }),
  )
  return transport
}

function renderDock(
  request: ComposeRequest,
  options: { client?: QueryClient; onClose?: () => void } = {},
) {
  const client = options.client ?? createTestQueryClient()
  const onClose = options.onClose ?? vi.fn()
  // the dock only exists while its request owns the store slot, and a
  // completion may only report back to an owner that still holds it
  useUiStore.setState({ inlineCompose: request })
  const view = render(
    <QueryClientProvider client={client}>
      <InlineComposer request={request} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { client, onClose, view }
}

function composeForm(): HTMLFormElement {
  const form = screen.getByRole('textbox').closest('form')
  if (!(form instanceof HTMLFormElement)) throw new Error('missing compose form')
  return form
}

beforeEach(() => {
  useUiStore.setState({ compose: null, inlineCompose: null, dialog: null })
})

describe('InlineComposer', () => {
  it('flushes the typed text under its own target when the dock switches', () => {
    const first = postFixture()
    const second = postFixture({ uri: 'at://did:plc:test/app.bsky.feed.post/2', cid: 'cid-2' })

    const { client, view } = renderDock({ mode: 'reply', post: first })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'for the first' } })

    useUiStore.setState({ inlineCompose: { mode: 'reply', post: second } })
    view.rerender(
      <QueryClientProvider client={client}>
        <InlineComposer request={{ mode: 'reply', post: second }} onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(readDraft(draftKeyFor('reply', first.uri, null))).toBe('for the first')
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('flushes on unmount before the autosave delay', () => {
    const post = postFixture()
    const { view } = renderDock({ mode: 'quote', post })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished' } })

    view.unmount()

    expect(readDraft(draftKeyFor('quote', post.uri, null))).toBe('unfinished')
  })

  it('wears the shared composer head and actions', () => {
    renderDock({ mode: 'reply', post: postFixture() })
    const dock = screen.getByLabelText('reply composer')

    const head = dock.querySelector('.b-dialog__head')
    expect(head).not.toBeNull()
    expect(head?.querySelector('.b-dialog__title')).toHaveTextContent('reply')
    expect(head?.querySelector('.b-compose__hint')).toHaveTextContent('ctrl/cmd enter send')
    expect(screen.getByLabelText('close reply').closest('.b-dialog__head')).toBe(head)

    const actions = dock.querySelector('.b-compose__actions')
    expect(actions).not.toBeNull()
    expect(actions?.querySelector('.b-compose__count')).toHaveTextContent('0/300')
    expect(actions).toContainElement(screen.getByRole('button', { name: 'cancel' }))
    expect(actions).toContainElement(screen.getByRole('button', { name: 'reply' }))
  })

  it('renders the same head and actions chrome as the modal composer', () => {
    const post = postFixture()
    const request: ComposeRequest = { mode: 'reply', post }
    const { client } = renderDock(request)

    useUiStore.setState({ compose: request })
    const modal = render(
      <QueryClientProvider client={client}>
        <ComposeDialog open request={request} onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    const dock = screen.getByLabelText('reply composer')
    const dialog = modal.container.querySelector('dialog')
    if (dialog === null) throw new Error('missing modal composer')

    for (const root of [dock, dialog]) {
      expect(root.querySelector('.b-dialog__head')).not.toBeNull()
      expect(root.querySelector('.b-compose__actions')).not.toBeNull()
    }
    for (const selector of [
      '.b-dialog__head',
      '.b-dialog__title',
      '.b-dialog__close',
      '.b-compose__actions',
      '.b-compose__count',
    ]) {
      expect(dock.querySelector(selector)?.className).toBe(
        dialog.querySelector(selector)?.className,
      )
    }
  })

  it.each(MODES)('counts graphemes and sends a %s dock', async (mode) => {
    const post = postFixture()
    renderDock({ mode, post })
    const input = screen.getByRole('textbox')
    const send = screen.getByRole('button', { name: mode })
    // a reply needs text; a quote may go out with just the quoted post
    if (mode === 'reply') expect(send).toBeDisabled()

    fireEvent.change(input, { target: { value: 'a'.repeat(301) } })
    expect(screen.getByText('301/300')).toHaveAttribute('data-over', 'true')
    expect(send).toBeDisabled()

    fireEvent.change(input, { target: { value: 'hello' } })
    expect(screen.getByText('5/300')).toHaveAttribute('data-over', 'false')
    expect(send).toBeEnabled()

    fireEvent.submit(composeForm())

    const sendAction = mode === 'reply' ? createReply : createQuote
    await waitFor(() => expect(sendAction).toHaveBeenCalledWith('hello', post))
  })

  it.each(MODES)('closes a %s dock from the keyboard and from the shared head', (mode) => {
    const { onClose } = renderDock({ mode, post: postFixture() })

    fireEvent.keyDown(screen.getByLabelText(`${mode} composer`), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText(`close ${mode}`))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps the draft and shows the failure when a dock send is rejected', async () => {
    const post = postFixture()
    const key = draftKeyFor('quote', post.uri, null)
    vi.mocked(createQuote).mockRejectedValueOnce(new Error('pds said no'))

    const { onClose } = renderDock({ mode: 'quote', post })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep me' } })
    fireEvent.submit(composeForm())

    expect(await screen.findByRole('alert')).toHaveTextContent('pds said no')
    expect(onClose).not.toHaveBeenCalled()
    expect(readDraft(key)).toBe('keep me')
  })

  it.each(ALL_MODES)('exposes a native %s dock textbox', (mode) => {
    renderDock({ mode, post: postFixture() })

    const input = screen.getByRole('textbox', { name: `compose ${mode}` })
    expect(input.tagName).toBe('TEXTAREA')
    expect(input).not.toHaveAttribute('role')
    expect(input).not.toHaveAttribute('aria-expanded')
    expect(input).toHaveAttribute('aria-haspopup', 'listbox')
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('keeps a pending dock send focused read-only and suggestion-free', async () => {
    stubTypeahead()
    const gate = awaitingQuoteGate()
    const request: ComposeRequest = { mode: 'quote', post: postFixture() }
    const { onClose } = renderDock(request, { client: dockClientWithActor() })

    const input = screen.getByRole('textbox')
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('missing dock textarea')
    fireEvent.change(input, {
      target: { value: 'hi @ad', selectionStart: 6, selectionEnd: 6 },
    })
    await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(input.readOnly).toBe(true))

    expect(input).not.toBeDisabled()
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'quote' })).toBeDisabled()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')

    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toHaveLength(1)
    expect(document.getElementById(describedBy[0] ?? '')).toHaveTextContent('/300')

    await act(async () => {
      gate.resolve({ uri: 'at://quote', cid: 'quote-cid' })
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('leaves an Escape that an IME is composing to the IME', () => {
    const { onClose } = renderDock({ mode: 'reply', post: postFixture() })
    const dock = screen.getByLabelText('reply composer')

    fireEvent.keyDown(dock, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(dock, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
