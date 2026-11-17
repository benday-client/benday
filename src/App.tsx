import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
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
import { useBetaAccess } from './hooks/useBetaAccess'
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
import AdminView from './views/AdminView'
import BetaRefusal from './views/BetaRefusal'
import FeedView from './views/FeedView'
import LandingView from './views/LandingView'
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
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'invites'
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

function AccountLabelers() {
  useAccountLabelers()
  return null
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
  const account = useAuthStore((state) => state.account)
  const signOut = useAuthStore((state) => state.signOut)
  const authenticated = authStatus === 'authenticated'
  // the shipped invitation list decides who may use the app; an unreadable list
  // fails closed rather than letting everyone in
  const access = useBetaAccess(authenticated ? account : null)
  const allowed = authenticated && access === 'allowed'
  // latched so the refusal survives the sign-out it triggers: once the account
  // clears, the access check has nothing left to answer for
  const [refusal, setRefusal] = useState<'refused' | 'unreadable' | null>(null)
  const restoreError = useAuthStore((state) => state.restoreError)
  const landing =
    pathname === '/' && !authenticated && authStatus !== 'restoring' && refusal === null
  const helpAvailable = !landing && (!authenticated || allowed)

  useEffect(() => {
    if (landing && dialog === 'help') closeDialog()
  }, [landing, dialog, closeDialog])

  // an account that is not on the list is signed out through the local-first
  // path, so a reload cannot put it back inside
  useEffect(() => {
    if (!authenticated) return
    if (access === 'allowed') {
      setRefusal(null)
      return
    }
    if (access !== 'refused' && access !== 'unreadable') return
    setRefusal(access)
    void signOut()
  }, [authenticated, access, signOut])

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
        previousPath === '/' ||
        previousPath === '/search' ||
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

  // a thread route carries its post in the query, so another thread is another
  // focus identity; every other route keeps focus across its query edits
  const routeFocusKey =
    pathname === '/thread' ? `${pathname}${search.length > 0 ? `?${search}` : ''}` : pathname

  useEffect(() => {
    const main = mainRef.current
    if (main === null) return
    // the first commit is a landing, not a swap: the route focuses itself
    const landed = landedPathRef.current
    landedPathRef.current = routeFocusKey
    if (landed === null || landed === routeFocusKey) return
    const focusMain = () => {
      // a later route has already committed; its own effect owns focus now
      if (landedPathRef.current !== routeFocusKey) return
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
  }, [routeFocusKey])

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
    if (!allowed || dialog !== null || compose !== null || inlineCompose !== null) return

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.isComposing || event.keyCode === 229) return
      // the chord carries the platform modifier, so it may fire from a field
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
  }, [dialog, compose, inlineCompose, pathname, allowed, tabBinding])

  // the palette chord toggles itself closed, so it is matched before the guard
  // chain that an open dialog normally arms. it is a chord, so it may fire from
  // a text field without stealing a character
  useEffect(() => {
    const handlePaletteToggle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return
      if (event.isComposing || event.keyCode === 229) return
      if (!matchesBinding(event, bindingFor('palette'))) return
      // the gate owns the keyboard while nobody is signed in
      if (!allowed) return

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
  }, [dialog, compose, inlineCompose, allowed, openDialog, closeDialog])

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
      if (!allowed || event.defaultPrevented || event.repeat) return
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
  }, [allowed, backBinding, dialog, compose, closeDialog, closeCompose, pathname, search, navigate])

  const hotkeys = globalHotkeys({
    search: allowed ? focusSearch : undefined,
    compose: allowed ? startCompose : undefined,
    settings: () => openDialog('settings'),
    // `?` is not a plain hotkey: KeyHints owns it so a tap still opens the help
    // dialog and a hold reveals the key badges instead
  })

  useHotkeys(
    hotkeys,
    (allowed || landing) && dialog === null && compose === null && inlineCompose === null,
  )

  // a route swap ends a hold: the badges describe the surface that was on
  // screen when the key went down
  const route = `${pathname}${search.length > 0 ? `?${search}` : ''}`

  return (
    <div className="b-app">
      <a className="b-skip" href="#main">
        skip to content
      </a>

      {!authenticated || allowed ? <TopBar landing={landing} /> : null}
      {!authenticated || allowed ? <AccountLabelers /> : null}

      <main id="main" className="b-main" tabIndex={-1} ref={mainRef}>
        {restoreError === null ? null : (
          <div className="b-shell-notice">
            <ErrorNotice title="could not restore portal sign-in" message={restoreError} />
          </div>
        )}
        {pathname === '/admin' ? (
          // the invite minter sits behind the server gate like the rest of the
          // site, so it does not wait on a bluesky session to render
          <AdminView />
        ) : refusal !== null ? (
          <BetaRefusal
            reason={refusal}
            onSignOut={() => {
              void signOut()
            }}
          />
        ) : allowed ? (
          <Switch>
            <Route path="/" component={FeedView} />
            <Route path="/search" component={SearchView} />
            <Route path="/profile/:actor" component={ProfileView} />
            <Route path="/thread" component={ThreadView} />
            <Route path="/feed" component={FeedView} />
            <Route path="/notifications" component={NotificationsView} />
            <Route component={NotFound} />
          </Switch>
        ) : authenticated || authStatus === 'restoring' ? (
          <div className="b-shell-gate">
            <Progress
              label={authenticated ? 'checking invitation' : 'restoring session'}
              indeterminate
            />
          </div>
        ) : landing ? (
          <LandingView
            onSignIn={() => {
              openDialog('login')
            }}
          />
        ) : (
          <div className="b-shell-gate">
            <SignedOutCard
              onSignIn={() => {
                openDialog('login')
              }}
            />
          </div>
        )}
      </main>

      <CommandPalette
        open={allowed && dialog === 'palette'}
        onClose={closeDialog}
        onOpenHelp={() => openDialog('help')}
        onOpenSettings={() => openDialog('settings')}
      />
      <HelpDialog open={helpAvailable && dialog === 'help'} onClose={closeDialog} />
      <SettingsDialog
        open={(!authenticated || allowed) && dialog === 'settings'}
        onClose={closeDialog}
      />
      <LoginDialog open={!authenticated && dialog === 'login'} onClose={closeDialog} />
      <AccountDialog
        open={(!authenticated || allowed) && dialog === 'account'}
        onClose={closeDialog}
      />
      <ComposeDialog open={allowed && compose !== null} request={compose} onClose={closeCompose} />
      {helpAvailable ? <KeyHints route={route} /> : null}
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
