import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { AccountDialog } from './components/AccountDialog'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { AppViewDialog } from './components/AppViewDialog'
import { CommandPalette } from './components/CommandPalette'
import { ComposeDialog } from './components/ComposeDialog'
import { DitherDefs } from './components/DitherDefs'
import { HelpDialog } from './components/HelpDialog'
import { LoginDialog } from './components/LoginDialog'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/ui'
import { type Hotkey, useHotkeys } from './hooks/useHotkeys'
import { useAuthStore } from './lib/auth'
import { useSettings } from './lib/store'
import { THEME_COLORS } from './lib/themes'
import { useUiStore } from './lib/ui'
import DiscoverView from './views/DiscoverView'
import FeedView from './views/FeedView'
import ProfileView from './views/ProfileView'
import SearchView from './views/SearchView'
import ThreadView from './views/ThreadView'

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
        action={<Link href="/">back to discover</Link>}
      />
    </div>
  )
}

function AppShell() {
  const [, navigate] = useLocation()
  const dialog = useUiStore((state) => state.dialog)
  const compose = useUiStore((state) => state.compose)
  const openDialog = useUiStore((state) => state.openDialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const openCompose = useUiStore((state) => state.openCompose)
  const closeCompose = useUiStore((state) => state.closeCompose)

  const theme = useSettings((state) => state.theme)
  const flow = useSettings((state) => state.flow)
  const toggleTheme = useSettings((state) => state.toggleTheme)
  const setFlow = useSettings((state) => state.setFlow)

  useEffect(() => {
    void useAuthStore.getState().restore()
  }, [])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta instanceof HTMLMetaElement) meta.content = THEME_COLORS[theme]
  }, [theme])

  const cycleFlow = () => {
    const next = flow === 'auto' ? 'horizontal' : flow === 'horizontal' ? 'vertical' : 'auto'
    setFlow(next)
  }

  const focusSearch = () => {
    navigate('/search')
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.b-view__form .b-input__control')
      input?.focus()
    }, 0)
  }

  const startCompose = () => {
    if (useAuthStore.getState().status === 'authenticated') {
      openCompose({ mode: 'post', post: null })
    } else {
      openDialog('login')
    }
  }

  const hotkeys: readonly Hotkey[] = [
    { key: 'k', ctrlOrMeta: true, handler: () => openDialog('palette') },
    { key: '/', handler: () => openDialog('palette') },
    { key: 's', handler: focusSearch },
    { key: 'c', handler: startCompose },
    { key: 'a', handler: () => openDialog('appview') },
    { key: '?', handler: () => openDialog('help') },
    { key: 't', handler: toggleTheme },
    { key: 'f', handler: cycleFlow },
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
          <Route path="/" component={DiscoverView} />
          <Route path="/search" component={SearchView} />
          <Route path="/profile/:actor" component={ProfileView} />
          <Route path="/thread" component={ThreadView} />
          <Route path="/feed" component={FeedView} />
          <Route component={NotFound} />
        </Switch>
      </main>

      <StatusBar />

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
