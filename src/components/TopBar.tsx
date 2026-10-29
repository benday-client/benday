import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'wouter'
import { appViewHostname } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { THEME_KEYS, THEME_LABELS, THEMES } from '../lib/themes'
import { useUiStore } from '../lib/ui'
import { Button, Kbd } from './ui'

export function TopBar() {
  const [pathname] = useLocation()
  const appView = useSettings((state) => state.appView)
  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)
  const authStatus = useAuthStore((state) => state.status)
  const account = useAuthStore((state) => state.account)
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)
  const themeMenuOpen = useUiStore((state) => state.themeMenuOpen)
  const toggleThemeMenu = useUiStore((state) => state.toggleThemeMenu)
  const closeThemeMenu = useUiStore((state) => state.closeThemeMenu)
  const themeWrapRef = useRef<HTMLDivElement>(null)

  const discoverActive = pathname === '/'
  const searchActive = pathname.startsWith('/search')
  const feedsActive = pathname.startsWith('/feed')
  const authenticated = authStatus === 'authenticated' && account !== null
  const accountLabel = authenticated
    ? `@${account.handle}`
    : authStatus === 'restoring'
      ? '...'
      : 'sign in'

  useEffect(() => {
    if (!themeMenuOpen) return

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && themeWrapRef.current?.contains(target)) return
      closeThemeMenu()
    }

    document.addEventListener('pointerdown', closeOnOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
    }
  }, [themeMenuOpen, closeThemeMenu])

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
        <Link
          href="/feed"
          className="b-topbar__link"
          data-active={feedsActive ? 'true' : 'false'}
          aria-current={feedsActive ? 'page' : undefined}
        >
          feeds
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
            if (authenticated) {
              openCompose({ mode: 'post', post: null })
            } else {
              openDialog('login')
            }
          }}
          aria-label="compose"
          title="compose · c"
        >
          +
        </Button>

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

        <div className="b-theme-wrap" ref={themeWrapRef}>
          <Button
            variant="ghost"
            className="b-topbar__icon"
            onClick={toggleThemeMenu}
            aria-label="themes"
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            title={`themes · ${theme}`}
          >
            <span aria-hidden="true">◐</span>
          </Button>

          {themeMenuOpen ? (
            <div className="b-theme-menu" role="menu" aria-label="themes">
              {THEMES.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === item}
                  className="b-theme-menu__item"
                  onClick={() => {
                    setTheme(item)
                    closeThemeMenu()
                  }}
                >
                  <span className="b-theme-menu__key">{THEME_KEYS[item]}</span>
                  <span>{THEME_LABELS[item]}</span>
                  <span className="b-theme-menu__mark" aria-hidden="true">
                    {theme === item ? '*' : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
