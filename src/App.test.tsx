import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useAuthStore } from './lib/auth'
import { appHistoryDepth, withAppHistory } from './lib/history'
import { useSettings } from './lib/store'
import { useUiStore } from './lib/ui'
import { installTransport, jsonResponse, type TestTransport } from './test/transport'

const APPVIEW = 'https://api.bsky.app'

// a thread or profile the AppView cannot answer still renders its titled shell,
// which is what these routes are asserting
function routeUnavailableRouteReads(transport: TestTransport): void {
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getPostThread`, () =>
    jsonResponse(200, {
      thread: { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'at://missing', notFound: true },
    }),
  )
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.actor.getProfile`, () =>
    jsonResponse(400, { error: 'InvalidRequest', message: 'invalid actor' }),
  )
  transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed`, () =>
    jsonResponse(400, { error: 'InvalidRequest', message: 'invalid actor' }),
  )
}

function stubMatchMedia(prefersLight: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-color-scheme: light') ? prefersLight : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

function rootTheme(): string | undefined {
  return document.documentElement.dataset['theme']
}

const REAL_RESTORE = useAuthStore.getState().restore
const PDS = 'https://pds.test'
const SESSION = {
  did: 'did:plc:shell',
  handle: 'shell.test',
  accessJwt: 'shell-access',
  refreshJwt: 'shell-refresh',
  active: true,
}

/**
 * The shell only renders routes for a signed-in account. These cases exercise
 * the shell rather than the reads, so the account signs in against a routed pds
 * and the surfaces the shell always mounts answer with empty pages.
 */
async function signInShell(): Promise<TestTransport> {
  const transport = installTransport()
  transport.route('POST', `${PDS}/xrpc/com.atproto.server.createSession`, () =>
    jsonResponse(200, SESSION),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getPreferences`, () =>
    jsonResponse(200, { preferences: [] }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getFeed`, () => jsonResponse(200, { feed: [] }))
  transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getProfiles`, () =>
    jsonResponse(200, { profiles: [] }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.feed.getPosts`, () =>
    jsonResponse(200, { posts: [] }),
  )
  transport.route('GET', `${PDS}/xrpc/app.bsky.notification.listNotifications`, () =>
    jsonResponse(200, { notifications: [] }),
  )
  transport.route('GET', `https://plc.directory/${SESSION.did}`, () =>
    jsonResponse(200, {
      id: SESSION.did,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
    }),
  )
  const ok = await useAuthStore.getState().signIn(SESSION.did, 'app-pass')
  expect(ok).toBe(true)
  return transport
}

afterEach(() => {
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null })
  useAuthStore.setState({ status: 'anonymous', account: null, restore: REAL_RESTORE })
})

describe('live appearance on a fresh session', () => {
  it('rolls an October theme back at local midnight and restores it in October', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 40))
    stubMatchMedia(false)
    useSettings.setState({
      appearance: 'system',
      lightTheme: 'bone',
      darkTheme: 'dead-leaves',
      theme: 'dead-leaves',
    })
    window.history.pushState({}, '', '/search')

    const view = render(<App />)
    try {
      expect(rootTheme()).toBe('dead-leaves')

      // 20s to midnight plus the 1000ms settling offset
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(useSettings.getState().theme).toBe('void')
      expect(useSettings.getState().darkTheme).toBe('dead-leaves')
      expect(rootTheme()).toBe('void')

      // the same tab, brought back into view on 1 october
      vi.setSystemTime(new Date(2027, 9, 1, 0, 0, 30))
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(useSettings.getState().theme).toBe('dead-leaves')
      expect(rootTheme()).toBe('dead-leaves')
    } finally {
      view.unmount()
    }

    // an unmounted app no longer tracks midnight or visibility
    const settled = useSettings.getState().theme
    vi.setSystemTime(new Date(2027, 10, 1, 0, 0, 30))
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(useSettings.getState().theme).toBe(settled)
  })

  it('expires an explicitly chosen October dark theme on a live tab', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 40))
    stubMatchMedia(false)
    useSettings.setState({
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'dead-leaves',
      theme: 'dead-leaves',
    })
    window.history.pushState({}, '', '/search')

    const view = render(<App />)
    try {
      expect(rootTheme()).toBe('dead-leaves')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(useSettings.getState().theme).toBe('void')
      expect(useSettings.getState().darkTheme).toBe('dead-leaves')
      expect(rootTheme()).toBe('void')

      // and the saved pair comes back when October returns
      vi.setSystemTime(new Date(2027, 9, 1, 0, 0, 30))
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(useSettings.getState().darkTheme).toBe('dead-leaves')
      expect(rootTheme()).toBe('dead-leaves')
    } finally {
      view.unmount()
    }
  })
})

describe('shell auth gate', () => {
  it('shows restore progress and no route while the session restores', () => {
    useAuthStore.setState({
      status: 'restoring',
      account: null,
      pending: false,
      error: null,
      restore: () => new Promise<void>(() => {}),
    })
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      expect(screen.getByRole('progressbar', { name: 'restoring session' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'sign in to read benday' })).toBeNull()
      expect(document.querySelector('.b-view')).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('gates an anonymous session and reads no list behind the gate', async () => {
    const transport = installTransport()
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      const gate = await screen.findByRole('button', { name: 'sign in to read benday' })
      expect(document.querySelector('.b-view')).toBeNull()
      expect(transport.calls).toHaveLength(0)

      fireEvent.click(gate)
      await waitFor(() => expect(useUiStore.getState().dialog).toBe('login'))
      expect(transport.calls).toHaveLength(0)
    } finally {
      view.unmount()
    }
  })

  it('renders the route for an authenticated session', async () => {
    await signInShell()
    window.history.pushState({}, '', '/search')
    const view = render(<App />)
    try {
      expect(await screen.findByLabelText('query')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'sign in to read benday' })).toBeNull()
    } finally {
      view.unmount()
    }
  })
})

describe('global keyboard routing', () => {
  it('sends / to search instead of the command palette', async () => {
    await signInShell()
    window.history.pushState({}, '', '/search')
    const view = render(<App />)
    try {
      fireEvent.keyDown(document.body, { key: '/' })

      expect(useUiStore.getState().dialog).toBeNull()
      const input = document.querySelector<HTMLInputElement>('.b-view__form .b-input__control')
      expect(input).not.toBeNull()
      await waitFor(() => {
        expect(input).toHaveFocus()
      })
    } finally {
      view.unmount()
    }
  })

  it('goes to search and focuses the query field from the feed', async () => {
    const transport = await signInShell()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')

      fireEvent.keyDown(document.body, { key: '/' })

      await waitFor(() => expect(window.location.pathname).toBe('/search'))
      await waitFor(() => {
        expect(document.querySelector('.b-view__form .b-input__control')).toHaveFocus()
      })
    } finally {
      view.unmount()
    }
  })

  it('toggles the palette with ctrl+k', async () => {
    await signInShell()
    window.history.pushState({}, '', '/search')
    const view = render(<App />)
    try {
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
      await waitFor(() => {
        expect(useUiStore.getState().dialog).toBe('palette')
      })

      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
      await waitFor(() => {
        expect(useUiStore.getState().dialog).toBeNull()
      })
    } finally {
      view.unmount()
    }
  })

  it('does not cycle tabs from an editable field', async () => {
    await signInShell()
    window.history.pushState({}, '', '/search')
    const view = render(<App />)
    try {
      const input = document.querySelector<HTMLInputElement>('.b-view__form .b-input__control')
      expect(input).not.toBeNull()
      input?.focus()

      fireEvent.keyDown(input as HTMLInputElement, { key: 'ArrowRight', ctrlKey: true })
      await act(async () => {
        await Promise.resolve()
      })

      expect(window.location.pathname).toBe('/search')
    } finally {
      view.unmount()
    }
  })
})

describe('escape precedence stack', () => {
  it('clears a committed search query, then blurs the field, and stays on search', async () => {
    const transport = await signInShell()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.searchPosts`, () =>
      jsonResponse(200, { posts: [] }),
    )
    window.history.pushState({}, '', '/search?q=cats')
    const view = render(<App />)
    try {
      const field = await screen.findByLabelText<HTMLInputElement>('query')
      expect(field.value).toBe('cats')
      expect(field).toHaveFocus()

      // the search field with text clears the query and keeps the route
      fireEvent.keyDown(field, { key: 'Escape' })

      expect(field.value).toBe('')
      expect(window.location.pathname).toBe('/search')
      expect(window.location.search).toBe('')
      expect(field).toHaveFocus()

      // a second escape in the cleared field steps back to the results deck
      fireEvent.keyDown(field, { key: 'Escape' })

      expect(document.activeElement).not.toBe(field)
      expect(window.location.pathname).toBe('/search')
      expect(window.location.search).toBe('')
    } finally {
      view.unmount()
    }
  })

  it('returns from notifications to the previous tab and never leaves the feed', async () => {
    const transport = await signInShell()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')

      act(() => {
        window.history.pushState({}, '', '/notifications')
      })
      await screen.findByText('nothing yet')

      // an input method that is still composing owns the key
      fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true })
      await act(async () => {
        await Promise.resolve()
      })
      expect(window.location.pathname).toBe('/notifications')

      fireEvent.keyDown(document.body, { key: 'Escape' })
      await waitFor(() => expect(window.location.pathname).toBe('/feed'))

      // a feed deck is the bottom of the app, so escape cannot walk history
      fireEvent.keyDown(document.body, { key: 'Escape' })
      await act(async () => {
        await Promise.resolve()
      })
      expect(window.location.pathname).toBe('/feed')
    } finally {
      view.unmount()
    }
  })

  it('closes the palette with escape without changing route', async () => {
    await signInShell()
    window.history.pushState({}, '', '/search')
    const view = render(<App />)
    try {
      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
      await waitFor(() => expect(useUiStore.getState().dialog).toBe('palette'))

      fireEvent.keyDown(document.body, { key: 'Escape' })

      await waitFor(() => expect(useUiStore.getState().dialog).toBeNull())
      expect(window.location.pathname).toBe('/search')
    } finally {
      view.unmount()
    }
  })
})

describe('route title', () => {
  it('titles each route and the committed query', async () => {
    const transport = await signInShell()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    routeUnavailableRouteReads(transport)
    transport.route('GET', `${PDS}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(400, { error: 'InvalidRequest', message: 'invalid actor' }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')
      expect(document.title).toBe('benday // feeds')

      act(() => {
        window.history.pushState({}, '', '/search?q=%20cats%20')
      })
      await waitFor(() => expect(document.title).toBe('benday // search · cats'))

      act(() => {
        window.history.pushState({}, '', '/search')
      })
      await waitFor(() => expect(document.title).toBe('benday // search'))

      act(() => {
        window.history.pushState({}, '', '/notifications')
      })
      await waitFor(() => expect(document.title).toBe('benday // notifications'))

      act(() => {
        window.history.pushState({}, '', '/thread?uri=x')
      })
      await waitFor(() => expect(document.title).toBe('benday // thread'))

      // a malformed actor escape is shown as typed instead of throwing
      act(() => {
        window.history.pushState({}, '', '/profile/%E0%A4%A')
      })
      await waitFor(() => expect(document.title).toBe('benday // @%E0%A4%A'))

      act(() => {
        window.history.pushState({}, '', '/nowhere')
      })
      await waitFor(() => expect(document.title).toBe('benday // nothing here'))
    } finally {
      view.unmount()
    }
  })
})

describe('route context focus', () => {
  it('focuses the new route container when nothing in it claimed focus', async () => {
    const transport = await signInShell()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')
      const main = screen.getByRole('main')
      expect(main).not.toHaveFocus()

      act(() => {
        window.history.pushState({}, '', '/notifications')
      })
      await screen.findByText('nothing yet')
      await waitFor(() => expect(main).toHaveFocus())
    } finally {
      view.unmount()
    }
  })

  it('leaves focus in the query field and on same-path query updates', async () => {
    const transport = await signInShell()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')

      act(() => {
        window.history.pushState({}, '', '/search')
      })
      const field = await screen.findByLabelText<HTMLInputElement>('query')
      await waitFor(() => expect(field).toHaveFocus())
      expect(screen.getByRole('main')).not.toHaveFocus()

      // a same-path query update rewrites the title without moving focus
      act(() => {
        window.history.pushState({}, '', '/search?q=cats')
      })
      await waitFor(() => expect(document.title).toBe('benday // search · cats'))
      expect(field).toHaveFocus()
    } finally {
      view.unmount()
    }
  })
})

describe('app history', () => {
  it('stamps an app navigation with its entry depth', async () => {
    const transport = await signInShell()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')
      expect(appHistoryDepth()).toBe(0)

      fireEvent.keyDown(document.body, { key: '/' })
      await waitFor(() => expect(window.location.pathname).toBe('/search'))
      expect(appHistoryDepth()).toBe(1)
    } finally {
      view.unmount()
    }
  })

  it('replaces a direct-load thread with the feed and never walks foreign history', async () => {
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    routeUnavailableRouteReads(transport)
    window.history.pushState({ foreign: true }, '', '/some-foreign-page')
    window.history.pushState(
      {},
      '',
      '/thread?uri=at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp.bsky.feed.post%2F1',
    )

    const view = render(<App />)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      await waitFor(() => expect(window.location.pathname).toBe('/feed'))
      // the entry was replaced as an app-owned depth zero entry, not pushed
      expect(appHistoryDepth()).toBe(0)

      // and no native back is in flight towards the foreign page
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })
      expect(window.location.pathname).toBe('/feed')
    } finally {
      view.unmount()
    }
  })

  it('walks one real app entry back from a thread reached in-app', async () => {
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    routeUnavailableRouteReads(transport)
    window.history.pushState({}, '', '/feed')
    window.history.pushState(
      withAppHistory(undefined),
      '',
      '/thread?uri=at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp.bsky.feed.post%2F1',
    )

    const view = render(<App />)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      await waitFor(() => expect(window.location.pathname).toBe('/feed'))
      expect(appHistoryDepth()).toBe(0)
    } finally {
      view.unmount()
    }
  })
})

describe('portal restore notice', () => {
  it('reports a failed portal restore outside the dialog and clears when login opens', async () => {
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    useAuthStore.setState({ restoreError: 'could not reach the portal' })

    const view = render(<App />)
    try {
      expect(await screen.findByText('could not restore portal sign-in')).toBeInTheDocument()
      expect(screen.getByText('could not reach the portal')).toBeInTheDocument()
      // the notice is not a modal: the reader was not interrupted
      const login = document.querySelector<HTMLDialogElement>('dialog.b-auth')
      if (login === null) throw new Error('login dialog shell missing')
      expect(login.open).toBe(false)

      act(() => {
        useUiStore.getState().openDialog('login')
      })

      await waitFor(() => expect(login.open).toBe(true))
      // opening login is an explicit new attempt, so the old notice is gone
      expect(screen.queryByText('could not restore portal sign-in')).toBeNull()
    } finally {
      view.unmount()
      useAuthStore.setState({ restoreError: null })
    }
  })
})

describe('route transitions', () => {
  interface TransitionStub {
    updates: Array<() => void>
    skips: number
  }

  function stubTransitions(): TransitionStub {
    const stub: TransitionStub = { updates: [], skips: 0 }
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update: () => void) => {
        stub.updates.push(update)
        return {
          skipTransition: () => {
            stub.skips += 1
          },
          finished: Promise.resolve(),
        }
      },
    })
    return stub
  }

  function clearTransitions(): void {
    Reflect.deleteProperty(document, 'startViewTransition')
  }

  function feedRoutes(): void {
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
  }

  it('drops a queued transition update when a newer direct navigation arrives', async () => {
    await signInShell()
    const stub = stubTransitions()
    feedRoutes()
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')

      fireEvent.click(screen.getByLabelText('search'))
      expect(stub.updates).toHaveLength(1)
      // the animated update is queued, so the route has not moved yet
      expect(window.location.pathname).toBe('/feed')

      // the brand link navigates to the route already on screen: a direct nav
      fireEvent.click(screen.getByLabelText('benday home'))
      expect(stub.skips).toBe(1)

      act(() => {
        stub.updates[0]?.()
      })

      // the superseded callback cannot commit the search route over the feed
      expect(window.location.pathname).toBe('/feed')
    } finally {
      view.unmount()
      clearTransitions()
    }
  })

  it('invalidates a queued transition update on unmount', async () => {
    await signInShell()
    const stub = stubTransitions()
    feedRoutes()
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('posts')
      fireEvent.click(screen.getByLabelText('search'))
      expect(stub.updates).toHaveLength(1)

      view.unmount()
      act(() => {
        stub.updates[0]?.()
      })

      expect(window.location.pathname).toBe('/feed')
    } finally {
      clearTransitions()
    }
  })
})
