import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, Route, Switch } from 'wouter'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { AppViewDialog } from './components/AppViewDialog'
import { CommandPalette } from './components/CommandPalette'
import { DitherDefs } from './components/DitherDefs'
import { HelpDialog } from './components/HelpDialog'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/ui'
import { type Hotkey, useHotkeys } from './hooks/useHotkeys'
import { useSettings } from './lib/store'
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

type DialogKind = 'palette' | 'appview' | 'help' | null

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
  const [dialog, setDialog] = useState<DialogKind>(null)
  const theme = useSettings((state) => state.theme)
  const flow = useSettings((state) => state.flow)
  const toggleTheme = useSettings((state) => state.toggleTheme)
  const setFlow = useSettings((state) => state.setFlow)

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta instanceof HTMLMetaElement) {
      meta.content = theme === 'bone' ? '#ddd6c6' : '#07090c'
    }
  }, [theme])

  const cycleFlow = () => {
    const next = flow === 'auto' ? 'horizontal' : flow === 'horizontal' ? 'vertical' : 'auto'
    setFlow(next)
  }

  const hotkeys: readonly Hotkey[] = [
    { key: 'k', ctrlOrMeta: true, handler: () => setDialog('palette') },
    { key: '/', handler: () => setDialog('palette') },
    { key: 'a', handler: () => setDialog('appview') },
    { key: '?', handler: () => setDialog('help') },
    { key: 't', handler: toggleTheme },
    { key: 'f', handler: cycleFlow },
  ]

  useHotkeys(hotkeys, dialog === null)

  return (
    <div className="b-app">
      <a className="b-skip" href="#main">
        skip to content
      </a>

      <TopBar
        onOpenPalette={() => setDialog('palette')}
        onOpenAppView={() => setDialog('appview')}
        onOpenHelp={() => setDialog('help')}
      />

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

      <StatusBar onOpenHelp={() => setDialog('help')} />

      <CommandPalette
        open={dialog === 'palette'}
        onClose={() => setDialog(null)}
        onOpenAppView={() => setDialog('appview')}
        onOpenHelp={() => setDialog('help')}
      />
      <AppViewDialog open={dialog === 'appview'} onClose={() => setDialog(null)} />
      <HelpDialog open={dialog === 'help'} onClose={() => setDialog(null)} />
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
