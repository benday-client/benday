import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, Route, Switch, useLocation, useSearch } from 'wouter'
import { AccountDialog } from './components/AccountDialog'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { AppViewDialog } from './components/AppViewDialog'
import { CommandPalette } from './components/CommandPalette'
import { ComposeDialog } from './components/ComposeDialog'
import { DitherDefs } from './components/DitherDefs'
import { HelpDialog } from './components/HelpDialog'
import { LoginDialog } from './components/LoginDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/ui'
import { type Hotkey, isEditableTarget, useHotkeys } from './hooks/useHotkeys'
import { useInputMode } from './hooks/useInputMode'
import { getAuthAgent, useAuthStore } from './lib/auth'
import { installCursors } from './lib/cursors'
import { invalidateNonFeedQueries } from './lib/queries'
import { useSettings } from './lib/store'
import { resolveTheme, THEME_COLORS } from './lib/themes'
import { useUiStore } from './lib/ui'
import FeedView from './views/FeedView'
import NotificationsView from './views/NotificationsView'
import ProfileView from './views/ProfileView'
import SearchView from './views/SearchView'
import ThreadView from './views/ThreadView'

const TAB_ROUTES = ['/feed', '/notifications'] as const

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 45_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

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
  const lastViewRef = useRef<string | null>(null)
  const baseViewRef = useRef<string | null>(null)
  const queryClient = useQueryClient()
  const authStatus = useAuthStore((state) => state.status)
  const labelers = useSettings((state) => state.labelers)
  const labelerKey = labelers.join('\n')
  const lastLabelerKeyRef = useRef(labelerKey)
  useInputMode()

  const theme = useSettings((state) => state.theme)
  const appearance = useSettings((state) => state.appearance)
  const setActiveTheme = useSettings((state) => state.setActiveTheme)
  const syncSystemTheme = useSettings((state) => state.syncSystemTheme)

  useEffect(() => {
    void useAuthStore.getState().restore()
  }, [])

  useEffect(() => {
    const view = `${pathname}${search.length > 0 ? `?${search}` : ''}`
    if (!pathname.startsWith('/thread')) {
      lastViewRef.current = view
    }
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
    if (lastLabelerKeyRef.current === labelerKey) return
    lastLabelerKeyRef.current = labelerKey
    getAuthAgent()?.configureLabelers(labelers)
    void invalidateNonFeedQueries(queryClient)
  }, [labelerKey, labelers, queryClient])

  useEffect(() => {
    const effectiveTheme = resolveTheme(theme, new Date())
    document.documentElement.dataset['theme'] = effectiveTheme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta instanceof HTMLMetaElement) meta.content = THEME_COLORS[effectiveTheme]
    installCursors()
    if (effectiveTheme !== theme) setActiveTheme(effectiveTheme)
  }, [theme, setActiveTheme])

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
    navigate('/search')
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.b-view__form .b-input__control')
      input?.focus()
    }, 0)
  }

  const changeTab = (direction: number) => {
    const tabs: readonly string[] = authStatus === 'authenticated' ? TAB_ROUTES : ['/feed']
    const profileTab = pathname.startsWith('/profile/') ? pathname : null
    const routes: readonly string[] = profileTab === null ? tabs : [...tabs, profileTab]
    const current = routes.findIndex((route) =>
      route === profileTab
        ? pathname.startsWith('/profile/')
        : pathname === route || pathname.startsWith(`${route}/`),
    )
    const next = (Math.max(current, 0) + direction + routes.length) % routes.length
    navigate(routes[next] ?? '/feed')
  }

  const startCompose = () => {
    if (useAuthStore.getState().status === 'authenticated') {
      openCompose({ mode: 'post', post: null })
    } else {
      openDialog('login')
    }
  }

  useEffect(() => {
    if (dialog !== null || compose !== null || inlineCompose !== null) return

    const handleTabKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (isEditableTarget(event.target)) {
        const target = event.target
        if (!(target instanceof HTMLElement) || target.closest('.b-view__form') === null) return
      }

      event.preventDefault()
      changeTab(event.key === 'ArrowLeft' ? -1 : 1)
    }

    window.addEventListener('keydown', handleTabKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleTabKey, true)
    }
  }, [dialog, compose, inlineCompose, pathname, authStatus])

  const closeOrBack = () => {
    if (pathname.startsWith('/profile/')) {
      navigate(baseViewRef.current ?? '/feed')
      return
    }
    if (pathname.startsWith('/thread')) {
      if (lastViewRef.current !== null) {
        window.history.back()
      } else {
        navigate(baseViewRef.current ?? '/feed')
      }
    }
  }

  const hotkeys: readonly Hotkey[] = [
    { key: 'k', ctrlOrMeta: true, handler: () => openDialog('palette') },
    { key: '/', handler: () => openDialog('palette') },
    { key: 's', handler: focusSearch },
    { key: 'c', handler: startCompose },
    { key: 'a', handler: () => openDialog('appview') },
    { key: '?', handler: () => openDialog('help') },
    { key: ',', handler: () => openDialog('settings') },
    { key: 'Escape', handler: closeOrBack },
  ]

  useHotkeys(hotkeys, dialog === null && compose === null && inlineCompose === null)

  return (
    <div className="b-app">
      <a className="b-skip" href="#main">
        skip to content
      </a>

      <TopBar />

      <main id="main" className="b-main">
        <Switch>
          <Route path="/" component={FeedView} />
          <Route path="/search" component={SearchView} />
          <Route path="/profile/:actor" component={ProfileView} />
          <Route path="/thread" component={ThreadView} />
          <Route path="/feed" component={FeedView} />
          <Route path="/notifications" component={NotificationsView} />
          <Route component={NotFound} />
        </Switch>
      </main>

      <CommandPalette
        open={dialog === 'palette'}
        onClose={closeDialog}
        onOpenAppView={() => openDialog('appview')}
        onOpenHelp={() => openDialog('help')}
        onOpenSettings={() => openDialog('settings')}
      />
      <AppViewDialog open={dialog === 'appview'} onClose={closeDialog} />
      <HelpDialog open={dialog === 'help'} onClose={closeDialog} />
      <SettingsDialog open={dialog === 'settings'} onClose={closeDialog} />
      <LoginDialog open={dialog === 'login'} onClose={closeDialog} />
      <AccountDialog open={dialog === 'account'} onClose={closeDialog} />
      <ComposeDialog open={compose !== null} request={compose} onClose={closeCompose} />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DitherDefs />
      <AppErrorBoundary>
        <AppShell />
      </AppErrorBoundary>
    </QueryClientProvider>
  )
}
