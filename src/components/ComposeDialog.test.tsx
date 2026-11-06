import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router, useLocation, useSearch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { createPost } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { draftKeyFor, readDraft } from '../lib/drafts'
import type { ComposeRequest } from '../lib/ui'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse } from '../test/transport'
import { ComposeDialog } from './ComposeDialog'

vi.mock('../lib/actions', () => ({
  createPost: vi.fn(async () => ({ uri: 'at://post', cid: 'post-cid' })),
}))

function LocationProbe() {
  const [location] = useLocation()
  const search = useSearch()
  return (
    <span data-testid="location">{search.length > 0 ? `${location}?${search}` : location}</span>
  )
}

type RouterHooks = Required<Pick<ComponentProps<typeof Router>, 'hook' | 'searchHook'>>

const OWNER = 'did:plc:owner'

function Harness({ queryClient, hooks }: { queryClient: QueryClient; hooks: RouterHooks }) {
  const compose = useUiStore((state) => state.compose)
  const closeCompose = useUiStore((state) => state.closeCompose)
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={hooks.hook} searchHook={hooks.searchHook}>
        <ComposeDialog open={compose !== null} request={compose} onClose={closeCompose} />
        <LocationProbe />
      </Router>
    </QueryClientProvider>
  )
}

function renderComposer(queryClient = createTestQueryClient()) {
  const memory = memoryLocation({ path: '/thread?uri=at%3A%2F%2Fx', record: true })
  render(<Harness queryClient={queryClient} hooks={memory} />)
  return memory
}

function open(request: ComposeRequest) {
  act(() => {
    useUiStore.setState({ compose: request, dialog: null, inlineCompose: null })
  })
}

function type(value: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } })
}

/** Types at an explicit caret so a mid-token acceptance can be exercised. */
function composerInput(value: string, caret: number): HTMLTextAreaElement {
  const input = screen.getByRole('textbox')
  if (!(input instanceof HTMLTextAreaElement)) throw new Error('missing compose textarea')
  fireEvent.change(input, { target: { value, selectionStart: caret, selectionEnd: caret } })
  return input
}

function composerClientWithActor(query: string, handle: string) {
  const queryClient = createTestQueryClient()
  const key = ['actor-suggestions', query]
  queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY })
  queryClient.setQueryData(key, [
    { did: `did:plc:${handle}`, handle, displayName: '', avatar: null },
  ])
  return queryClient
}

/** Two settled handles so the arrow keys have somewhere to move. */
function composerClientWithActors() {
  const queryClient = createTestQueryClient()
  const key = ['actor-suggestions', 'ad']
  queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY })
  queryClient.setQueryData(key, [
    { did: 'did:plc:ada', handle: 'ada.test', displayName: '', avatar: null },
    { did: 'did:plc:amir', handle: 'amir.test', displayName: '', avatar: null },
  ])
  return queryClient
}

/**
 * A send invalidates every non-feed query, which refetches the still-watched
 * suggestion query, so those cases need a real answer on the wire too.
 */
function stubTypeahead() {
  const transport = installTransport()
  transport.route('GET', 'https://api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead', () =>
    jsonResponse(200, {
      actors: [
        { did: 'did:plc:ada', handle: 'ada.test', displayName: '', avatar: null },
        { did: 'did:plc:amir', handle: 'amir.test', displayName: '', avatar: null },
      ],
    }),
  )
  return transport
}

const MODE_REQUESTS: readonly ComposeRequest[] = [{ mode: 'post', post: null }]

/** Opens a reply whose mention list is already settled with two actors. */
async function openMentionOptions() {
  stubTypeahead()
  renderComposer(composerClientWithActors())
  open({ mode: 'post', post: null })
  const input = composerInput('hi @ad', 6)
  const first = await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })
  expect(input).toHaveAttribute('aria-activedescendant', first.id)
  return { input, first }
}

function awaitingGate() {
  const gate = Promise.withResolvers<{ uri: string; cid: string }>()
  vi.mocked(createPost).mockReturnValueOnce(gate.promise)
  return gate
}

function submit() {
  const form = screen.getByRole('textbox').closest('form')
  if (!(form instanceof HTMLFormElement)) throw new Error('missing compose form')
  fireEvent.submit(form)
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
    deny: () => {
      failing = true
    },
    allow: () => {
      failing = false
    },
  }
}

/** Fails `count` writes, then delegates to real storage; Infinity keeps failing. */
function failWrites(count = Number.POSITIVE_INFINITY) {
  const original = Storage.prototype.setItem
  let remaining = count
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (remaining > 0) {
      remaining -= 1
      throw new Error('storage write denied')
    }
    original.call(this, key, value)
  })
  return {
    allow: () => {
      remaining = 0
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
  useUiStore.setState({ compose: null, inlineCompose: null, dialog: null, openingPost: null })
  useAuthStore.setState({
    status: 'authenticated',
    account: { did: OWNER, handle: 'owner.test' },
    pending: false,
    error: null,
  })
})

describe('ComposeDialog', () => {
  it('sends a post, keeps feed pages and invalidates everything else', async () => {
    const post = postFixture()
    const queryClient = createTestQueryClient()
    const feedKey = ['feed', 'api.bsky.app', 'discover', 'anonymous']
    const threadKey = ['thread', 'api.bsky.app', post.uri]
    // keep the seeded entries alive: the test client otherwise collects
    // unobserved queries immediately
    queryClient.setQueryDefaults(feedKey, { gcTime: Number.POSITIVE_INFINITY })
    queryClient.setQueryDefaults(threadKey, { gcTime: Number.POSITIVE_INFINITY })
    queryClient.setQueryData(feedKey, { pages: [] })
    queryClient.setQueryData(threadKey, { posts: [] })

    const memory = renderComposer(queryClient)
    open({ mode: 'post', post: null })
    type('hello')
    submit()

    await waitFor(() => expect(createPost).toHaveBeenCalledWith('hello'))
    await waitFor(() => expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(true))
    expect(queryClient.getQueryState(feedKey)?.isInvalidated).toBe(false)
    expect(screen.getByTestId('location')).toHaveTextContent('/thread?uri=at%3A%2F%2Fx')
    expect(memory.history).toEqual(['/thread?uri=at%3A%2F%2Fx'])
  })

  it('sends with ctrl+enter', async () => {
    renderComposer()
    open({ mode: 'post', post: null })
    type('sent fast')

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(createPost).toHaveBeenCalledWith('sent fast'))
    expect(useUiStore.getState().compose).toBeNull()
  })

  it('restores the draft when the same target comes back', () => {
    renderComposer()

    open({ mode: 'post', post: null })
    type('first composition')
    open({ mode: 'post', post: null })

    expect(screen.getByRole('textbox')).toHaveValue('first composition')
  })

  it('leaves a reopened draft alone when a dismissed identical send resolves', async () => {
    const key = draftKeyFor('post', null, OWNER)
    const gate = Promise.withResolvers<{ uri: string; cid: string }>()
    vi.mocked(createPost).mockReturnValueOnce(gate.promise)

    renderComposer()
    open({ mode: 'post', post: null })
    type('same text')
    submit()

    fireEvent.click(screen.getByText('cancel'))
    expect(useUiStore.getState().compose).toBeNull()
    const dismissed = readDraft(key)
    expect(dismissed.available).toBe(true)
    expect(dismissed.text).toBe('same text')
    expect(dismissed.revision).not.toBeNull()

    open({ mode: 'post', post: null })
    expect(screen.getByRole('textbox')).toHaveValue('same text')
    // claiming a fresh revision on open is what protects the reopened draft
    const reopened = readDraft(key)
    expect(reopened.text).toBe('same text')
    expect(reopened.revision).not.toBeNull()
    expect(reopened.revision).not.toBe(dismissed.revision)

    await act(async () => {
      gate.resolve({ uri: 'at://post', cid: 'post-cid' })
    })

    // the late send still owns only the pair it saved, never this newer revision
    expect(readDraft(key)).toEqual({
      text: 'same text',
      revision: reopened.revision,
      available: true,
    })
    expect(screen.getByRole('textbox')).toHaveValue('same text')
  })

  it('keeps the draft and shows the failure when a send is rejected', async () => {
    const key = draftKeyFor('post', null, OWNER)
    vi.mocked(createPost).mockRejectedValueOnce(new Error('pds said no'))

    renderComposer()
    open({ mode: 'post', post: null })
    type('keep me')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('pds said no')
    expect(useUiStore.getState().compose).not.toBeNull()
    expect(readDraft(key).text).toBe('keep me')
  })

  it('clears a differently worded autosave after a failed flush and a successful send', async () => {
    const key = draftKeyFor('post', null, OWNER)
    renderComposer()
    open({ mode: 'post', post: null })

    type('old text')
    await waitFor(() => expect(readDraft(key).text).toBe('old text'))
    const stored = readDraft(key)

    const writes = failWrites()
    type('new text')
    await settleAutosave()
    // the failed save kept the older record instead of deleting or rewriting it
    expect(readDraft(key)).toEqual(stored)

    const gate = awaitingGate()
    submit()
    await waitFor(() => expect(createPost).toHaveBeenCalledWith('new text'))

    writes.allow()
    await act(async () => {
      gate.resolve({ uri: 'at://post', cid: 'post-cid' })
    })

    await waitFor(() => expect(useUiStore.getState().compose).toBeNull())
    expect(readDraft(key)).toEqual({ text: '', revision: null, available: true })
  })

  it('clears the original read snapshot when the claim and the final flush both fail', async () => {
    const key = draftKeyFor('post', null, OWNER)
    localStorage.setItem(
      'benday:drafts',
      JSON.stringify({ [key]: { text: 'seeded draft', updatedAt: 1, revision: 'known-revision' } }),
    )
    const writes = failWrites(2)

    renderComposer()
    open({ mode: 'post', post: null })

    expect(screen.getByRole('textbox')).toHaveValue('seeded draft')
    expect(screen.getByText(STORAGE_WARNING)).toHaveAttribute('role', 'status')

    const gate = awaitingGate()
    type('submitted text')
    submit()
    await waitFor(() => expect(createPost).toHaveBeenCalledWith('submitted text'))
    // no write was accepted, so the original record is still what cleanup owns
    expect(readDraft(key).text).toBe('seeded draft')

    writes.allow()
    await act(async () => {
      gate.resolve({ uri: 'at://post', cid: 'post-cid' })
    })

    await waitFor(() => expect(useUiStore.getState().compose).toBeNull())
    expect(readDraft(key)).toEqual({ text: '', revision: null, available: true })
  })

  it('warns while storage is unreadable, then clears the warning after a later save', async () => {
    const key = draftKeyFor('post', null, OWNER)
    const reads = stubStorageReads()
    renderComposer()
    open({ mode: 'post', post: null })

    const warning = screen.getByText(STORAGE_WARNING)
    expect(warning).toHaveAttribute('role', 'status')
    const input = screen.getByRole('textbox')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(warning.id)

    type('held copy')
    await settleAutosave()
    expect(useUiStore.getState().compose).not.toBeNull()
    expect(screen.getByText(STORAGE_WARNING)).toBeInTheDocument()

    reads.allow()
    type('held copy and more')
    await waitFor(() => expect(screen.queryByText(STORAGE_WARNING)).toBeNull())
    expect(readDraft(key).text).toBe('held copy and more')

    // storage failed again before closing; closing stays allowed regardless
    reads.deny()
    fireEvent.click(screen.getByText('cancel'))
    expect(useUiStore.getState().compose).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps a sent composition open without a second post when cleanup fails', async () => {
    const key = draftKeyFor('post', null, OWNER)
    renderComposer()
    open({ mode: 'post', post: null })

    type('outbox')
    await waitFor(() => expect(readDraft(key).text).toBe('outbox'))
    const stored = readDraft(key)

    failWrites()
    submit()
    const warning = await screen.findByText(SENT_WARNING)
    expect(warning).toHaveAttribute('role', 'status')
    expect(useUiStore.getState().compose).not.toBeNull()

    const input = screen.getByRole<HTMLTextAreaElement>('textbox')
    expect(input.readOnly).toBe(true)
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(warning.id)
    expect(screen.getByRole('button', { name: 'sent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'post' })).toBeNull()

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await act(async () => undefined)
    expect(createPost).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(useUiStore.getState().compose).toBeNull()
    await act(async () => undefined)
    // closing a submitted composition never autosaves it again
    expect(createPost).toHaveBeenCalledTimes(1)
    expect(readDraft(key)).toEqual(stored)
  })

  it('counts graphemes for the submission boundary', async () => {
    renderComposer()
    open({ mode: 'post', post: null })
    const send = screen.getAllByRole('button').find((button) => button.textContent === 'post')
    if (send === undefined) throw new Error('missing send button')

    type('a'.repeat(301))
    expect(send).toBeDisabled()
    submit()
    expect(createPost).not.toHaveBeenCalled()

    type('👩‍👩‍👧‍👦'.repeat(50))
    expect(send).toBeEnabled()

    type('a'.repeat(300))
    expect(send).toBeEnabled()
  })

  it('accepts a suggestion with a trailing space at the caret', async () => {
    renderComposer()
    open({ mode: 'post', post: null })

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'hi @ad' } })

    const options = await screen.findAllByRole('option', undefined, { timeout: 2000 })
    fireEvent.click(options[0] as HTMLElement)

    expect(screen.getByRole('textbox')).toHaveValue('hi @ad ')
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hi @ad more' },
    })
    expect(screen.getByRole('textbox')).toHaveValue('hi @ad more')
  })

  it('accepts a mention before existing text without merging or doubling the separator', async () => {
    renderComposer(composerClientWithActor('ad', 'ada.test'))
    open({ mode: 'post', post: null })

    const input = composerInput('hi @ad there', 6)
    const option = await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })
    fireEvent.click(option)

    expect(input).toHaveValue('hi @ada.test there')
    await waitFor(() => expect(input.selectionStart).toBe(13))

    const caret = input.selectionStart ?? 0
    const typed = 'fresh '
    fireEvent.change(input, {
      target: {
        value: `${input.value.slice(0, caret)}${typed}${input.value.slice(caret)}`,
        selectionStart: caret + typed.length,
        selectionEnd: caret + typed.length,
      },
    })

    expect(input).toHaveValue('hi @ada.test fresh there')
  })

  it('keeps a comma after the accepted mention and never adds a space', async () => {
    renderComposer(composerClientWithActor('ad', 'ada.test'))
    open({ mode: 'post', post: null })

    const input = composerInput('hi @ad, there', 6)
    const option = await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })
    fireEvent.click(option)

    expect(input).toHaveValue('hi @ada.test, there')
    await waitFor(() => expect(input.selectionStart).toBe(12))
    expect(input.value.charAt(input.selectionStart)).toBe(',')
  })

  it('treats a trailing dot as punctuation instead of part of the handle', async () => {
    renderComposer(composerClientWithActor('ad', 'ada.test'))
    open({ mode: 'post', post: null })

    const input = composerInput('hi @ad.', 7)
    const option = await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })
    fireEvent.click(option)

    expect(input).toHaveValue('hi @ada.test.')
    await waitFor(() => expect(input.selectionStart).toBe(12))
    expect(input.value.charAt(input.selectionStart)).toBe('.')
  })

  it('keeps a typed hashtag literal and opens no suggestion list', async () => {
    renderComposer()
    open({ mode: 'post', post: null })

    const input = composerInput('look #tag.', 10)
    await act(async () => {
      await Promise.resolve()
    })

    expect(input).toHaveValue('look #tag.')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders the shared composer head and actions', () => {
    renderComposer()
    open({ mode: 'post', post: null })

    const dialog = screen.getByRole('dialog')
    const head = dialog.querySelector('.b-dialog__head')
    expect(head?.querySelector('.b-dialog__title')).toHaveTextContent('compose')
    expect(head?.querySelector('.b-dialog__close')).toHaveAttribute('aria-label', 'close compose')

    const actions = dialog.querySelector('.b-dialog__foot > .b-compose__actions')
    expect(actions).not.toBeNull()
    expect(actions?.querySelector('.b-compose__count')).toHaveTextContent('0/300')
    expect(actions).toContainElement(screen.getByRole('button', { name: 'cancel' }))
    expect(actions).toContainElement(screen.getByRole('button', { name: 'post' }))
  })

  it('counts graphemes and gates sending from the shared footer', () => {
    renderComposer()
    open({ mode: 'post', post: null })
    const send = screen.getByRole('button', { name: 'post' })
    expect(screen.getByText('0/300')).toHaveAttribute('data-over', 'false')

    type('a'.repeat(301))
    expect(screen.getByText('301/300')).toHaveAttribute('data-over', 'true')
    expect(send).toBeDisabled()

    type('a'.repeat(300))
    expect(send).toBeEnabled()
  })

  it.each(MODE_REQUESTS)('exposes a native $mode textbox as compose $mode', ({ mode, post }) => {
    renderComposer()
    open({ mode, post })

    const input = screen.getByRole('textbox', { name: `compose ${mode}` })
    expect(input.tagName).toBe('TEXTAREA')
    // a textarea is its own textbox: no combobox override and no expanded state
    expect(input).not.toHaveAttribute('role')
    expect(input).not.toHaveAttribute('aria-expanded')
    expect(input).toHaveAttribute('aria-haspopup', 'listbox')
    // neither popup reference may exist before a real option does
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('names the suggestion listbox and active option only while options exist', async () => {
    renderComposer(composerClientWithActors())
    open({ mode: 'post', post: null })

    const input = composerInput('hi @ad', 6)
    const option = await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })
    const list = screen.getByRole('listbox', { name: 'suggestions' })

    expect(input).toHaveAttribute('aria-controls', list.id)
    expect(input).toHaveAttribute('aria-activedescendant', option.id)
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    type('hi there')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('steps from the highlighted row after the list shrinks', async () => {
    const queryClient = createTestQueryClient()
    const actors = (handles: string[]) =>
      handles.map((handle) => ({
        did: `did:plc:${handle}`,
        handle,
        displayName: '',
        avatar: null,
      }))
    const key = ['actor-suggestions', 'a']
    queryClient.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY })
    queryClient.setQueryData(key, actors(['a1.test', 'a2.test', 'a3.test', 'a4.test', 'a5.test']))
    renderComposer(queryClient)
    open({ mode: 'post', post: null })

    const input = composerInput('hi @a', 5)
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(5))
    for (let press = 0; press < 4; press += 1) {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    }
    expect(screen.getAllByRole('option')[4]).toHaveAttribute('aria-selected', 'true')

    // the settled list shrinks under the same token: the reader now sees the
    // clamped last row, and an arrow must step from where the highlight is
    act(() => {
      queryClient.setQueryData(key, actors(['a1.test', 'a2.test', 'a3.test']))
    })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('hi @a2.test ')
  })

  it('leaves shifted and modified accept and send keys native while options are open', async () => {
    const { input, first } = await openMentionOptions()

    const attempts: Array<[string, KeyboardEventInit]> = [
      ['Tab', { shiftKey: true }],
      ['Enter', { shiftKey: true }],
      ['Tab', { ctrlKey: true }],
      ['ArrowDown', { ctrlKey: true }],
      ['ArrowUp', { ctrlKey: true }],
      ['Enter', { ctrlKey: true, shiftKey: true }],
    ]
    for (const [key, init] of attempts) {
      // true means the event was not cancelled, so the browser still owns it
      expect(fireEvent.keyDown(input, { key, ...init })).toBe(true)
      expect(input).toHaveValue('hi @ad')
      expect(input).toHaveAttribute('aria-activedescendant', first.id)
    }
    expect(createPost).not.toHaveBeenCalled()
  })

  it('moves and accepts only on the bare arrow, enter and tab chords', async () => {
    const { input, first } = await openMentionOptions()

    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false)
    const second = screen.getAllByRole('option')[1] as HTMLElement
    expect(input).toHaveAttribute('aria-activedescendant', second.id)

    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(false)
    expect(input).toHaveAttribute('aria-activedescendant', first.id)

    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
    expect(input).toHaveValue('hi @ada.test ')
    expect(screen.queryByRole('option')).toBeNull()

    // the list reopens for the next token and Tab accepts just as well
    composerInput('again @ad', 9)
    await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false)
    expect(input).toHaveValue('again @ada.test ')
  })

  it('sends once on the exact send chord while the suggestion list is open', async () => {
    const { input } = await openMentionOptions()

    expect(fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })).toBe(false)

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(createPost).toHaveBeenCalledWith('hi @ad')
    // the chord sends the draft instead of accepting the highlighted handle
    expect(input).not.toHaveValue('hi @ada.test ')
  })

  it('keeps a keyboard send focused read-only and suggestion-free until it settles', async () => {
    stubTypeahead()
    const gate = awaitingGate()
    renderComposer(composerClientWithActors())
    open({ mode: 'post', post: null })

    const input = composerInput('hi @ad', 6)
    await screen.findByRole('option', { name: '@ada.test' }, { timeout: 2000 })

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(input.readOnly).toBe(true))

    expect(input).not.toBeDisabled()
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'post' })).toBeDisabled()
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toHaveLength(1)
    expect(document.getElementById(describedBy[0] ?? '')).toHaveTextContent('/300')

    await act(async () => {
      gate.resolve({ uri: 'at://post', cid: 'post-cid' })
    })
    await waitFor(() => expect(useUiStore.getState().compose).toBeNull())
  })

  it('keeps the editor focused when the pending send starts from the button', async () => {
    const gate = awaitingGate()
    renderComposer()
    open({ mode: 'post', post: null })

    type('hello')
    const input = screen.getByRole('textbox')
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('missing compose textarea')
    fireEvent.click(screen.getByRole('button', { name: 'post' }))

    await waitFor(() => expect(input.readOnly).toBe(true))
    expect(document.activeElement).toBe(input)
    expect(input).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'post' })).toBeDisabled()

    await act(async () => {
      gate.resolve({ uri: 'at://post', cid: 'post-cid' })
    })
    await waitFor(() => expect(useUiStore.getState().compose).toBeNull())
  })

  it('associates the count and the submission error with the editor', async () => {
    vi.mocked(createPost).mockRejectedValueOnce(new Error('pds said no'))
    renderComposer()
    open({ mode: 'post', post: null })

    type('keep me')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('pds said no')
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-invalid', 'true')

    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toHaveLength(2)
    expect(document.getElementById(describedBy[0] ?? '')).toHaveTextContent('/300')
    expect(document.getElementById(describedBy[1] ?? '')).toHaveTextContent('pds said no')
  })

  it('marks the editor invalid and announces the limit crossing once', async () => {
    renderComposer()
    open({ mode: 'post', post: null })

    const input = screen.getByRole('textbox')
    const status = screen.getByRole('status')
    const records: MutationRecord[] = []
    const observer = new MutationObserver((batch) => records.push(...batch))
    observer.observe(status, { subtree: true, childList: true, characterData: true })

    type('a'.repeat(301))
    await waitFor(() => expect(status).toHaveTextContent('over the 300 grapheme limit'))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(records).toHaveLength(1)

    // further over-limit keystrokes change the counter, not the live status
    type('a'.repeat(302))
    type('a'.repeat(303))
    await act(async () => undefined)
    expect(records).toHaveLength(1)
    expect(status).toHaveTextContent('over the 300 grapheme limit')

    type('a'.repeat(5))
    await waitFor(() => expect(status).toHaveTextContent('within the 300 grapheme limit'))
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(records).toHaveLength(2)

    observer.disconnect()
  })
})
