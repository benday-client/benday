import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, type RenderResult, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useHotkeys } from '../hooks/useHotkeys'
import { APPVIEW_PRESETS, DEFAULT_APPVIEW, toAppViewTarget } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
import { createTestQueryClient } from '../test/queryClient'
import {
  installTransport,
  jsonResponse,
  type RouteRequest,
  type TestTransport,
} from '../test/transport'
import SearchView from './SearchView'

const APPVIEW = 'https://api.bsky.app'
const PDS = 'https://pds.test'
const SEARCH_POSTS = '/xrpc/app.bsky.feed.searchPosts'
const SEARCH_ACTORS = '/xrpc/app.bsky.actor.searchActors'
const SEARCH_FEEDS = '/xrpc/app.bsky.unspecced.getPopularFeedGenerators'
// lexicon validation rejects invented cid strings
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'

const SESSION = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

let transport: TestTransport

function stubWide(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('900px'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

function wirePost(id: string, text: string) {
  return {
    uri: `at://did:plc:rocket/app.bsky.feed.post/${id}`,
    cid: CID,
    author: { did: 'did:plc:rocket', handle: 'rocket.test', displayName: 'rocketeer' },
    record: { $type: 'app.bsky.feed.post', text, createdAt: '2026-10-29T12:00:00.000Z' },
    indexedAt: '2026-10-29T12:00:00.000Z',
  }
}

interface SearchRender extends RenderResult {
  history: string[]
}

function renderSearch(searchPath = 'q=cats'): SearchRender {
  const queryClient = createTestQueryClient()
  const memory = memoryLocation({ path: '/search', searchPath, record: true })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <SearchView />
      </Router>
    </QueryClientProvider>,
  )
  return { ...result, history: memory.history }
}

function HotkeyHost({ onEscape }: { onEscape: () => void }) {
  // mirrors App: an open dialog or composer disables the app key layer
  const dialog = useUiStore((state) => state.dialog)
  const compose = useUiStore((state) => state.compose)
  const inlineCompose = useUiStore((state) => state.inlineCompose)
  useHotkeys(
    [{ key: 'Escape', handler: onEscape }],
    dialog === null && compose === null && inlineCompose === null,
  )
  return <SearchView />
}

function renderWithHotkeys(onEscape: () => void): void {
  const queryClient = createTestQueryClient()
  const memory = memoryLocation({ path: '/search', searchPath: 'q=cats', record: true })
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <Route path="/search">
          <HotkeyHost onEscape={onEscape} />
        </Route>
      </Router>
    </QueryClientProvider>,
  )
}

function focusedCardIndex(): string | null {
  return (
    document.querySelector('.b-deck__item[data-focused="true"]')?.getAttribute('data-deck-index') ??
    null
  )
}

function callsTo(path: string): RouteRequest[] {
  return transport.calls.filter((call) => new URL(call.url).pathname === path)
}

/**
 * jsdom does not run a form's implicit submission for Enter, so the key is
 * delivered to the field and the submit event the browser would raise follows.
 */
function pressEnter(input: HTMLInputElement): void {
  fireEvent.keyDown(input, { key: 'Enter' })
  const form = input.closest('form')
  if (form === null) throw new Error('query field is not in a form')
  fireEvent.submit(form)
}

function stubFeeds(): void {
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.unspecced.getPopularFeedGenerators`, () =>
    jsonResponse(200, {
      feeds: [
        {
          uri: `at://did:plc:rocket/app.bsky.feed.generator/cats`,
          cid: CID,
          did: 'did:plc:rocketgen',
          creator: { did: 'did:plc:rocketgen', handle: 'rocket.gen' },
          displayName: 'all cats',
          description: 'a feed of cats',
          indexedAt: '2026-10-29T12:00:00.000Z',
        },
      ],
    }),
  )
}

function queryInput(): HTMLInputElement {
  const input = screen.getByLabelText('query')
  if (!(input instanceof HTMLInputElement)) throw new Error('query input missing')
  return input
}

/** A change event that also places the caret, as a real edit would. */
function typeAt(input: HTMLInputElement, value: string, caret: number): void {
  fireEvent.change(input, { target: { value, selectionStart: caret } })
}

async function openUsersMode(): Promise<void> {
  await screen.findByLabelText('search posts')
  fireEvent.click(screen.getByLabelText('change search mode, posts'))
  fireEvent.click(screen.getByLabelText('show users'))
  await screen.findByLabelText('search users')
}

async function signInAsAlice(): Promise<void> {
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, SESSION),
  )
  // a signed-in search hydrates hidden authors and reply parents best effort
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getProfiles`, () =>
    jsonResponse(200, { profiles: [] }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getPosts`, () =>
    jsonResponse(200, { posts: [] }),
  )
  transport.route('GET', `https://plc.directory/${SESSION.did}`, () =>
    jsonResponse(200, {
      id: SESSION.did,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    }),
  )
  const ok = await useAuthStore.getState().signIn(SESSION.did, 'app-pass')
  expect(ok).toBe(true)
}

beforeEach(() => {
  transport = installTransport()
  stubWide(true)
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
    jsonResponse(200, { posts: [wirePost('1', 'public one'), wirePost('2', 'public two')] }),
  )
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.searchActors`, () =>
    jsonResponse(200, {
      actors: [
        { did: 'did:plc:rocket', handle: 'rocket.test', displayName: '🚀 rocketeer' },
        { did: 'did:plc:lower', handle: 'lower.test', displayName: '' },
      ],
    }),
  )
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.searchActorsTypeahead`, () =>
    jsonResponse(200, {
      actors: [{ did: 'did:plc:ada', handle: 'ada.test', displayName: 'ada' }],
    }),
  )
  stubFeeds()
  useSettings.setState({ appView: toAppViewTarget(DEFAULT_APPVIEW) })
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null, openingPost: null })
})

describe('SearchView mode switcher escape', () => {
  it('closes the switcher before the app can leave search', async () => {
    const onEscape = vi.fn()
    renderWithHotkeys(onEscape)

    await screen.findByLabelText('search posts')
    fireEvent.click(screen.getByLabelText('change search mode, posts'))
    expect(screen.getByLabelText('search modes')).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(screen.queryByLabelText('search modes')).toBeNull()
    expect(screen.getByLabelText('search posts')).toBeInTheDocument()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('leaves Escape to an open dialog and closes the switcher afterwards', async () => {
    const onEscape = vi.fn()
    renderWithHotkeys(onEscape)

    await screen.findByLabelText('search posts')
    fireEvent.click(screen.getByLabelText('change search mode, posts'))

    act(() => {
      useUiStore.setState({ dialog: 'settings' })
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByLabelText('search modes')).toBeInTheDocument()

    act(() => {
      useUiStore.setState({ dialog: null })
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByLabelText('search modes')).toBeNull()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('leaves Escape to an open native modal', async () => {
    renderWithHotkeys(vi.fn())

    await screen.findByLabelText('search posts')
    fireEvent.click(screen.getByLabelText('change search mode, posts'))

    const modal = document.createElement('dialog')
    modal.open = true
    document.body.append(modal)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.getByLabelText('search modes')).toBeInTheDocument()
    } finally {
      modal.remove()
    }
  })
})

describe('SearchView suggestion insertion', () => {
  it('keeps the sentence around an accepted handle and types after it', async () => {
    const { history } = renderSearch()
    const input = queryInput()

    typeAt(input, 'hi @ad there', 6)
    const option = await screen.findByRole('option', { name: /@ada\.test/ })
    // options leave the sequential tab order but stay pointer and arrow reachable
    expect(option).toHaveAttribute('tabindex', '-1')
    fireEvent.click(option)

    await waitFor(() => expect(input.value).toBe('hi @ada.test there'))
    await waitFor(() => expect(input.selectionStart).toBe('hi @ada.test '.length))
    expect(history.at(-1)).toBe('/search?q=hi+%40ada.test+there')

    // typing continues after the reused separator instead of merging the handle
    const caret = input.selectionStart ?? 0
    const value = input.value
    const typed = `${value.slice(0, caret)}fresh ${value.slice(caret)}`
    typeAt(input, typed, caret + 'fresh '.length)

    expect(input.value).toBe('hi @ada.test fresh there')
  })

  it('keeps the comma after an accepted handle and leaves the caret before it', async () => {
    const { history } = renderSearch()
    const input = queryInput()

    typeAt(input, 'hi @ad, there', 6)
    fireEvent.click(await screen.findByRole('option', { name: /@ada\.test/ }))

    await waitFor(() => expect(input.value).toBe('hi @ada.test, there'))
    await waitFor(() => expect(input.selectionStart).toBe('hi @ada.test'.length))
    // no extra space was inserted ahead of the punctuation
    expect(input.value).not.toContain('ada.test ,')
    expect(history.at(-1)).toBe('/search?q=hi+%40ada.test%2C+there')
  })
})

describe('SearchView avatar fallbacks', () => {
  it('shows the whole leading emoji of a display name', async () => {
    renderSearch()
    await openUsersMode()

    await screen.findByRole('link', { name: '🚀 rocketeer' })
    const glyph = document.querySelector('.b-search-card__avatar .dither-image--fallback')
    expect(glyph?.textContent).toBe('🚀')
  })
})

describe('SearchView viewer identity', () => {
  it('moves the posts deck to the new viewer source', async () => {
    let posts = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () => {
      posts += 1
      return jsonResponse(
        200,
        posts === 1
          ? { posts: [wirePost('1', 'public one'), wirePost('2', 'public two')] }
          : { posts: [wirePost('3', 'viewer one'), wirePost('4', 'viewer two')] },
      )
    })

    renderSearch()
    await screen.findByText('public one')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedCardIndex()).toBe('1')

    await signInAsAlice()

    await screen.findByText('viewer one')
    // the deck focus belongs to the new viewer's page, not the previous one
    expect(focusedCardIndex()).toBe('0')
  })

  it('leaves the viewer-independent users deck where it was', async () => {
    renderSearch()
    await openUsersMode()
    await screen.findByText('🚀 rocketeer')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedCardIndex()).toBe('1')

    await signInAsAlice()

    await waitFor(() => expect(screen.getByLabelText('search users')).toBeInTheDocument())
    expect(focusedCardIndex()).toBe('1')
  })
})

describe('SearchView query submission', () => {
  it('writes the trimmed query to the address bar and searches once', async () => {
    const { history } = renderSearch('')
    const input = queryInput()
    const before = history.length

    typeAt(input, '  cats  ', 8)
    pressEnter(input)

    await screen.findByText('public one')
    expect(history).toHaveLength(before)
    expect(history.at(-1)).toBe('/search?q=cats')
    const searches = callsTo(SEARCH_POSTS)
    expect(searches).toHaveLength(1)
    const searchUrl = new URL(searches[0]?.url ?? '')
    expect(searchUrl.origin).toBe(APPVIEW)
    expect(searchUrl.searchParams.get('q')).toBe('cats')
  })

  it('reloads the same query once more without touching the address bar', async () => {
    const { history } = renderSearch('q=cats')
    await screen.findByText('public one')
    expect(callsTo(SEARCH_POSTS)).toHaveLength(1)
    const before = history.length

    pressEnter(queryInput())

    await waitFor(() => expect(callsTo(SEARCH_POSTS)).toHaveLength(2))
    expect(new URL(callsTo(SEARCH_POSTS)[1]?.url ?? '').searchParams.get('q')).toBe('cats')
    expect(history).toHaveLength(before)
    expect(history.at(-1)).toBe('/search?q=cats')
    await screen.findByText('public one')
  })

  it('drops the query and shows the idle state without another request', async () => {
    const { history } = renderSearch('q=cats')
    await screen.findByText('public one')
    const input = queryInput()

    typeAt(input, '', 0)
    pressEnter(input)

    await screen.findByText('quiet band')
    expect(history.at(-1)).toBe('/search')
    expect(callsTo(SEARCH_POSTS)).toHaveLength(1)
    expect(screen.queryByText('public one')).toBeNull()
  })

  it('searches users and feeds through the peek deck and escapes back to results', async () => {
    renderSearch('q=cats')
    await screen.findByText('public one')

    fireEvent.click(screen.getByLabelText('change search mode, posts'))
    expect(screen.getByLabelText('search modes')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('show users'))

    await screen.findByText('🚀 rocketeer')
    expect(screen.getByLabelText('search users')).toBeInTheDocument()
    expect(screen.queryByLabelText('search modes')).toBeNull()
    expect(callsTo(SEARCH_ACTORS)).toHaveLength(1)
    expect(new URL(callsTo(SEARCH_ACTORS)[0]?.url ?? '').searchParams.get('q')).toBe('cats')

    fireEvent.click(screen.getByLabelText('change search mode, users'))
    expect(screen.getByLabelText('search modes')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByLabelText('search modes')).toBeNull()
    expect(screen.getByLabelText('search users')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('change search mode, users'))
    fireEvent.click(screen.getByLabelText('show feeds'))

    await screen.findByText('all cats')
    expect(screen.getByLabelText('search feeds')).toBeInTheDocument()
    expect(callsTo(SEARCH_FEEDS)).toHaveLength(1)
    expect(new URL(callsTo(SEARCH_FEEDS)[0]?.url ?? '').searchParams.get('query')).toBe('cats')
    expect(screen.queryByLabelText('search users')).toBeNull()
  })

  it('clears the field and query with escape, then blurs to the deck', async () => {
    const { history } = renderSearch('q=cats')
    const input = queryInput()
    await screen.findByText('public one')
    expect(input.value).toBe('cats')
    expect(input).toHaveFocus()

    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(input.value).toBe(''))
    expect(history.at(-1)).toBe('/search')
    expect(input).toHaveFocus()
    expect(screen.getByLabelText('search posts')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(document.activeElement).not.toBe(input)
    expect(screen.getByLabelText('search posts')).toBeInTheDocument()
    expect(history.at(-1)).toBe('/search')
  })

  it('shows the unsupported state and sends no search request', async () => {
    const publicView = APPVIEW_PRESETS.find((preset) => preset.id === 'public')
    if (publicView === undefined) throw new Error('public preset missing')
    useSettings.setState({ appView: toAppViewTarget(publicView) })

    renderSearch('q=cats')

    await screen.findByText('this appview does not expose search. switch appviews in the top bar.')
    expect(screen.getByLabelText('query')).toHaveValue('cats')
    expect(callsTo(SEARCH_POSTS)).toHaveLength(0)
    expect(callsTo(SEARCH_ACTORS)).toHaveLength(0)
    expect(callsTo(SEARCH_FEEDS)).toHaveLength(0)
  })

  it('opens the thread from a plain click on a result card', async () => {
    const { history } = renderSearch('q=cats')
    await screen.findByText('public one')

    const card = document.querySelector('.b-post-card')
    if (card === null) throw new Error('search result card missing')
    fireEvent.click(card)

    const uri = 'at://did:plc:rocket/app.bsky.feed.post/1'
    await waitFor(() => expect(history.at(-1)).toBe(`/thread?uri=${encodeURIComponent(uri)}`))
    expect(useUiStore.getState().openingPost?.uri).toBe(uri)
  })

  it('searches the trimmed query an accepted suggestion writes', async () => {
    const { history } = renderSearch('')
    const input = queryInput()

    typeAt(input, 'hi @ad there', 6)
    const option = await screen.findByRole('option', { name: /@ada\.test/ })
    // options leave the sequential tab order but stay pointer and arrow reachable
    expect(option).toHaveAttribute('tabindex', '-1')
    fireEvent.click(option)

    await waitFor(() => expect(input.value).toBe('hi @ada.test there'))
    await waitFor(() => expect(history.at(-1)).toBe('/search?q=hi+%40ada.test+there'))

    await screen.findByText('public one')
    const searches = callsTo(SEARCH_POSTS)
    expect(searches).toHaveLength(1)
    expect(new URL(searches[0]?.url ?? '').searchParams.get('q')).toBe('hi @ada.test there')
  })
})

describe('SearchView search landmark and swap focus', () => {
  it('exposes a search landmark with a live result count', async () => {
    renderSearch('q=cats')
    // jsdom's role map predates the HTML search element; the native element is
    // the landmark in real browsers, so assert it by element + accessible name
    const landmark = screen.getByLabelText('search')
    expect(landmark.tagName).toBe('SEARCH')

    await screen.findByText('public one')
    await waitFor(() =>
      expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain(
        '2 results in posts',
      ),
    )
  })

  it('moves focus to the deck each time the mode cards swap', async () => {
    renderSearch('q=cats')
    await screen.findByLabelText('search posts')

    fireEvent.click(screen.getByLabelText('change search mode, posts'))
    const modes = screen.getByLabelText('search modes')
    await waitFor(() => expect(modes).toHaveFocus())

    fireEvent.click(screen.getByLabelText('show users'))
    const users = await screen.findByLabelText('search users')
    await waitFor(() => expect(users).toHaveFocus())
  })

  it('keeps the query field focused when a submit closes the mode cards', async () => {
    renderSearch('q=cats')
    await screen.findByText('public one')

    fireEvent.click(screen.getByLabelText('change search mode, posts'))
    await waitFor(() => expect(screen.getByLabelText('search modes')).toHaveFocus())

    const input = queryInput()
    input.focus()
    pressEnter(input)

    await waitFor(() => expect(screen.queryByLabelText('search modes')).toBeNull())
    expect(input).toHaveFocus()
  })
})

describe('SearchView retained rows on a failed rescan', () => {
  it('announces the failure beside the user rows and recovers on retry', async () => {
    let scans = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.searchActors`, () => {
      scans += 1
      if (scans === 1) {
        return jsonResponse(200, {
          actors: [
            { did: 'did:plc:rocket', handle: 'rocket.test', displayName: '🚀 rocketeer' },
            { did: 'did:plc:lower', handle: 'lower.test', displayName: '' },
          ],
        })
      }
      if (scans === 2) {
        return jsonResponse(500, { error: 'InternalServerError', message: 'rescan failed' })
      }
      return jsonResponse(200, {
        actors: [{ did: 'did:plc:ada', handle: 'ada.test', displayName: 'ada' }],
      })
    })

    renderSearch('q=cats')
    await openUsersMode()
    await screen.findByText('🚀 rocketeer')

    pressEnter(queryInput())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('rescan failed')
    // the rows it warned about are still the deck's content
    expect(screen.getByText('🚀 rocketeer')).toBeInTheDocument()
    expect(screen.getByLabelText('search users')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    await screen.findByText('ada')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.queryByText('🚀 rocketeer')).toBeNull()
    // focus lands on the deck the recovered rows live in, never on the body
    await waitFor(() => expect(screen.getByLabelText('search users')).toHaveFocus())
  })
})
