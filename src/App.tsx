import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { AccountDialog } from './components/AccountDialog'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { AppViewDialog } from './components/AppViewDialog'
import { CommandPalette } from './components/CommandPalette'
import { ComposeDialog } from './components/ComposeDialog'
import { DitherDefs } from './components/DitherDefs'
import { HelpDialog } from './components/HelpDialog'
import { LoginDialog } from './components/LoginDialog'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/ui'
import { type Hotkey, useHotkeys } from './hooks/useHotkeys'
import { useInputMode } from './hooks/useInputMode'
import { useAuthStore } from './lib/auth'
import { installCursors } from './lib/cursors'
import { useSettings } from './lib/store'
import { THEME_COLORS, THEME_KEYS, THEMES } from './lib/themes'
import { useUiStore } from './lib/ui'
import FeedView from './views/FeedView'
import ProfileView from './views/ProfileView'
import SearchView from './views/SearchView'
import ThreadView from './views/ThreadView'

const TAB_ROUTES = ['/feed', '/search'] as const

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
  const dialog = useUiStore((state) => state.dialog)
  const compose = useUiStore((state) => state.compose)
  const openDialog = useUiStore((state) => state.openDialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const openCompose = useUiStore((state) => state.openCompose)
  const closeCompose = useUiStore((state) => state.closeCompose)
  const themeMenuOpen = useUiStore((state) => state.themeMenuOpen)
  const toggleThemeMenu = useUiStore((state) => state.toggleThemeMenu)
  const closeThemeMenu = useUiStore((state) => state.closeThemeMenu)
  const lastViewRef = useRef<string | null>(null)
  useInputMode()

  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)

  useEffect(() => {
    void useAuthStore.getState().restore()
  }, [])

  useEffect(() => {
    closeThemeMenu()
  }, [pathname, closeThemeMenu])

  useEffect(() => {
    if (!pathname.startsWith('/thread')) {
      lastViewRef.current = `${pathname}${window.location.search}`
    }
  }, [pathname])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta instanceof HTMLMetaElement) meta.content = THEME_COLORS[theme]
    installCursors()
  }, [theme])

  const focusSearch = () => {
    navigate('/search')
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.b-view__form .b-input__control')
      input?.focus()
    }, 0)
  }

  const changeTab = (direction: number) => {
    const current = pathname.startsWith('/search') ? 1 : 0
    const next = (current + direction + TAB_ROUTES.length) % TAB_ROUTES.length
    navigate(TAB_ROUTES[next] ?? '/feed')
  }

  const startCompose = () => {
    if (useAuthStore.getState().status === 'authenticated') {
      openCompose({ mode: 'post', post: null })
    } else {
      openDialog('login')
    }
  }

  useEffect(() => {
    if (dialog !== null || compose !== null) return

    const handleTabKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      changeTab(event.key === 'ArrowLeft' ? -1 : 1)
    }

    window.addEventListener('keydown', handleTabKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleTabKey, true)
    }
  }, [dialog, compose, pathname])

  const closeOrBack = () => {
    if (themeMenuOpen) {
      closeThemeMenu()
      return
    }
    if (pathname.startsWith('/thread')) {
      if (lastViewRef.current !== null) {
        window.history.back()
      } else {
        navigate('/')
      }
    }
  }

  const themeKeys: Hotkey[] = themeMenuOpen
    ? THEMES.map((item) => ({
        key: THEME_KEYS[item],
        handler: () => {
          setTheme(item)
          closeThemeMenu()
        },
      }))
    : []

  const hotkeys: readonly Hotkey[] = [
    ...themeKeys,
    { key: 'k', ctrlOrMeta: true, handler: () => openDialog('palette') },
    { key: '/', handler: () => openDialog('palette') },
    { key: 's', handler: focusSearch },
    { key: 'c', handler: startCompose },
    { key: 'a', handler: () => openDialog('appview') },
    { key: '?', handler: () => openDialog('help') },
    { key: 't', handler: toggleThemeMenu },
    { key: 'Escape', handler: closeOrBack },
  ]

  useHotkeys(hotkeys, dialog === null && compose === null)

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
          <Route component={NotFound} />
        </Switch>
      </main>

      <CommandPalette
        open={dialog === 'palette'}
        onClose={closeDialog}
        onOpenAppView={() => openDialog('appview')}
        onOpenHelp={() => openDialog('help')}
      />
      <AppViewDialog open={dialog === 'appview'} onClose={closeDialog} />
      <HelpDialog open={dialog === 'help'} onClose={closeDialog} />
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
