import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReply } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
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
}))

const OWNER = 'did:plc:owner'

function dockClientWithActor() {
  const queryClient = createTestQueryClient()
  const key = ['actor-suggestions', 'ad']
  queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY })
  queryClient.setQueryData(key, [
    { did: 'did:plc:ada', handle: 'ada.test', displayName: '', avatar: null },
  ])
  return queryClient
}

function awaitingReplyGate() {
  const gate = Promise.withResolvers<{ uri: string; cid: string }>()
  vi.mocked(createReply).mockReturnValueOnce(gate.promise)
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

const STORAGE_WARNING = 'draft storage unavailable · keep a copy before closing'
const SENT_WARNING = 'post sent · stored draft could not be cleared'

/** Fails storage reads while the switch says so, delegating to real storage otherwise. */
function stubStorageReads() {
  const original = Storage.prototype.getItem
  let failing = true
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (failing) throw new Error('storage read denied')
    return original.call(this, key)
  })
  return {
    allow: () => {
      failing = false
    },
  }
}

/** Fails every write until the switch allows real storage again. */
function failWrites() {
  const original = Storage.prototype.setItem
  let failing = true
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (failing) throw new Error('storage write denied')
    original.call(this, key, value)
  })
  return {
    allow: () => {
      failing = false
    },
  }
}

/** Lets the autosave delay elapse, including the write it attempts. */
async function settleAutosave() {
  const elapsed = Promise.withResolvers<void>()
  setTimeout(elapsed.resolve, 300)
  await act(async () => {
    await elapsed.promise
  })
}

beforeEach(() => {
  useUiStore.setState({ compose: null, inlineCompose: null, dialog: null })
  useAuthStore.setState({
    status: 'authenticated',
    account: { did: OWNER, handle: 'owner.test' },
    pending: false,
    error: null,
  })
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

    expect(readDraft(draftKeyFor('reply', first.uri, OWNER)).text).toBe('for the first')
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('flushes on unmount before the autosave delay', () => {
    const post = postFixture()
    const { view } = renderDock({ mode: 'reply', post })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished' } })

    view.unmount()

    expect(readDraft(draftKeyFor('reply', post.uri, OWNER)).text).toBe('unfinished')
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

    // the modal is the standalone post composer; replies belong to the dock
    const modalRequest: ComposeRequest = { mode: 'post', post: null }
    useUiStore.setState({ compose: modalRequest })
    const modal = render(
      <QueryClientProvider client={client}>
        <ComposeDialog open request={modalRequest} onClose={vi.fn()} />
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

  it('counts graphemes and sends a reply dock', async () => {
    const post = postFixture()
    renderDock({ mode: 'reply', post })
    const input = screen.getByRole('textbox')
    const send = screen.getByRole('button', { name: 'reply' })
    expect(send).toBeDisabled()

    fireEvent.change(input, { target: { value: 'a'.repeat(301) } })
    expect(screen.getByText('301/300')).toHaveAttribute('data-over', 'true')
    expect(send).toBeDisabled()

    fireEvent.change(input, { target: { value: 'hello' } })
    expect(screen.getByText('5/300')).toHaveAttribute('data-over', 'false')
    expect(send).toBeEnabled()

    fireEvent.submit(composeForm())
    await waitFor(() => expect(createReply).toHaveBeenCalledWith('hello', post))
  })

  it('closes a reply dock from the keyboard and from the shared head', () => {
    const { onClose } = renderDock({ mode: 'reply', post: postFixture() })

    fireEvent.keyDown(screen.getByLabelText('reply composer'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('close reply'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps the draft and shows the failure when a dock send is rejected', async () => {
    const post = postFixture()
    const key = draftKeyFor('reply', post.uri, OWNER)
    vi.mocked(createReply).mockRejectedValueOnce(new Error('pds said no'))

    const { onClose } = renderDock({ mode: 'reply', post })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep me' } })
    fireEvent.submit(composeForm())

    expect(await screen.findByRole('alert')).toHaveTextContent('pds said no')
    expect(onClose).not.toHaveBeenCalled()
    expect(readDraft(key).text).toBe('keep me')
  })

  it('exposes a native reply dock textbox', () => {
    renderDock({ mode: 'reply', post: postFixture() })

    const input = screen.getByRole('textbox', { name: 'compose reply' })
    expect(input.tagName).toBe('TEXTAREA')
    expect(input).not.toHaveAttribute('role')
    expect(input).not.toHaveAttribute('aria-expanded')
    expect(input).toHaveAttribute('aria-haspopup', 'listbox')
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('keeps a pending dock send focused read-only and suggestion-free', async () => {
    stubTypeahead()
    const gate = awaitingReplyGate()
    const request: ComposeRequest = { mode: 'reply', post: postFixture() }
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
    expect(screen.getByRole('button', { name: 'reply' })).toBeDisabled()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')

    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toHaveLength(1)
    expect(document.getElementById(describedBy[0] ?? '')).toHaveTextContent('/300')

    await act(async () => {
      gate.resolve({ uri: 'at://reply', cid: 'reply-cid' })
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

  it('warns while dock storage is unreadable and clears it after a later save', async () => {
    const post = postFixture()
    const key = draftKeyFor('reply', post.uri, OWNER)
    const reads = stubStorageReads()
    const { onClose } = renderDock({ mode: 'reply', post })

    const input = screen.getByRole('textbox')
    const warning = screen.getByText(STORAGE_WARNING)
    expect(warning).toHaveAttribute('role', 'status')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(warning.id)

    fireEvent.change(input, { target: { value: 'held copy' } })
    await settleAutosave()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(STORAGE_WARNING)).toBeInTheDocument()

    reads.allow()
    fireEvent.change(input, { target: { value: 'held copy and more' } })
    await waitFor(() => expect(screen.queryByText(STORAGE_WARNING)).toBeNull())
    expect(readDraft(key).text).toBe('held copy and more')
  })

  it('keeps a sent dock open without a second reply when cleanup fails', async () => {
    const post = postFixture()
    const key = draftKeyFor('reply', post.uri, OWNER)
    const { onClose } = renderDock({ mode: 'reply', post })
    const input = screen.getByRole('textbox')
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('missing dock textarea')

    fireEvent.change(input, { target: { value: 'outbox' } })
    await waitFor(() => expect(readDraft(key).text).toBe('outbox'))
    const stored = readDraft(key)

    failWrites()
    fireEvent.submit(composeForm())

    const warning = await screen.findByText(SENT_WARNING)
    expect(warning).toHaveAttribute('role', 'status')
    expect(onClose).not.toHaveBeenCalled()
    expect(input.readOnly).toBe(true)
    expect(screen.getByRole('button', { name: 'sent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await act(async () => undefined)
    expect(createReply).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => undefined)
    // closing a submitted dock never autosaves it again
    expect(createReply).toHaveBeenCalledTimes(1)
    expect(readDraft(key)).toEqual(stored)
  })
})
