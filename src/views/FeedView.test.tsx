import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useHotkeys } from '../hooks/useHotkeys'
import { DISCOVER_FEED_URI } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { useUiStore } from '../lib/ui'
import { postFixture } from '../test/fixtures'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import FeedView from './FeedView'

const PDS = 'https://pds.test'
const CANONICAL = 'https://api.bsky.app'
const FEED_URI = 'at://did:plc:test/app.bsky.feed.generator/pinned'
// lexicon validation rejects invented cid strings
const CID = 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm'

function discoverGenerator(overrides: Record<string, unknown> = {}) {
  return {
    uri: DISCOVER_FEED_URI,
    cid: CID,
    did: 'did:web:discover.bsky.app',
    creator: { did: 'did:plc:z72i7hdynmk6r22z27h6tvur', handle: 'bsky.app' },
    displayName: 'Discover',
    acceptsInteractions: true,
    indexedAt: '2026-10-29T12:00:00.000Z',
    ...overrides,
  }
}

function routeDiscoverGenerator(overrides: Record<string, unknown> = {}): void {
  transport.route('GET', `${CANONICAL}/xrpc/app.bsky.feed.getFeedGenerator`, () =>
    jsonResponse(200, { view: discoverGenerator(overrides), isOnline: true, isValid: true }),
  )
}

const SESSION = {
  did: 'did:plc:alice',
  handle: 'alice.test',
  accessJwt: 'alice-access',
  refreshJwt: 'alice-refresh',
  active: true,
}

let transport: TestTransport

function wirePost(index: number, text: string) {
  return {
    uri: `at://did:plc:test/app.bsky.feed.post/${index}`,
    cid: CID,
    author: { did: 'did:plc:test', handle: 'test.bsky.social', displayName: 'test' },
    record: {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: '2026-10-29T12:00:00.000Z',
    },
    indexedAt: '2026-10-29T12:00:00.000Z',
  }
}

function feedbackCalls() {
  return transport.calls.filter(
    (call) => new URL(call.url).pathname === '/xrpc/app.bsky.feed.sendInteractions',
  )
}

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

function HotkeyHost({ onEscape }: { onEscape: () => void }) {
  // mirrors App: an open dialog or composer disables the app key layer
  const dialog = useUiStore((state) => state.dialog)
  const compose = useUiStore((state) => state.compose)
  const inlineCompose = useUiStore((state) => state.inlineCompose)
  useHotkeys(
    [{ key: 'Escape', handler: onEscape }],
    dialog === null && compose === null && inlineCompose === null,
  )
  return <FeedView />
}

interface RenderedFeed {
  /** the current router path, including its query */
  path: () => string
}

function renderFeed(onEscape: () => void, seed?: (client: QueryClient) => void): RenderedFeed {
  const queryClient = createTestQueryClient()
  seed?.(queryClient)
  const memory = memoryLocation({ path: '/feed', record: true })
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <HotkeyHost onEscape={onEscape} />
      </Router>
    </QueryClientProvider>,
  )
  return { path: () => memory.history?.at(-1) ?? '/feed' }
}

async function signInAsAlice(): Promise<void> {
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, SESSION),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
    jsonResponse(200, { preferences: [] }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () => jsonResponse(200, { feed: [] }))
  // the signed-in deck hydrates viewer state and hidden authors best effort:
  // both answer "nothing to change" here so each case keeps its own wire
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getProfiles`, () =>
    jsonResponse(200, { profiles: [] }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getPosts`, () =>
    jsonResponse(200, { posts: [] }),
  )
  routeDiscoverGenerator()
  transport.route('GET', `https://plc.directory/${'did:plc:alice'}`, () =>
    jsonResponse(200, {
      id: 'did:plc:alice',
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    }),
  )
  const ok = await useAuthStore.getState().signIn('did:plc:alice', 'app-pass')
  expect(ok).toBe(true)
}

async function openFeedsSwitcher(): Promise<void> {
  await screen.findByLabelText('discover cards')
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  await screen.findByLabelText('feed cards')
  expect(screen.getByLabelText('open discover')).toBeInTheDocument()
}

beforeEach(async () => {
  transport = installTransport()
  stubWide(true)
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null, openingPost: null })
  await signInAsAlice()
})

describe('FeedView feed feedback', () => {
  it('sends more feedback through the pds with the card context', async () => {
    const first = wirePost(1, 'first post')
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, {
        feed: [
          { post: first, feedContext: 'ctx-1', reqId: 'req-1' },
          { post: wirePost(2, 'second post') },
        ],
      }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () =>
      jsonResponse(200, {}),
    )
    renderFeed(vi.fn())

    await screen.findByText('first post')
    fireEvent.keyDown(window, { key: '+' })

    await waitFor(() => expect(feedbackCalls()).toHaveLength(1))
    const [call] = feedbackCalls()
    expect(call?.method).toBe('POST')
    // the pds forwards to the generator service named by the discover did
    expect(call?.headers['atproto-proxy']).toBe('did:web:discover.bsky.app#bsky_fg')
    expect(JSON.parse(call?.body ?? '')).toEqual({
      feed: DISCOVER_FEED_URI,
      interactions: [
        {
          $type: 'app.bsky.feed.defs#interaction',
          item: first.uri,
          event: 'app.bsky.feed.defs#requestMore',
          feedContext: 'ctx-1',
          reqId: 'req-1',
        },
      ],
    })
  })

  it('withholds feedback when the discover generator refuses interactions', async () => {
    routeDiscoverGenerator({ acceptsInteractions: false })
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'first post') }] }),
    )
    renderFeed(vi.fn())

    await screen.findByText('first post')
    expect(screen.queryByLabelText('more like this')).toBeNull()
    expect(screen.queryByLabelText('less like this')).toBeNull()
  })

  it('sends less feedback for the focused card and dismisses it', async () => {
    const second = wirePost(2, 'second post')
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'first post') }, { post: second }] }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () =>
      jsonResponse(200, {}),
    )
    renderFeed(vi.fn())

    await screen.findByText('first post')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('second post')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '-' })

    await waitFor(() => expect(feedbackCalls()).toHaveLength(1))
    const [call] = feedbackCalls()
    expect(JSON.parse(call?.body ?? '')).toEqual({
      feed: DISCOVER_FEED_URI,
      interactions: [
        {
          $type: 'app.bsky.feed.defs#interaction',
          item: second.uri,
          event: 'app.bsky.feed.defs#requestLess',
        },
      ],
    })
    await waitFor(() => expect(screen.queryByText('second post')).toBeNull(), { timeout: 2000 })
    expect(screen.getByText('first post')).toBeInTheDocument()
  })

  it('keeps the card and reports a rejected feedback request', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'first post') }] }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'feedback refused' }),
    )
    renderFeed(vi.fn())

    await screen.findByText('first post')
    fireEvent.keyDown(window, { key: '+' })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toBe('')
    expect(screen.getByText('first post')).toBeInTheDocument()
    expect(screen.getByLabelText('more like this')).toBeInTheDocument()
  })

  it('offers feedback for a pinned generator whose metadata omits the capability', async () => {
    routePinned({ uri: FEED_URI, displayName: 'pinned', description: '' })
    renderFeed(vi.fn())

    await screen.findByText('pinned post')
    expect(screen.getByLabelText('more like this')).toBeInTheDocument()
    expect(screen.getByLabelText('less like this')).toBeInTheDocument()
  })

  it('withholds feedback from a pinned generator that declares it unsupported', async () => {
    routePinned({
      uri: FEED_URI,
      displayName: 'pinned',
      description: '',
      acceptsInteractions: false,
    })
    renderFeed(vi.fn())

    await screen.findByText('pinned post')
    expect(screen.queryByLabelText('more like this')).toBeNull()
    expect(screen.queryByLabelText('less like this')).toBeNull()
  })

  it('withholds feedback from a pinned generator with no service did', async () => {
    routePinned({ uri: FEED_URI, displayName: 'pinned', description: '', did: undefined })
    renderFeed(vi.fn())

    await screen.findByText('pinned post')
    expect(screen.queryByLabelText('more like this')).toBeNull()
    expect(screen.queryByLabelText('less like this')).toBeNull()
  })
})

function routePinned(generator: Record<string, unknown>): void {
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
    jsonResponse(200, {
      preferences: [
        {
          $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
          items: [{ id: '1', type: 'feed', value: FEED_URI, pinned: true }],
        },
      ],
    }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeedGenerators`, () =>
    jsonResponse(200, {
      feeds: [
        {
          cid: CID,
          did: 'did:plc:test',
          creator: { did: 'did:plc:test', handle: 'test.bsky.social' },
          indexedAt: '2026-10-29T12:00:00.000Z',
          ...generator,
        },
      ],
    }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
    jsonResponse(200, { feed: [{ post: wirePost(1, 'pinned post') }] }),
  )
}

describe('FeedView feed switcher escape', () => {
  it('closes the switcher before the app can leave the feed', async () => {
    const onEscape = vi.fn()
    renderFeed(onEscape)

    await openFeedsSwitcher()
    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(screen.queryByLabelText('feed cards')).toBeNull()
    expect(screen.getByLabelText('discover cards')).toBeInTheDocument()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('leaves Escape to an open dialog and closes the switcher afterwards', async () => {
    const onEscape = vi.fn()
    renderFeed(onEscape)

    await openFeedsSwitcher()

    act(() => {
      useUiStore.setState({ dialog: 'settings' })
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByLabelText('feed cards')).toBeInTheDocument()

    act(() => {
      useUiStore.setState({ dialog: null })
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByLabelText('feed cards')).toBeNull()
    expect(screen.getByLabelText('discover cards')).toBeInTheDocument()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('leaves Escape to an open native modal', async () => {
    renderFeed(vi.fn())

    await openFeedsSwitcher()

    const modal = document.createElement('dialog')
    modal.open = true
    document.body.append(modal)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.getByLabelText('feed cards')).toBeInTheDocument()
    } finally {
      modal.remove()
    }
  })
})

function feedCalls() {
  return transport.calls.filter(
    (call) => new URL(call.url).pathname === '/xrpc/app.bsky.feed.getFeed',
  )
}

describe('FeedView explicit refresh', () => {
  it('refreshes once per press and drops the doubled-key armed state', async () => {
    let served = 0
    let release: (() => void) | null = null
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () => {
      served += 1
      if (served === 1) {
        return jsonResponse(200, { feed: [{ post: wirePost(1, 'first post') }] })
      }
      if (served === 2) {
        // hold the refresh open so the second press lands while it is in flight
        const deferred = Promise.withResolvers<Response>()
        release = () => {
          deferred.resolve(jsonResponse(200, { feed: [{ post: wirePost(2, 'refreshed post') }] }))
        }
        return deferred.promise
      }
      return jsonResponse(200, { feed: [{ post: wirePost(3, 'third pass') }] })
    })
    renderFeed(vi.fn())

    await screen.findByText('first post')
    expect(feedCalls()).toHaveLength(1)

    // one press refreshes; there is no second press to confirm
    fireEvent.keyDown(document.body, { key: 'R' })
    await waitFor(() => expect(feedCalls()).toHaveLength(2))
    expect(screen.queryByText('confirm refresh')).toBeNull()
    expect(document.querySelector('[data-refresh-armed]')).toBeNull()

    // a press while the refresh is still running asks for nothing new
    fireEvent.keyDown(document.body, { key: 'R' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(feedCalls()).toHaveLength(2)

    await act(async () => {
      release?.()
    })
    await screen.findByText('refreshed post')
    // the finished refresh does not trigger a follow-up read of its own
    expect(feedCalls()).toHaveLength(2)

    // a real R keystroke carries shift; the chord must not require its absence
    fireEvent.keyDown(document.body, { key: 'R', shiftKey: true })
    await waitFor(() => expect(feedCalls()).toHaveLength(3))
    await screen.findByText('third pass')
  })

  it('restores locally dismissed rows on an explicit refresh', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, {
        feed: [{ post: wirePost(1, 'first post') }, { post: wirePost(2, 'second post') }],
      }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () =>
      jsonResponse(200, {}),
    )
    renderFeed(vi.fn())

    await screen.findByText('first post')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: '-' })
    await waitFor(() => expect(screen.queryByText('second post')).toBeNull())

    fireEvent.keyDown(document.body, { key: 'R' })
    await screen.findByText('second post')
  })
})

function savedFeedsPreference() {
  return {
    preferences: [
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: [{ id: '1', type: 'feed', value: FEED_URI, pinned: true }],
      },
    ],
  }
}

function pinnedGenerator() {
  return {
    feeds: [
      {
        cid: CID,
        uri: FEED_URI,
        did: 'did:plc:test',
        creator: { did: 'did:plc:test', handle: 'test.bsky.social' },
        indexedAt: '2026-10-29T12:00:00.000Z',
        displayName: 'pinned',
        description: '',
      },
    ],
  }
}

describe('FeedView pinned failure', () => {
  it('keeps the deck, skips the fetch and recovers from its own error', async () => {
    let allowPinned = false
    let releasePreferences: (() => void) | null = null
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () => {
      if (!allowPinned) {
        return jsonResponse(500, {
          error: 'InternalServerError',
          message: 'preferences refused',
        })
      }
      const deferred = Promise.withResolvers<Response>()
      releasePreferences = () => {
        deferred.resolve(jsonResponse(200, savedFeedsPreference()))
      }
      return deferred.promise
    })
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeedGenerators`, () =>
      jsonResponse(200, pinnedGenerator()),
    )
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'pinned post') }] }),
    )

    renderFeed(vi.fn(), (client) => {
      client.setQueryData(['feed', CANONICAL, 'discover', 'did:plc:alice'], {
        pages: [{ posts: [postFixture({ text: 'cached discover post' })], cursor: null }],
        pageParams: [undefined],
      })
    })

    const notice = await screen.findByText('could not load pinned feeds', undefined, {
      timeout: 3000,
    })
    // the failure belongs to the deck, so its switcher and peeks stay usable
    expect(screen.getByLabelText('feed cards')).toContainElement(notice)
    // a cached discover page must not stand in for the unknown feed choice
    expect(screen.queryByText('cached discover post')).toBeNull()
    expect(feedCalls()).toHaveLength(0)

    allowPinned = true
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(releasePreferences).not.toBeNull())
    // the recovery notice keeps its place and reports the read it is retrying
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'retry' })).toHaveAttribute('aria-busy', 'true'),
    )
    expect(screen.getByText('could not load pinned feeds')).toBeInTheDocument()

    await act(async () => {
      releasePreferences?.()
    })
    await screen.findByText('pinned post')
    expect(screen.queryByText('could not load pinned feeds')).toBeNull()
    expect(feedCalls()).toHaveLength(1)
  })
})

describe('FeedView deck peeks', () => {
  it('opens the feeder from the posts peek and hands it the deck focus', async () => {
    renderFeed(vi.fn())
    await screen.findByLabelText('discover cards')

    fireEvent.click(screen.getByRole('button', { name: 'open discover' }))

    const switcher = await screen.findByLabelText('feed cards')
    await waitFor(() => expect(switcher).toHaveFocus())

    // the switcher's own back peek is one native button
    fireEvent.click(screen.getByRole('button', { name: 'open posts' }))

    const deck = await screen.findByLabelText('discover cards')
    await waitFor(() => expect(deck).toHaveFocus())
  })

  it('closes the switcher with its back arrow and refocuses the posts deck', async () => {
    renderFeed(vi.fn())
    await screen.findByLabelText('discover cards')
    fireEvent.click(screen.getByRole('button', { name: 'open discover' }))
    await screen.findByLabelText('feed cards')

    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    const deck = await screen.findByLabelText('discover cards')
    await waitFor(() => expect(deck).toHaveFocus())
  })
})

describe('FeedView add feed', () => {
  it('keeps the dialog and the url when a blank submission is attempted', async () => {
    const rendered = renderFeed(vi.fn())
    await screen.findByLabelText('discover cards')
    fireEvent.click(screen.getByRole('button', { name: 'open discover' }))
    await screen.findByLabelText('feed cards')

    fireEvent.click(screen.getByRole('button', { name: /add feed/ }))
    const input = await screen.findByLabelText('feed at-uri')
    expect(screen.getByRole('button', { name: 'open feed' })).toBeDisabled()

    fireEvent.submit(input.closest('form') as HTMLFormElement)

    expect(useUiStore.getState().dialog).toBe('feed-add')
    expect(screen.getByLabelText('feed at-uri')).toBeInTheDocument()
    expect(rendered.path()).toBe('/feed')
  })
})
