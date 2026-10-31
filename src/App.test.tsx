import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { appHistoryDepth, withAppHistory } from './lib/history'
import { useSettings } from './lib/store'
import { useUiStore } from './lib/ui'
import { installTransport, jsonResponse } from './test/transport'

const APPVIEW = 'https://api.bsky.app'

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

afterEach(() => {
  vi.useRealTimers()
  window.history.pushState({}, '', '/')
  useUiStore.setState({ dialog: null, compose: null, inlineCompose: null })
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

describe('global keyboard routing', () => {
  it('sends / to search instead of the command palette', async () => {
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
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('discover cards')

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
    const transport = installTransport()
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
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('discover cards')

      act(() => {
        window.history.pushState({}, '', '/notifications')
      })
      await screen.findByText('sign in for notifications')

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
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('discover cards')
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
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('discover cards')
      const main = screen.getByRole('main')
      expect(main).not.toHaveFocus()

      act(() => {
        window.history.pushState({}, '', '/notifications')
      })
      await screen.findByText('sign in for notifications')
      await waitFor(() => expect(main).toHaveFocus())
    } finally {
      view.unmount()
    }
  })

  it('leaves focus in the query field and on same-path query updates', async () => {
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('discover cards')

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
    const transport = installTransport()
    transport.route('GET', `${APPVIEW}/xrpc/app.bsky.feed.getFeed`, () =>
      jsonResponse(200, { feed: [] }),
    )
    window.history.pushState({}, '', '/feed')
    const view = render(<App />)
    try {
      await screen.findByLabelText('discover cards')
      expect(appHistoryDepth()).toBe(0)

      fireEvent.keyDown(document.body, { key: '/' })
      await waitFor(() => expect(window.location.pathname).toBe('/search'))
      expect(appHistoryDepth()).toBe(1)
    } finally {
      view.unmount()
    }
  })

  it('replaces a direct-load thread with the feed and never walks foreign history', async () => {
    installTransport()
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
