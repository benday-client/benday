import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { type AroundNavHandler, Link, Route, Router, Switch, useLocation, useSearch } from 'wouter'
import { AccountDialog } from './components/AccountDialog'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { CommandPalette } from './components/CommandPalette'
import { ComposeDialog } from './components/ComposeDialog'
import { DitherDefs } from './components/DitherDefs'
import { HelpDialog } from './components/HelpDialog'
import { KeyHints } from './components/KeyHints'
import { LoginDialog } from './components/LoginDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SignedOutCard } from './components/SignedOutCard'
import { TopBar } from './components/TopBar'
import { EmptyState, ErrorNotice, Progress } from './components/ui'
import { useAccountLabelers } from './hooks/useAccountLabelers'
import { isEditableTarget, useHotkeys } from './hooks/useHotkeys'
import { useAuthStore } from './lib/auth'
import { goBackOrFallback, THREAD_FALLBACK_VIEW, withAppHistory } from './lib/history'
import {
  bindingFor,
  globalHotkeys,
  matchesBinding,
  matchesChord,
  type PrimaryModifier,
} from './lib/keymap'
import { useSettings } from './lib/store'
import { themeColor } from './lib/themes'
import { uiOwnsKeyboard, useUiStore } from './lib/ui'
import FeedView from './views/FeedView'
import NotificationsView from './views/NotificationsView'
import ProfileView from './views/ProfileView'
import SearchView from './views/SearchView'
import ThreadView from './views/ThreadView'

const TAB_ROUTES = ['/feed', '/search', '/notifications'] as const

// Read the platform once: meta on macOS, ctrl everywhere else. Allowing both
// would shadow the macOS Spaces gesture for ctrl+arrows.
const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
const PRIMARY_MODIFIER: PrimaryModifier = IS_MAC ? 'meta' : 'ctrl'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 45_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// A route swap is a crossfade: the browser snapshots the leaving screen, the
// update callback commits the arriving route, and the two fade into each
// other. Same-path query updates (the feed switcher, a search submit) are not
// route swaps and stay instant, and browsers without the API — or a reader who
// asks for reduced motion — get the plain render.
function TransitionRouter({ children }: { children: ReactNode }) {
  const pendingRef = useRef<ViewTransition | null>(null)
  const sequenceRef = useRef(0)

  const aroundNav = useCallback<AroundNavHandler>((navigate, to, options) => {
    // every navigation, animated or direct, invalidates the transition it
    // supersedes: a queued update callback must not commit an older route on
    // top of the one that replaced it
    const sequence = ++sequenceRef.current
    const superseded = pendingRef.current
    pendingRef.current = null
    superseded?.skipTransition()

    const target = to.split('?')[0] ?? to
    const animates =
      target !== window.location.pathname &&
      typeof document.startViewTransition === 'function' &&
      !(
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      )

    if (!animates) {
      navigate(to, withAppHistory(options))
      return
    }

    const transition = document.startViewTransition(() => {
      if (sequence !== sequenceRef.current) return
      // the commit has to happen inside the transition, or the browser
      // snapshots the old route twice
      flushSync(() => {
        navigate(to, withAppHistory(options))
      })
    })
    pendingRef.current = transition
    const release = () => {
      if (pendingRef.current === transition) pendingRef.current = null
    }
    // a skipped transition normally fulfills; settle the slot either way
    void transition.finished.then(release, release)
  }, [])

  useEffect(() => {
    return () => {
      // an unmounted router must not let a queued update commit a dead route
      sequenceRef.current += 1
      pendingRef.current?.skipTransition()
      pendingRef.current = null
    }
  }, [])

  return <Router aroundNav={aroundNav}>{children}</Router>
}

function NotFound() {
  return (
    <div className="b-notfound">
      <EmptyState
        title="nothing here"
        hint="that route does not exist in this reader."
        action={<Link href="/feed">back to feeds</Link>}
      />
    </div>
  )
}

/**
 * The browser tab follows the route, not the reverse: the document title is
 * derived from the same pathname and query the views read. A malformed actor
 * escape is shown as typed rather than repaired, and the not-found title is
 * what the empty state says.
 */
function routeTitle(pathname: string, search: string): string {
  if (pathname === '/' || pathname === '/feed' || pathname.startsWith('/feed/')) return 'feeds'
  if (pathname === '/notifications' || pathname.startsWith('/notifications/')) {
    return 'notifications'
  }
  if (pathname === '/search' || pathname.startsWith('/search/')) {
    const query = new URLSearchParams(search).get('q')?.trim() ?? ''
    return query.length > 0 ? `search · ${query}` : 'search'
  }
  if (pathname.startsWith('/profile/')) {
    const raw = pathname.slice('/profile/'.length)
    try {
      return `@${decodeURIComponent(raw)}`
    } catch {
      return `@${raw}`
    }
  }
  if (pathname === '/thread' || pathname.startsWith('/thread/')) return 'thread'
  return 'nothing here'
}

function AppShell() {
  const [pathname, navigate] = useLocation()
  const search = useSearch()
  const dialog = useUiStore((state) => state.dialog)
  const compose = useUiStore((state) => state.compose)
  const inlineCompose = useUiStore((state) => state.inlineCompose)
  const openDialog = useUiStore((state) => state.openDialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const openCompose = useUiStore((state) => state.openCompose)
  const closeCompose = useUiStore((state) => state.closeCompose)
  const mainRef = useRef<HTMLElement | null>(null)
  const landedPathRef = useRef<string | null>(null)
  const baseViewRef = useRef<string | null>(null)
  const previousViewRef = useRef<string | null>(null)
  const previousPathRef = useRef<string | null>(null)
  const previousTabRef = useRef<string | null>(null)
  const authStatus = useAuthStore((state) => state.status)
  const authenticated = authStatus === 'authenticated'
  const restoreError = useAuthStore((state) => state.restoreError)
  useAccountLabelers()

  const theme = useSettings((state) => state.theme)
  const appearance = useSettings((state) => state.appearance)
  const syncSystemTheme = useSettings((state) => state.syncSystemTheme)

  useEffect(() => {
    void useAuthStore.getState().restore()
  }, [])

  useEffect(() => {
    const view = `${pathname}${search.length > 0 ? `?${search}` : ''}`
    // the tab a search or notifications view was opened from is where its
    // Escape returns, so record the one being left before it is replaced
    const previousPath = previousPathRef.current
    if (
      previousPath !== null &&
      previousPath !== pathname &&
      (previousPath === '/feed' ||
        previousPath === '/notifications' ||
        previousPath.startsWith('/profile/'))
    ) {
      previousTabRef.current = previousViewRef.current
    }
    previousPathRef.current = pathname
    previousViewRef.current = view
    if (
      pathname === '/' ||
      pathname.startsWith('/feed') ||
      pathname.startsWith('/search') ||
      pathname.startsWith('/notifications')
    ) {
      baseViewRef.current = view
    }
  }, [pathname, search])

  useEffect(() => {
    // a same-path query update rewrites the title but never moves focus
    document.title = `benday // ${routeTitle(pathname, search)}`
  }, [pathname, search])

  useEffect(() => {
    const main = mainRef.current
    if (main === null) return
    // the first commit is a landing, not a swap: the route focuses itself
    const landed = landedPathRef.current
    landedPathRef.current = pathname
    if (landed === null || landed === pathname) return
    const focusMain = () => {
      // a later route has already committed; its own effect owns focus now
      if (landedPathRef.current !== pathname) return
      // the incoming route may have focused its own control (query field,
      // deck, menu), and that focus is always more useful than the container
      if (main.contains(document.activeElement)) return
      // a store dialog or composer took the keyboard back while we waited
      if (uiOwnsKeyboard()) return
      // a native modal is still in the top layer; its close will hand focus on
      if (document.querySelector('dialog[open]') !== null) return
      main.focus({ preventScroll: true })
    }

    // a live modal keeps the keyboard for itself, so the route change beneath
    // it does not move focus at all
    if (uiOwnsKeyboard()) return

    const closing = document.querySelector('dialog[open]')
    if (closing === null) {
      focusMain()
      return
    }
    // the route changed under a dialog that is animating closed: wait for its
    // one close event, then take focus only if nothing else owns it
    const handleClose = () => focusMain()
    closing.addEventListener('close', handleClose, { once: true })
    return () => closing.removeEventListener('close', handleClose)
  }, [pathname])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta instanceof HTMLMetaElement) meta.content = themeColor(theme)
  }, [theme])

  // a hidden tab catches up on the browser preference once it is visible;
  // there is no timer and no polling
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      syncSystemTheme()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [syncSystemTheme])

  useEffect(() => {
    if (appearance !== 'system' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => {
      syncSystemTheme()
    }
    media.addEventListener('change', handleChange)
    return () => {
      media.removeEventListener('change', handleChange)
    }
  }, [appearance, syncSystemTheme])

  const focusSearch = () => {
    // staying on /search keeps the accepted query in the address bar
    if (!pathname.startsWith('/search')) navigate('/search')
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.b-view__form .b-input__control')
      input?.focus()
    }, 0)
  }

  const changeTab = (direction: number) => {
    const tabs: readonly string[] = TAB_ROUTES
    const profileTab = pathname.startsWith('/profile/') ? pathname : null
    const routes: readonly string[] = profileTab === null ? tabs : [...tabs, profileTab]
    const current = routes.findIndex((route) =>
      route === profileTab
        ? pathname.startsWith('/profile/')
        : pathname === route || pathname.startsWith(`${route}/`),
    )
    const next = (Math.max(current, 0) + direction + routes.length) % routes.length
    const target = routes[next] ?? '/feed'
    // a single available tab must not push the current path again
    if (target === pathname) return
    navigate(target)
  }

  const startCompose = () => {
    openCompose({ mode: 'post', post: null })
  }

  const tabBinding = bindingFor('tabs')

  useEffect(() => {
    if (dialog !== null || compose !== null || inlineCompose !== null) return

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.isComposing || event.keyCode === 229) return
      // a caret word-jump inside a field belongs to the field
      if (isEditableTarget(event.target)) return
      if (document.querySelector('dialog[open]') !== null) return

      const chord = tabBinding.chords.find((candidate) =>
        matchesChord(event, candidate, PRIMARY_MODIFIER),
      )
      if (chord === undefined) return

      event.preventDefault()
      changeTab(chord.key === 'ArrowLeft' ? -1 : 1)
    }

    window.addEventListener('keydown', handleTabKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleTabKey, true)
    }
  }, [dialog, compose, inlineCompose, pathname, authStatus, tabBinding])

  // the palette chord toggles itself closed, so it is matched before the guard
  // chain that an open dialog normally arms. it is a chord, so it may fire from
  // a text field without stealing a character
  useEffect(() => {
    const handlePaletteToggle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.isComposing || event.keyCode === 229) return
      if (!matchesBinding(event, bindingFor('palette'))) return
      // the gate owns the keyboard while nobody is signed in
      if (!authenticated) return

      if (dialog === 'palette') {
        event.preventDefault()
        closeDialog()
        return
      }
      if (dialog !== null || compose !== null || inlineCompose !== null) return
      if (document.querySelector('dialog[open]') !== null) return

      event.preventDefault()
      openDialog('palette')
    }

    window.addEventListener('keydown', handlePaletteToggle, { capture: true })
    return () => {
      window.removeEventListener('keydown', handlePaletteToggle, true)
    }
  }, [dialog, compose, inlineCompose, authenticated, openDialog, closeDialog])

  const closeOrBack = () => {
    if (pathname.startsWith('/profile/')) {
      navigate(baseViewRef.current ?? '/feed')
      return
    }
    if (pathname.startsWith('/thread')) {
      goBackOrFallback(navigate, THREAD_FALLBACK_VIEW)
      return
    }
    // search and notifications step back to the tab they were opened from
    if (pathname.startsWith('/search') || pathname.startsWith('/notifications')) {
      const view = `${pathname}${search.length > 0 ? `?${search}` : ''}`
      const target = previousTabRef.current
      navigate(target !== null && target !== view ? target : '/feed')
      return
    }
    // a feed deck is the bottom of the app: Escape never leaves it
  }

  const backBinding = bindingFor('back')

  // One Escape stack. Every layer above the route claims the key before this
  // bubble listener: the composer's suggestion list and the search field in
  // their own React handlers, a mode switcher in a capture listener, a native
  // dialog through its cancel event. Anything still unconsumed here is the
  // app's own "one level up".
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      // an IME owns the key that commits its composition
      if (event.isComposing || event.keyCode === 229) return
      if (!matchesBinding(event, backBinding)) return

      if (dialog !== null) {
        // the browser would raise cancel for this same key; preventing the
        // keydown suppresses that duplicate and keeps a single close path
        event.preventDefault()
        closeDialog()
        return
      }
      if (compose !== null) {
        event.preventDefault()
        closeCompose()
        return
      }
      // a locally controlled modal (the media viewer) is not in the UI store
      if (document.querySelector('dialog[open]') !== null) return
      // the inline dock owns Escape through its own handler and the thread
      if (uiOwnsKeyboard()) return
      // an editable target owns the key; the search field clears itself
      if (isEditableTarget(event.target)) return

      event.preventDefault()
      closeOrBack()
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [backBinding, dialog, compose, closeDialog, closeCompose, pathname, search, navigate])

  const hotkeys = globalHotkeys({
    search: focusSearch,
    compose: startCompose,
    settings: () => openDialog('settings'),
    // `?` is not a plain hotkey: KeyHints owns it so a tap still opens the help
    // dialog and a hold reveals the key badges instead
  })

  useHotkeys(
    hotkeys,
    authenticated && dialog === null && compose === null && inlineCompose === null,
  )

  // a route swap ends a hold: the badges describe the surface that was on
  // screen when the key went down
  const route = `${pathname}${search.length > 0 ? `?${search}` : ''}`

  return (
    <div className="b-app">
      <a className="b-skip" href="#main">
        skip to content
      </a>

      <TopBar />

      <main id="main" className="b-main" tabIndex={-1} ref={mainRef}>
        {authenticated ? (
          <Switch>
            <Route path="/" component={FeedView} />
            <Route path="/search" component={SearchView} />
            <Route path="/profile/:actor" component={ProfileView} />
            <Route path="/thread" component={ThreadView} />
            <Route path="/feed" component={FeedView} />
            <Route path="/notifications" component={NotificationsView} />
            <Route component={NotFound} />
          </Switch>
        ) : authStatus === 'restoring' ? (
          <div className="b-shell-gate">
            <Progress label="restoring session" indeterminate />
          </div>
        ) : (
          <div className="b-shell-gate">
            {/* a failed portal restore is reported above the gate, not inside
                the login dialog the reader did not ask for */}
            {restoreError === null ? null : (
              <ErrorNotice title="could not restore portal sign-in" message={restoreError} />
            )}
            <SignedOutCard
              onSignIn={() => {
                openDialog('login')
              }}
            />
          </div>
        )}
      </main>

      <CommandPalette
        open={dialog === 'palette'}
        onClose={closeDialog}
        onOpenHelp={() => openDialog('help')}
        onOpenSettings={() => openDialog('settings')}
      />
      <HelpDialog open={dialog === 'help'} onClose={closeDialog} />
      <SettingsDialog open={dialog === 'settings'} onClose={closeDialog} />
      <LoginDialog open={dialog === 'login'} onClose={closeDialog} />
      <AccountDialog open={dialog === 'account'} onClose={closeDialog} />
      <ComposeDialog open={compose !== null} request={compose} onClose={closeCompose} />
      <KeyHints route={route} />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DitherDefs />
      <AppErrorBoundary>
        <TransitionRouter>
          <AppShell />
        </TransitionRouter>
      </AppErrorBoundary>
    </QueryClientProvider>
  )
}
