import { Link, useLocation } from 'wouter'
import { appViewHostname } from '../lib/appviews'
import { useSettings } from '../lib/store'
import { Button, Kbd } from './ui'

export interface TopBarProps {
  onOpenPalette: () => void
  onOpenAppView: () => void
  onOpenHelp: () => void
}

export function TopBar({ onOpenPalette, onOpenAppView, onOpenHelp }: TopBarProps) {
  const [pathname] = useLocation()
  const appView = useSettings((state) => state.appView)
  const theme = useSettings((state) => state.theme)
  const toggleTheme = useSettings((state) => state.toggleTheme)

  const discoverActive = pathname === '/'
  const searchActive = pathname.startsWith('/search')

  return (
    <header className="b-topbar">
      <Link href="/" className="b-brand" aria-label="benday home">
        <span className="b-brand__mark" aria-hidden="true" />
        <span className="b-brand__name">benday</span>
        <span className="b-brand__tagline">{'// bluesky reader'}</span>
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
          onClick={onOpenAppView}
          title="switch appview"
        >
          <span className="b-appview-chip__label">{appView.label}</span>
          <span className="b-appview-chip__host">{appViewHostname(appView)}</span>
        </button>

        <Button variant="ghost" className="b-topbar__jump" onClick={onOpenPalette}>
          jump <Kbd>/</Kbd>
        </Button>

        <Button
          variant="ghost"
          className="b-topbar__action"
          onClick={toggleTheme}
          aria-label="toggle theme"
          title={`theme: ${theme}`}
        >
          <span className="b-topbar__glyph" aria-hidden="true">
            ◐
          </span>
          <span className="b-topbar__action-label">theme</span>
        </Button>

        <Button
          variant="ghost"
          className="b-topbar__action b-topbar__help"
          onClick={onOpenHelp}
          aria-label="keyboard help"
          title="keyboard help"
        >
          ?
        </Button>
      </div>
    </header>
  )
}
