import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  type RenderResult,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useHotkeys } from '../hooks/useHotkeys'
import { makeCustomAppView } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import ProfileView from './ProfileView'

const APPVIEW = 'https://api.bsky.app'
const PDS = 'https://pds.test'
const ACTOR = 'ada.test'
const AUTHOR_DID = 'did:plc:ada'
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
    uri: `at://${AUTHOR_DID}/app.bsky.feed.post/${id}`,
    cid: CID,
    author: { did: AUTHOR_DID, handle: ACTOR, displayName: 'ada' },
    record: { $type: 'app.bsky.feed.post', text, createdAt: '2026-10-29T12:00:00.000Z' },
    indexedAt: '2026-10-29T12:00:00.000Z',
  }
}

function feedPage(posts: readonly [string, string][]) {
  return { feed: posts.map(([id, text]) => ({ post: wirePost(id, text) })) }
}

function profileWire(did = AUTHOR_DID, handle = ACTOR) {
  return {
    did,
    handle,
    displayName: 'ada',
    description: 'test profile',
    followersCount: 3,
    followsCount: 2,
    postsCount: 4,
    viewer: {},
  }
}

function deferred<T>() {
  return Promise.withResolvers<T>()
}

interface ProfileRender extends RenderResult {
  queryClient: QueryClient
}

function renderProfile(path = `/profile/${ACTOR}`): ProfileRender {
  const queryClient = createTestQueryClient()
  const memory = memoryLocation({ path, record: true })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <Route path="/profile/:actor" component={ProfileView} />
      </Router>
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
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
  return <ProfileView />
}

function renderWithHotkeys(onEscape: () => void): void {
  const queryClient = createTestQueryClient()
  const memory = memoryLocation({ path: `/profile/${ACTOR}`, record: true })
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <Route path="/profile/:actor">
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

async function contentDeck(actor: string = ACTOR): Promise<HTMLElement> {
  return screen.findByLabelText(`profile of ${actor}`)
}

async function openPostsMode(actor: string = ACTOR): Promise<void> {
  await contentDeck(actor)
  fireEvent.click(screen.getByLabelText('change mode, profile'))
  fireEvent.click(screen.getByLabelText('show posts'))
  await screen.findByLabelText(`posts by ${actor}`)
}

async function signInAsAlice(): Promise<void> {
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, SESSION),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getProfile`, () =>
    jsonResponse(200, profileWire()),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getProfiles`, () =>
    jsonResponse(200, { profiles: [] }),
  )
  // reply-parent hydration is best effort; this suite reads the author feed
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getPosts`, () =>
    jsonResponse(200, { posts: [] }),
  )
  const ok = await useAuthStore.getState().signIn('alice.test', 'app-pass', PDS)
  expect(ok).toBe(true)
}

beforeEach(() => {
  transport = installTransport()
  stubWide(true)
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.getProfile`, () =>
    jsonResponse(200, profileWire()),
  )
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
    jsonResponse(200, feedPage([])),
  )
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null, openingPost: null })
})

describe('ProfileView mode switcher escape', () => {
  it('closes the switcher before the app can leave the profile', async () => {
    const onEscape = vi.fn()
    renderWithHotkeys(onEscape)

    await contentDeck()
    fireEvent.click(screen.getByLabelText('change mode, profile'))
    expect(screen.getByLabelText('profile modes')).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(screen.queryByLabelText('profile modes')).toBeNull()
    expect(screen.getByLabelText(`profile of ${ACTOR}`)).toBeInTheDocument()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('leaves Escape to an open dialog and closes the switcher afterwards', async () => {
    const onEscape = vi.fn()
    renderWithHotkeys(onEscape)

    await contentDeck()
    fireEvent.click(screen.getByLabelText('change mode, profile'))

    act(() => {
      useUiStore.setState({ dialog: 'settings' })
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByLabelText('profile modes')).toBeInTheDocument()

    act(() => {
      useUiStore.setState({ dialog: null })
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByLabelText('profile modes')).toBeNull()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('leaves Escape to an open native modal', async () => {
    renderWithHotkeys(vi.fn())

    await contentDeck()
    fireEvent.click(screen.getByLabelText('change mode, profile'))

    const modal = document.createElement('dialog')
    modal.open = true
    document.body.append(modal)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.getByLabelText('profile modes')).toBeInTheDocument()
    } finally {
      modal.remove()
    }
  })
})

describe('ProfileView mode chooser repeats', () => {
  it('opens once on a back key and a held key cannot flip it back', async () => {
    renderProfile()
    await contentDeck()

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByLabelText('profile modes')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true })
    expect(screen.getByLabelText('profile modes')).toBeInTheDocument()

    // a fresh press still returns to the cards
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.queryByLabelText('profile modes')).toBeNull()
    expect(screen.getByLabelText(`profile of ${ACTOR}`)).toBeInTheDocument()
  })
})

describe('ProfileView refresh card', () => {
  it('shows only the loading card while the first page is blank, then posts and a refresh card', async () => {
    const gate = deferred<Response>()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () => gate.promise)

    renderProfile()
    await openPostsMode()

    expect(screen.getByRole('progressbar', { name: 'loading posts' })).toBeInTheDocument()
    expect(document.querySelector('.b-refresh-card')).toBeNull()
    expect(focusedCardIndex()).toBe('0')

    gate.resolve(
      jsonResponse(
        200,
        feedPage([
          ['1', 'first'],
          ['2', 'second'],
        ]),
      ),
    )
    await screen.findByText('first')

    const items = document.querySelectorAll('.b-deck__item[data-deck-index]')
    expect(items).toHaveLength(3)
    const refresh = screen.getByLabelText('refresh posts')
    expect(items[2]?.contains(refresh)).toBe(true)
    expect(refresh.textContent).toContain('[02]')
  })

  it('reloads the first page once from the refresh card and focuses its first post', async () => {
    const gate = deferred<Response>()
    let calls = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () => {
      calls += 1
      return calls === 1
        ? jsonResponse(
            200,
            feedPage([
              ['1', 'first'],
              ['2', 'second'],
            ]),
          )
        : gate.promise
    })

    renderProfile()
    await openPostsMode()
    await screen.findByText('first')
    expect(calls).toBe(1)

    fireEvent.keyDown(window, { key: 'End' })
    expect(focusedCardIndex()).toBe('2')

    fireEvent.keyDown(window, { key: 'Enter' })

    // the blank reload clamps focus to its single loading card
    await screen.findByRole('progressbar', { name: 'loading posts' })
    expect(focusedCardIndex()).toBe('0')
    expect(calls).toBe(2)

    gate.resolve(jsonResponse(200, feedPage([['3', 'fresh']])))
    await screen.findByText('fresh')
    expect(calls).toBe(2)
    expect(screen.queryByText('first')).toBeNull()
    expect(focusedCardIndex()).toBe('0')
    // activating the refresh card never opens a thread
    expect(useUiStore.getState().openingPost).toBeNull()
  })

  it('does not restart or drop content while a background fetch is running', async () => {
    const gate = deferred<Response>()
    let calls = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () => {
      calls += 1
      return calls === 1 ? jsonResponse(200, feedPage([['1', 'first']])) : gate.promise
    })

    const { queryClient } = renderProfile()
    await openPostsMode()
    await screen.findByText('first')

    void queryClient.refetchQueries({ queryKey: ['feed'] })
    await waitFor(() => expect(calls).toBe(2))
    expect(screen.getByText('first')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'End' })
    expect(focusedCardIndex()).toBe('1')
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(calls).toBe(2)
    expect(screen.getByText('first')).toBeInTheDocument()

    gate.resolve(jsonResponse(200, feedPage([['9', 'after']])))
    await screen.findByText('after')
  })

  it('refreshes from the refresh card button and does not refetch on a mode switch', async () => {
    let calls = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () => {
      calls += 1
      return jsonResponse(200, feedPage([['1', 'first']]))
    })

    renderProfile()
    await openPostsMode()
    await screen.findByText('first')
    expect(calls).toBe(1)

    const refresh = screen.getByLabelText('refresh posts')
    fireEvent.click(within(refresh).getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(calls).toBe(2))
    await screen.findByText('first')

    fireEvent.click(screen.getByLabelText('change mode, posts'))
    fireEvent.click(screen.getByLabelText('show profile'))
    expect(screen.queryByLabelText('refresh posts')).toBeNull()

    fireEvent.click(screen.getByLabelText('change mode, profile'))
    fireEvent.click(screen.getByLabelText('show posts'))
    await screen.findByText('first')
    expect(calls).toBe(2)
  })
})

describe('ProfileView viewer identity', () => {
  it('keeps the selected mode and focuses the new viewer page from its first card', async () => {
    let calls = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () => {
      calls += 1
      return jsonResponse(
        200,
        calls === 1
          ? feedPage([
              ['1', 'public one'],
              ['2', 'public two'],
            ])
          : feedPage([
              ['3', 'viewer one'],
              ['4', 'viewer two'],
            ]),
      )
    })

    renderProfile()
    await openPostsMode()
    await screen.findByText('public one')

    // another test's saved card must not decide where this one starts
    fireEvent.keyDown(window, { key: 'Home' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedCardIndex()).toBe('1')

    await signInAsAlice()

    await screen.findByText('viewer one')
    // the same mode, but the deck belongs to the new viewer's first page
    expect(screen.getByLabelText(`posts by ${ACTOR}`)).toBeInTheDocument()
    expect(focusedCardIndex()).toBe('0')
  })
})

describe('ProfileView deck focus', () => {
  it('moves focus into the mode deck and then to the chosen content deck', async () => {
    renderProfile()
    const content = await contentDeck()
    content.focus()
    expect(content).toHaveFocus()

    fireEvent.click(screen.getByLabelText('change mode, profile'))
    await waitFor(() => expect(screen.getByLabelText('profile modes')).toHaveFocus())
    // the selected chooser card says so in words, not only by colour
    expect(screen.getByText('current')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('show posts'))
    await waitFor(() => expect(screen.getByLabelText(`posts by ${ACTOR}`)).toHaveFocus())
  })

  it('leaves focus on the narrow pinned row when a mode is chosen there', async () => {
    stubWide(false)
    renderProfile()
    await screen.findByLabelText(`profile of ${ACTOR}`)

    const postsChip = screen.getByRole('button', { name: 'posts' })
    postsChip.focus()
    fireEvent.click(postsChip)
    await screen.findByLabelText(`posts by ${ACTOR}`)
    expect(postsChip).toHaveFocus()
  })
})

describe('ProfileView deck memory', () => {
  it('restores the saved card when the same actor, mode and viewer return', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
      jsonResponse(
        200,
        feedPage([
          ['1', 'first'],
          ['2', 'second'],
        ]),
      ),
    )

    renderProfile()
    await openPostsMode()
    await screen.findByText('first')
    // start from a known card so an earlier test's memory cannot decide this
    fireEvent.keyDown(window, { key: 'Home' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedCardIndex()).toBe('1')

    // leaving the mode and returning restores the same saved card
    fireEvent.click(screen.getByLabelText('change mode, posts'))
    fireEvent.click(screen.getByLabelText('show profile'))
    await screen.findByLabelText(`profile of ${ACTOR}`)

    await openPostsMode()
    await screen.findByText('first')
    await waitFor(() => expect(focusedCardIndex()).toBe('1'))
  })

  it('does not share a saved deck with another actor', async () => {
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
      jsonResponse(
        200,
        feedPage([
          ['1', 'first'],
          ['2', 'second'],
        ]),
      ),
    )

    const first = renderProfile()
    await openPostsMode()
    await screen.findByText('first')
    // start from a known card so an earlier test's memory cannot decide this
    fireEvent.keyDown(window, { key: 'Home' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(focusedCardIndex()).toBe('1')
    first.unmount()

    renderProfile('/profile/other.test')
    await openPostsMode('other.test')
    await screen.findByText('first')
    // another actor's first page never inherits this one's remembered card
    expect(focusedCardIndex()).toBe('0')
  })

  it('does not share a saved deck with another appview host', async () => {
    const OTHER_APPVIEW = 'https://other.test'
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
      jsonResponse(
        200,
        feedPage([
          ['1', 'first'],
          ['2', 'second'],
        ]),
      ),
    )
    transport.route('GET', `${OTHER_APPVIEW}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, profileWire()),
    )
    transport.route('GET', `${OTHER_APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
      jsonResponse(
        200,
        feedPage([
          ['1', 'first'],
          ['2', 'second'],
        ]),
      ),
    )
    const original = useSettings.getState().appView

    try {
      const first = renderProfile()
      await openPostsMode()
      await screen.findByText('first')
      fireEvent.keyDown(window, { key: 'Home' })
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      expect(focusedCardIndex()).toBe('1')
      first.unmount()

      const target = makeCustomAppView(OTHER_APPVIEW)
      expect(target).not.toBeNull()
      act(() => {
        useSettings.setState({ appView: target ?? original })
      })

      const last = renderProfile()
      await openPostsMode()
      await screen.findByText('first')
      // the same actor on another host is a different deck namespace
      expect(focusedCardIndex()).toBe('0')
      last.unmount()
    } finally {
      act(() => {
        useSettings.setState({ appView: original })
      })
    }
  })
})

describe('ProfileView failure recovery', () => {
  it('keeps the first-page failure and its retry mounted while the retry runs', async () => {
    const gate = deferred<Response>()
    let calls = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () => {
      calls += 1
      return calls === 1
        ? jsonResponse(500, { error: 'InternalServerError', message: 'feed refused' })
        : gate.promise
    })

    renderProfile()
    await openPostsMode()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('feed refused')
    const retry = within(alert).getByRole('button', { name: 'retry' })
    retry.focus()
    fireEvent.click(retry)

    await waitFor(() => expect(calls).toBe(2))
    // the notice is not swapped for a spinner, so its focused retry survives
    expect(screen.getByRole('alert')).toHaveTextContent('feed refused')
    expect(document.activeElement).toBe(retry)
    expect(retry).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('progressbar', { name: 'loading posts' })).toBeNull()

    gate.resolve(jsonResponse(200, feedPage([['1', 'recovered']])))
    await screen.findByText('recovered')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a failed identity notice while its retry runs', async () => {
    const gate = deferred<Response>()
    let calls = 0
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.getProfile`, () => {
      calls += 1
      if (calls <= 2) {
        return jsonResponse(500, { error: 'InternalServerError', message: 'identity refused' })
      }
      return gate.promise
    })

    renderProfile()

    const alert = await screen.findByRole('alert', undefined, { timeout: 3000 })
    expect(alert).toHaveTextContent('identity refused')
    fireEvent.click(within(alert).getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(calls).toBe(3))

    expect(screen.getByRole('alert')).toHaveTextContent('identity refused')
    expect(screen.queryByRole('progressbar', { name: 'resolving identity' })).toBeNull()
    expect(
      within(screen.getByRole('alert')).getByRole('button', { name: 'retry' }),
    ).toHaveAttribute('aria-busy', 'true')

    gate.resolve(jsonResponse(200, profileWire()))
    await screen.findByLabelText(`profile of ${ACTOR}`)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
