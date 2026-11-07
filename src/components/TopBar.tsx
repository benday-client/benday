import { Link, useLocation } from 'wouter'
import { useAuthStore } from '../lib/auth'
import { bindingFor, displayKeys } from '../lib/keymap'
import { useUiStore } from '../lib/ui'
import { Button } from './ui'

// every key the bar prints comes from the keyboard registry, so the toolbar and
// the hold-to-reveal badges can never disagree about what a control answers to
const COMPOSE_KEY = displayKeys(bindingFor('compose'))[0] ?? ''
const PALETTE_KEY = displayKeys(bindingFor('palette'))[0] ?? ''
const SEARCH_KEY = displayKeys(bindingFor('search'))[0] ?? ''
const SETTINGS_KEY = displayKeys(bindingFor('settings'))[0] ?? ''
const HELP_KEY = displayKeys(bindingFor('help'))[0] ?? ''

export function TopBar() {
  const [pathname] = useLocation()
  const account = useAuthStore((state) => state.account)
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)

  const feedsActive = pathname === '/' || pathname.startsWith('/feed')
  const searchActive = pathname.startsWith('/search')
  const notificationsActive = pathname.startsWith('/notifications')
  const profileActive = pathname.startsWith('/profile/')
  let profileHandle = ''
  if (profileActive) {
    try {
      profileHandle = decodeURIComponent(pathname.split('/')[2] ?? '')
    } catch {
      profileHandle = ''
    }
  }

  return (
    <header className="b-topbar">
      <Link href="/feed" className="b-brand" aria-label="benday home">
        <span className="b-brand__mark" aria-hidden="true" />
        <span className="b-brand__name">benday</span>
      </Link>

      <nav className="b-topbar__nav" aria-label="primary">
        <Link
          href="/feed"
          className="b-topbar__link"
          data-active={feedsActive ? 'true' : 'false'}
          aria-current={feedsActive ? 'page' : undefined}
        >
          feeds
        </Link>
        <Link
          href="/search"
          className="b-topbar__link"
          data-active={searchActive ? 'true' : 'false'}
          aria-current={searchActive ? 'page' : undefined}
          title={`search · ${SEARCH_KEY}`}
          data-keyhint="search"
        >
          search
        </Link>
        <Link
          href="/notifications"
          className="b-topbar__link"
          data-active={notificationsActive ? 'true' : 'false'}
          aria-current={notificationsActive ? 'page' : undefined}
        >
          notifications
        </Link>
        {profileActive ? (
          <Link
            href={pathname}
            className="b-topbar__link b-topbar__link--profile"
            data-active="true"
            aria-current="page"
            title={profileHandle.length > 0 ? `@${profileHandle}` : 'profile'}
          >
            {profileHandle.length > 0 ? `@${profileHandle}` : 'profile'}
          </Link>
        ) : null}
      </nav>

      <div className="b-topbar__actions">
        {account !== null ? (
          <Link
            href={`/profile/${encodeURIComponent(account.handle)}`}
            className="b-topbar__account"
            aria-label={`profile @${account.handle}`}
            title={account.did}
          >
            @{account.handle}
          </Link>
        ) : null}
        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={() => {
            openCompose({ mode: 'post', post: null })
          }}
          aria-label="compose"
          title={`compose · ${COMPOSE_KEY}`}
          data-keyhint="compose"
        >
          <span className="b-topbar__label">compose</span>
        </Button>

        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={() => {
            openDialog('palette')
          }}
          aria-label="jump"
          title={`jump · ${PALETTE_KEY}`}
          data-keyhint="palette"
        >
          <span className="b-topbar__label">jump</span>
        </Button>

        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={() => {
            openDialog('help')
          }}
          aria-label="keyboard help"
          title={`keyboard help · ${HELP_KEY}`}
          data-keyhint="help"
        >
          <span className="b-topbar__label">help</span>
        </Button>

        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={() => {
            openDialog('settings')
          }}
          aria-label="settings"
          title={`settings · ${SETTINGS_KEY}`}
          data-keyhint="settings"
        >
          <span className="b-topbar__label">settings</span>
        </Button>
      </div>
    </header>
  )
}
