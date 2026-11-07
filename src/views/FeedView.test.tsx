import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useHotkeys } from '../hooks/useHotkeys'
import { useAuthStore } from '../lib/auth'
import { useUiStore } from '../lib/ui'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse, type TestTransport } from '../test/transport'
import FeedView from './FeedView'

const PDS = 'https://pds.test'
const FEED_A = 'at://did:plc:test/app.bsky.feed.generator/alpha'
const FEED_B = 'at://did:plc:test/app.bsky.feed.generator/beta'
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

function savedFeeds(uris: readonly string[]) {
  return {
    preferences: [
      {
        $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
        items: uris.map((value, index) => ({
          id: String(index + 1),
          type: 'feed',
          value,
          pinned: true,
        })),
      },
    ],
  }
}

function generator(uri: string, overrides: Record<string, unknown> = {}) {
  return {
    uri,
    cid: CID,
    did: 'did:web:feeds.test',
    creator: { did: 'did:plc:test', handle: 'test.bsky.social' },
    displayName: uri.split('/').at(-1) ?? 'feed',
    description: `a pinned feed for ${uri.split('/').at(-1) ?? uri}`,
    acceptsInteractions: true,
    indexedAt: '2026-10-29T12:00:00.000Z',
    ...overrides,
  }
}

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

function feedCalls() {
  return transport.calls.filter(
    (call) => new URL(call.url).pathname === '/xrpc/app.bsky.feed.getFeed',
  )
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

interface RenderOptions {
  uri?: string
  onEscape?: () => void
  seed?: (client: QueryClient) => void
}

function renderFeed(options: RenderOptions = {}) {
  const onEscape = options.onEscape ?? vi.fn()
  const queryClient = createTestQueryClient()
  options.seed?.(queryClient)
  const memory = memoryLocation({
    path: '/feed',
    ...(options.uri === undefined ? {} : { searchPath: `uri=${encodeURIComponent(options.uri)}` }),
    record: true,
  })
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <HotkeyHost onEscape={onEscape} />
      </Router>
    </QueryClientProvider>,
  )
  return { onEscape, history: () => memory.history ?? [] }
}

async function signInWith(feeds: readonly string[] = [FEED_A]): Promise<void> {
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, SESSION),
  )
  transport.route('GET', `https://plc.directory/${SESSION.did}`, () =>
    jsonResponse(200, {
      id: SESSION.did,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
    jsonResponse(200, savedFeeds(feeds)),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeedGenerators`, () =>
    jsonResponse(200, { feeds: feeds.map((uri) => generator(uri)) }),
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
  const ok = await useAuthStore.getState().signIn(SESSION.did, 'app-pass')
  expect(ok).toBe(true)
}

beforeEach(async () => {
  transport = installTransport()
  stubWide(true)
  useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null, openingPost: null })
  await signInWith([FEED_A, FEED_B])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('FeedView pinned selection', () => {
  it('loads the first pinned feed when no feed is requested', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'alpha post') }] }),
    )
    renderFeed()

    await screen.findByText('alpha post')
    expect(feedCalls()).toHaveLength(1)
    expect(new URL(feedCalls()[0]?.url ?? '').searchParams.get('feed')).toBe(FEED_A)
    expect(screen.getByLabelText('posts')).toBeInTheDocument()
  })

  it('honors a requested feed that the account pinned', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(2, 'beta post') }] }),
    )
    renderFeed({ uri: FEED_B })

    await screen.findByText('beta post')
    expect(new URL(feedCalls()[0]?.url ?? '').searchParams.get('feed')).toBe(FEED_B)
  })

  it('resolves an arbitrary generator to the first pin and never fetches it', async () => {
    const arbitrary = 'at://did:plc:evil/app.bsky.feed.generator/whats-hot'
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'alpha post') }] }),
    )
    renderFeed({ uri: arbitrary })

    await screen.findByText('alpha post')
    expect(new URL(feedCalls()[0]?.url ?? '').searchParams.get('feed')).toBe(FEED_A)
    expect(transport.calls.some((call) => call.url.includes('evil'))).toBe(false)
  })

  it('shows the empty state for an account with no pinned feeds and fetches none', async () => {
    await signInWith([])
    renderFeed()

    await screen.findByText('pin feeds in the bluesky app and they appear here.')
    expect(feedCalls()).toHaveLength(0)
  })

  it('does not arm refresh for a loaded empty pinned list and latches nothing', async () => {
    await signInWith([])
    const captured: { client?: QueryClient } = {}
    renderFeed({
      seed: (client) => {
        captured.client = client
      },
    })

    await screen.findByText('pin feeds in the bluesky app and they appear here.')
    expect(feedCalls()).toHaveLength(0)

    fireEvent.keyDown(window, { key: 'R' })
    // nothing can be refreshed, so the confirmation never opens
    expect(screen.queryByText('press R again to refresh')).toBeNull()

    // a later selection refreshes: the refused press left no pending latch
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'alpha post') }] }),
    )
    await act(async () => {
      captured.client?.setQueryData(
        ['pinned-feeds', SESSION.did],
        [
          {
            uri: FEED_A,
            name: 'alpha',
            description: 'a pinned feed for alpha',
            avatar: null,
            generatorDid: 'did:web:feeds.test',
            acceptsInteractions: true,
          },
        ],
      )
    })
    await screen.findByText('alpha post')
    const loaded = feedCalls().length

    fireEvent.keyDown(window, { key: 'R' })
    expect(screen.getByText('press R again to refresh')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'R' })
    await waitFor(() => expect(feedCalls()).toHaveLength(loaded + 1))
  })

  it('does not treat a pending pinned read as an empty list', async () => {
    const gate = Promise.withResolvers<Response>()
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () => gate.promise)
    renderFeed()

    expect(screen.getByRole('progressbar', { name: 'loading pinned feeds' })).toBeInTheDocument()
    expect(feedCalls()).toHaveLength(0)

    gate.resolve(jsonResponse(200, savedFeeds([FEED_A])))
    await waitFor(() => expect(feedCalls()).toHaveLength(1))
  })

  it('keeps a pinned failure mounted with a retry', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
      jsonResponse(500, { error: 'InternalServerError', message: 'preferences failed' }),
    )
    renderFeed()

    await screen.findByText('could not load pinned feeds', undefined, { timeout: 3000 })
    expect(feedCalls()).toHaveLength(0)

    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
      jsonResponse(200, savedFeeds([FEED_A])),
    )
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'alpha post') }] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    await screen.findByText('alpha post')
  })
})

describe('FeedView refresh confirmation', () => {
  function routeAlphaPosts() {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'alpha post') }] }),
    )
  }

  it('arms on the first R and refreshes only on the second', async () => {
    routeAlphaPosts()
    renderFeed()
    await screen.findByText('alpha post')
    const loaded = feedCalls().length

    fireEvent.keyDown(window, { key: 'R' })
    expect(screen.getByText('press R again to refresh')).toBeInTheDocument()
    expect(feedCalls()).toHaveLength(loaded)

    fireEvent.keyDown(window, { key: 'R' })
    await waitFor(() => expect(feedCalls()).toHaveLength(loaded + 1))
    expect(screen.queryByText('press R again to refresh')).toBeNull()
    // a refresh drops the pages and asks for the first one only
    expect(new URL(feedCalls().at(-1)?.url ?? '').searchParams.get('cursor')).toBeNull()
  })

  it('restores a dismissed card when a confirmed refresh reloads the first page', async () => {
    const first = wirePost(1, 'first post')
    const second = wirePost(2, 'second post')
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: first }, { post: second }], cursor: 'page-2' }),
    )
    const accepted = Promise.withResolvers<Response>()
    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () => accepted.promise)
    renderFeed()

    await screen.findByText('first post')
    // the focused card is the first post; an accepted less signal drops it
    fireEvent.keyDown(window, { key: '-' })
    await waitFor(() => expect(feedbackCalls()).toHaveLength(1))

    accepted.resolve(jsonResponse(200, {}))
    await waitFor(() => expect(screen.queryByText('first post')).toBeNull())

    const loaded = feedCalls().length
    fireEvent.keyDown(window, { key: 'R' })
    fireEvent.keyDown(window, { key: 'R' })
    await waitFor(() => expect(feedCalls()).toHaveLength(loaded + 1))
    // a refresh starts a clean deck from the newest page, cursor-free
    expect(new URL(feedCalls().at(-1)?.url ?? '').searchParams.get('cursor')).toBeNull()
    await screen.findByText('first post')
    expect(screen.getByText('second post')).toBeInTheDocument()
  })

  it('shows the rest label on the narrow refresh button', async () => {
    stubWide(false)
    routeAlphaPosts()
    renderFeed()
    await screen.findByText('alpha post')

    const button = screen.getByRole('button', { name: 'refresh feed' })
    // at rest the narrow control spells out the shortcut and is not armed
    await waitFor(() => expect(button).toHaveTextContent('press R to refresh'))

    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'refresh feed' })).toHaveTextContent('refresh again')
  })

  it('relabels the narrow refresh button while armed', async () => {
    stubWide(false)
    routeAlphaPosts()
    renderFeed()
    await screen.findByText('alpha post')
    const loaded = feedCalls().length

    fireEvent.click(screen.getByRole('button', { name: 'refresh feed' }))
    expect(screen.getByRole('button', { name: 'refresh feed' })).toHaveTextContent('refresh again')
    expect(feedCalls()).toHaveLength(loaded)

    fireEvent.click(screen.getByRole('button', { name: 'refresh feed' }))
    await waitFor(() => expect(feedCalls()).toHaveLength(loaded + 1))
  })

  it('disarms after five seconds', async () => {
    routeAlphaPosts()
    renderFeed()
    await screen.findByText('alpha post')

    vi.useFakeTimers()
    fireEvent.keyDown(window, { key: 'R' })
    expect(screen.getByText('press R again to refresh')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText('press R again to refresh')).toBeNull()
  })

  it('cancels on escape without leaving the feed', async () => {
    routeAlphaPosts()
    const { onEscape, history } = renderFeed()
    await screen.findByText('alpha post')

    fireEvent.keyDown(window, { key: 'R' })
    expect(screen.getByText('press R again to refresh')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('press R again to refresh')).toBeNull()
    expect(onEscape).not.toHaveBeenCalled()
    expect(history()).not.toContain('/feed?')
  })

  it('cancels when the feed changes', async () => {
    stubWide(false)
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, (request) => {
      const feed = new URL(request.url).searchParams.get('feed')
      const text = feed === FEED_B ? 'beta post' : 'alpha post'
      return jsonResponse(200, { feed: [{ post: wirePost(feed === FEED_B ? 2 : 1, text) }] })
    })
    renderFeed()
    await screen.findByText('alpha post')

    fireEvent.keyDown(window, { key: 'R' })
    expect(screen.getByText('press R again to refresh')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'beta' }))
    await screen.findByText('beta post')
    expect(screen.queryByText('press R again to refresh')).toBeNull()
  })
})

describe('FeedView feed feedback', () => {
  it('sends more feedback through the pds to the pinned generator', async () => {
    const first = wirePost(1, 'first post')
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: first, feedContext: 'ctx-1', reqId: 'req-1' }] }),
    )
    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () =>
      jsonResponse(200, {}),
    )
    renderFeed()

    await screen.findByText('first post')
    fireEvent.keyDown(window, { key: '+' })

    await waitFor(() => expect(feedbackCalls()).toHaveLength(1))
    const [call] = feedbackCalls()
    expect(call?.method).toBe('POST')
    expect(call?.headers['atproto-proxy']).toBe('did:web:feeds.test#bsky_fg')
    expect(JSON.parse(call?.body ?? '')).toEqual({
      feed: FEED_A,
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

  it('dismisses the focused card only after a less signal is accepted', async () => {
    const second = wirePost(2, 'second post')
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, {
        feed: [{ post: wirePost(1, 'first post') }, { post: second }],
      }),
    )
    const gate = Promise.withResolvers<Response>()
    transport.route('POST', `${PDS}/xrpc/app.bsky.feed.sendInteractions`, () => gate.promise)
    renderFeed()

    await screen.findByText('first post')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: '-' })

    await waitFor(() => expect(feedbackCalls()).toHaveLength(1))
    expect(screen.getByText('second post')).toBeInTheDocument()

    gate.resolve(jsonResponse(200, {}))
    await waitFor(() => expect(screen.queryByText('second post')).toBeNull(), { timeout: 2000 })
    expect(screen.getByText('first post')).toBeInTheDocument()
  })

  it.each([
    ['refuses interactions', { acceptsInteractions: false }],
    ['has no service did', { did: undefined }],
  ])('withholds feedback when the generator %s', async (_label, overrides) => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeedGenerators`, () =>
      jsonResponse(200, { feeds: [generator(FEED_A, overrides)] }),
    )
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [{ post: wirePost(1, 'pinned post') }] }),
    )
    renderFeed()

    await screen.findByText('pinned post')
    expect(screen.queryByLabelText('more like this')).toBeNull()
    expect(screen.queryByLabelText('less like this')).toBeNull()
  })
})

describe('FeedView feed switcher', () => {
  it('lists only pinned feeds with avatar, name and description', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    renderFeed()

    await screen.findByLabelText('posts')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await screen.findByLabelText('feed cards')

    expect(screen.getByLabelText('open alpha')).toBeInTheDocument()
    expect(screen.getByLabelText('open beta')).toBeInTheDocument()
    expect(screen.getByText('a pinned feed for alpha')).toBeInTheDocument()
    // the chooser has no preview, kind tag, discover fallback or add entry
    expect(screen.queryByLabelText('recent posts')).toBeNull()
    expect(screen.queryByText('discover')).toBeNull()
    expect(screen.queryByText('add feed')).toBeNull()
    expect(screen.queryByText('pinned')).toBeNull()
  })

  it('deals the chosen pinned feed back into the posts deck', async () => {
    transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, (request) => {
      const feed = new URL(request.url).searchParams.get('feed')
      const text = feed === FEED_B ? 'beta post' : 'alpha post'
      return jsonResponse(200, { feed: [{ post: wirePost(feed === FEED_B ? 2 : 1, text) }] })
    })
    const { history } = renderFeed()

    await screen.findByLabelText('posts')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await screen.findByLabelText('feed cards')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'Enter' })

    await screen.findByText('beta post')
    expect(history().at(-1)).toContain(`uri=${encodeURIComponent(FEED_B)}`)
  })
})
