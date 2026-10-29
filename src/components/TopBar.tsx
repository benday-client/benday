import { Link, useLocation } from 'wouter'
import { appViewHostname } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
import { Button, Kbd } from './ui'

export function TopBar() {
  const [pathname] = useLocation()
  const appView = useSettings((state) => state.appView)
  const theme = useSettings((state) => state.theme)
  const toggleTheme = useSettings((state) => state.toggleTheme)
  const authStatus = useAuthStore((state) => state.status)
  const account = useAuthStore((state) => state.account)
  const openDialog = useUiStore((state) => state.openDialog)

  const discoverActive = pathname === '/'
  const searchActive = pathname.startsWith('/search')
  const authenticated = authStatus === 'authenticated' && account !== null
  const accountLabel = authenticated
    ? `@${account.handle}`
    : authStatus === 'restoring'
      ? '...'
      : 'sign in'

  return (
    <header className="b-topbar">
      <Link href="/" className="b-brand" aria-label="benday home">
        <span className="b-brand__mark" aria-hidden="true" />
        <span className="b-brand__name">benday</span>
      </Link>

      <nav className="b-topbar__nav" aria-label="primary">
        <Link
          href="/"
          className="b-topbar__link"
          data-active={discoverActive ? 'true' : 'false'}
          aria-current={discoverActive ? 'page' : undefined}
        >
          discover
        </Link>
        <Link
          href="/search"
          className="b-topbar__link"
          data-active={searchActive ? 'true' : 'false'}
          aria-current={searchActive ? 'page' : undefined}
        >
          search
        </Link>
      </nav>

      <div className="b-topbar__actions">
        <button
          type="button"
          className="b-appview-chip"
          onClick={() => {
            openDialog('appview')
          }}
          title={`switch appview: ${appViewHostname(appView)}`}
        >
          <span className="b-appview-chip__label">{appView.label}</span>
        </button>

        <button
          type="button"
          className="b-account-chip"
          onClick={() => {
            openDialog(authenticated ? 'account' : 'login')
          }}
          disabled={authStatus === 'restoring'}
          title={authenticated ? 'account' : 'sign in with a password or app password'}
        >
          {accountLabel}
        </button>

        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={() => {
            openDialog('palette')
          }}
          aria-label="jump"
          title="jump"
        >
          <Kbd>/</Kbd>
        </Button>

        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={toggleTheme}
          aria-label="cycle theme"
          title={`theme ${theme}`}
        >
          <span aria-hidden="true">◐</span>
        </Button>
      </div>
    </header>
  )
}
