import { QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import App from './App'
import { Deck } from './components/Deck'
import { PostCard } from './components/PostCard'
import { SettingsDialog } from './components/SettingsDialog'
import { AUTH_STORAGE_KEY, useAuthStore } from './lib/auth'
import { inviteDigest, resetBetaInvites } from './lib/betaAccess'
import { useUiStore } from './lib/ui'
import { resolveSrgbColor } from './test/colors'
import { postFixture } from './test/fixtures'
import { createTestQueryClient } from './test/queryClient'
import { renderStage } from './test/stage'
import { installTransport, jsonResponse } from './test/transport'

async function mountApp(): Promise<() => void> {
  window.history.pushState({}, '', '/search')
  let unmount = () => {}
  await act(async () => {
    unmount = render(<App />).unmount
  })
  return unmount
}

describe('app shell', () => {
  it('gives main the route context after a cross-route swap', async () => {
    const unmount = await mountApp()
    try {
      const main = document.querySelector<HTMLElement>('.b-main')
      if (main === null) throw new Error('main missing')
      // the search field owns focus while its route is on screen
      expect(document.activeElement).not.toBe(main)

      await act(async () => {
        window.history.pushState({}, '', '/notifications')
      })
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(main)
      })
      // the focus move never scrolls the shell
      expect(window.scrollY).toBe(0)
    } finally {
      unmount()
    }
  })

  it('keeps escape owned by the open settings dialog', async () => {
    const unmount = await mountApp()
    try {
      await act(async () => {
        useUiStore.getState().openDialog('settings')
      })
      await vi.waitFor(() => {
        expect(document.querySelector('dialog[open]')).not.toBeNull()
      })
      expect(window.location.pathname).toBe('/search')

      await userEvent.keyboard('{Escape}')

      await vi.waitFor(() => {
        expect(document.querySelector('dialog[open]')).toBeNull()
      })
      // the app-level escape must not have taken the route away
      expect(window.location.pathname).toBe('/search')
    } finally {
      unmount()
    }
  })

  it('paints the settings rules from the stylesheet', async () => {
    // open through the store action the top bar and command palette call
    await act(async () => {
      useUiStore.getState().openDialog('settings')
    })
    const view = renderStage(
      <SettingsDialog
        open={useUiStore.getState().dialog === 'settings'}
        onClose={() => {
          useUiStore.getState().closeDialog()
        }}
      />,
    )
    try {
      await vi.waitFor(() => {
        expect(document.querySelector('dialog[open].b-settings')).not.toBeNull()
      })

      const section = document.querySelector<HTMLElement>('.b-settings__section')
      const search = document.querySelector<HTMLElement>('.b-settings__search')
      const mode = document.querySelector<HTMLElement>('.b-settings__mode')
      const note = document.querySelector<HTMLElement>('.b-settings__note')
      if (section === null || search === null || mode === null || note === null) {
        throw new Error('settings markup missing')
      }

      // an unclosed comment above the settings rules used to swallow the whole
      // block, leaving these elements at their browser defaults
      const sectionStyle = getComputedStyle(section)
      expect(sectionStyle.display).toBe('flex')
      expect(sectionStyle.flexDirection).toBe('column')
      expect(getComputedStyle(search).display).toBe('flex')

      const modeStyle = getComputedStyle(mode)
      expect(modeStyle.borderTopStyle).toBe('solid')
      expect(modeStyle.borderTopWidth).toBe('1px')
      // the mode chip paints the void surface, not the default button face
      const voidColor = getComputedStyle(document.documentElement).getPropertyValue('--void').trim()
      expect(resolveSrgbColor(modeStyle.backgroundColor)).toEqual(resolveSrgbColor(voidColor))
      // its muted label colour is the same token the section notes paint
      expect(resolveSrgbColor(modeStyle.color)).toEqual(
        resolveSrgbColor(getComputedStyle(note).color),
      )
    } finally {
      await act(async () => {
        useUiStore.getState().closeDialog()
      })
      view.unmount()
    }
  })
})

// the lists every signed-in route reads; the anonymous gate must request none
const LIST_METHODS = [
  'app.bsky.feed.getFeed',
  'app.bsky.feed.getAuthorFeed',
  'app.bsky.feed.searchPosts',
]

function listRequests(calls: readonly { url: string }[]): string[] {
  return calls
    .map((call) => call.url)
    .filter((url) => LIST_METHODS.some((method) => url.includes(method)))
}

describe('portal restore notice layout', () => {
  it.each([
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ])(
    'keeps the notice above the authenticated route at $width × $height',
    async ({ width, height }) => {
      await page.viewport(width, height)
      const transport = installTransport()
      const pds = 'https://pds.test'
      const session = {
        did: 'did:plc:shell',
        handle: 'shell.test',
        accessJwt: 'shell-access',
        refreshJwt: 'shell-refresh',
        active: true,
      }
      transport.route('GET', `https://plc.directory/${session.did}`, () =>
        jsonResponse(200, {
          id: session.did,
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds },
          ],
        }),
      )
      transport.route('POST', `${pds}/xrpc/com.atproto.server.createSession`, () =>
        jsonResponse(200, session),
      )
      transport.route('GET', `${pds}/xrpc/app.bsky.actor.getPreferences`, () =>
        jsonResponse(200, { preferences: [] }),
      )
      transport.route('GET', `${pds}/xrpc/app.bsky.feed.getFeed`, () =>
        jsonResponse(200, { feed: [] }),
      )
      // the shipped invitation list would refuse this fixture account, so the
      // case ships its own list naming it
      // the list is cached per page load, and this page has already loaded once
      resetBetaInvites()
      transport.route('GET', `${window.location.origin}/beta/invites.json`, async () =>
        jsonResponse(200, { sha256: [await inviteDigest(session.did)] }),
      )
      await useAuthStore.getState().signIn(session.did, 'app-pass')
      useAuthStore.setState({ restoreError: 'could not reach the portal' })
      window.history.pushState({}, '', '/feed')
      let unmount = () => {}
      await act(async () => {
        unmount = render(<App />).unmount
      })
      try {
        await vi.waitFor(() => expect(document.querySelector('.b-main > .b-view')).not.toBeNull())
        const main = document.querySelector<HTMLElement>('.b-main')
        const notice = document.querySelector<HTMLElement>('.b-shell-notice')
        const route = document.querySelector<HTMLElement>('.b-main > .b-view')
        if (main === null || notice === null || route === null) throw new Error('shell missing')
        const bounds = main.getBoundingClientRect()
        const noticeRect = notice.getBoundingClientRect()
        const routeRect = route.getBoundingClientRect()
        expect(document.querySelectorAll('.b-shell-notice [role="alert"]')).toHaveLength(1)
        expect(noticeRect.height).toBeGreaterThan(0)
        expect(routeRect.height).toBeGreaterThan(0)
        expect(noticeRect.top).toBeGreaterThanOrEqual(bounds.top)
        expect(noticeRect.bottom).toBeLessThanOrEqual(routeRect.top)
        expect(routeRect.bottom).toBeLessThanOrEqual(bounds.bottom + 1)
        expect(noticeRect.left).toBeGreaterThanOrEqual(bounds.left)
        expect(noticeRect.right).toBeLessThanOrEqual(bounds.right)
        expect(document.querySelector('dialog[open]')).toBeNull()

        await act(async () => useAuthStore.getState().clearError())

        expect(document.querySelector('.b-shell-notice')).toBeNull()
        expect(route.getBoundingClientRect().height).toBeGreaterThan(routeRect.height)
        expect(route.getBoundingClientRect().height).toBeCloseTo(bounds.height, 0)
        expect(document.querySelector('dialog[open]')).toBeNull()
      } finally {
        unmount()
      }
    },
  )
})

describe('shell auth gate', () => {
  it('gates an anonymous session and opens the login dialog without reading a list', async () => {
    const transport = installTransport()
    // signed out for real: no stored session, and no restore pass that would
    // flash the progress gate before settling on anonymous
    localStorage.removeItem(AUTH_STORAGE_KEY)
    useAuthStore.setState({
      status: 'anonymous',
      account: null,
      pending: false,
      error: null,
      restoreError: null,
      restore: () => Promise.resolve(),
    })

    window.history.pushState({}, '', '/feed')
    let unmount = () => {}
    await act(async () => {
      unmount = render(<App />).unmount
    })
    try {
      await vi.waitFor(() => {
        expect(document.querySelector('.b-signedout-card')).not.toBeNull()
      })
      const gate = document.querySelector<HTMLButtonElement>('.b-signedout-card')
      if (gate === null) throw new Error('sign-in gate missing')
      // painted, readable, and the only thing behind the shell's top bar
      expect(gate.getBoundingClientRect().height).toBeGreaterThan(0)
      expect(gate.textContent).toContain('sign in to read benday')
      expect(gate.textContent).toContain('the people you follow')
      expect(document.querySelector('.b-view')).toBeNull()
      // no route mounted, so no feed, search or profile list was asked for
      expect(listRequests(transport.calls)).toEqual([])
      expect(transport.calls).toHaveLength(0)
      // nothing has asked for the dialog yet
      expect(document.querySelector('dialog[open]')).toBeNull()
      const compose = document.querySelector<HTMLButtonElement>('button[aria-label="compose"]')
      const jump = document.querySelector<HTMLButtonElement>('button[aria-label="jump"]')
      const notifications = document.querySelector<HTMLAnchorElement>('a[href="/notifications"]')
      const help = document.querySelector<HTMLButtonElement>('button[aria-label="keyboard help"]')
      const settings = document.querySelector<HTMLButtonElement>('button[aria-label="settings"]')
      if (
        compose === null ||
        jump === null ||
        notifications === null ||
        help === null ||
        settings === null
      ) {
        throw new Error('top bar actions missing')
      }
      expect(compose.disabled).toBe(true)
      expect(jump.disabled).toBe(true)
      expect(help.disabled).toBe(false)
      expect(settings.disabled).toBe(false)
      notifications.focus()
      await userEvent.keyboard('{Tab}')
      expect(document.activeElement).toBe(help)
      await userEvent.keyboard('{Tab}')
      expect(document.activeElement).toBe(settings)
      await userEvent.keyboard('{Tab}')
      expect(document.activeElement).toBe(gate)
      expect(useUiStore.getState()).toMatchObject({ dialog: null, compose: null })
      expect(transport.calls).toHaveLength(0)

      // the whole card is the sign-in control
      await userEvent.click(gate)

      await vi.waitFor(() => {
        expect(document.querySelector('dialog[open].b-auth')).not.toBeNull()
      })
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open].b-auth')
      if (dialog === null) throw new Error('login dialog missing')
      expect(dialog.open).toBe(true)
      expect(dialog.querySelector('input[autocomplete="username"]')).not.toBeNull()
      expect(dialog.querySelector('input[type="password"]')).not.toBeNull()
      expect(useUiStore.getState().dialog).toBe('login')
      // opening the dialog is local: still nothing was read
      expect(listRequests(transport.calls)).toEqual([])
    } finally {
      unmount()
    }
  })
})

const STILL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

/**
 * The app-wide reduced-motion rule floors every transition at 0.01ms so
 * transitionend listeners still fire, which Chrome serialises as `1e-05s`.
 * Suppressed motion therefore reads as that floor, never as the theme's
 * `--motion-dur`.
 */
function transitionMs(duration: string): number {
  const first = (duration.split(',')[0] ?? '0s').trim()
  const value = Number.parseFloat(first)
  return first.endsWith('ms') ? value : value * 1000
}

describe('reduced motion', () => {
  it('fills the deck and opens the viewer without starting an animation', async () => {
    // the browser project asks for reduced motion; a silent change here would
    // make every assertion below pass without proving the bypass
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)

    const queryClient = createTestQueryClient()
    const memory = memoryLocation({ path: '/feed' })
    const post = postFixture({
      text: 'card with a still',
      embed: {
        type: 'images',
        images: [{ thumb: STILL, fullsize: STILL, alt: 'a still', width: 8, height: 8 }],
      },
    })

    renderStage(
      <QueryClientProvider client={queryClient}>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <section className="b-view">
            <div className="b-view__body">
              <Deck
                items={[post]}
                getKey={(item) => item.uri}
                renderItem={(item, index, focused) => (
                  <PostCard post={item} index={index} focused={focused} />
                )}
                label="cards"
              />
            </div>
          </section>
        </Router>
      </QueryClientProvider>,
    )

    const item = document.querySelector<HTMLElement>('.b-deck__item')
    if (item === null) throw new Error('deck item missing')
    const itemStyle = getComputedStyle(item)
    expect(item.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(itemStyle.animationName).toBe('none')
    expect(transitionMs(itemStyle.transitionDuration)).toBeLessThanOrEqual(0.01)
    expect(item.getAnimations()).toHaveLength(0)
    // and it is painted at full weight straight away, not mid-fade
    expect(Number.parseFloat(itemStyle.opacity)).toBe(1)

    // the real shortcut on the focused card opens the real viewer
    await userEvent.keyboard('m')

    const stage = document.querySelector<HTMLElement>('.b-media-viewer__stage')
    if (stage === null) throw new Error('viewer stage missing')
    await vi.waitFor(() => {
      expect(stage.closest('dialog')?.open).toBe(true)
    })
    expect(stage.getBoundingClientRect().height).toBeGreaterThan(0)

    const stageStyle = getComputedStyle(stage)
    expect(stageStyle.animationName).toBe('none')
    expect(transitionMs(stageStyle.transitionDuration)).toBeLessThanOrEqual(0.01)
    // a zero-duration transition may exist for the opening frame; nothing may
    // still be running once the dialog has settled
    await vi.waitFor(() => {
      expect(
        stage.getAnimations().filter((animation) => animation.playState === 'running'),
      ).toHaveLength(0)
    })
    expect(Number.parseFloat(stageStyle.opacity)).toBe(1)
  })
})
