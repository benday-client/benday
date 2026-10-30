import { Link, useLocation } from 'wouter'
import { useAuthStore } from '../lib/auth'
import { useUiStore } from '../lib/ui'
import { Button, Kbd } from './ui'

export function TopBar() {
  const [pathname] = useLocation()
  const authStatus = useAuthStore((state) => state.status)
  const account = useAuthStore((state) => state.account)
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)

  const feedsActive = pathname === '/' || pathname.startsWith('/feed')
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
  const authenticated = authStatus === 'authenticated'

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
        {authenticated && account !== null ? (
          <Link
            href={`/profile/${encodeURIComponent(account.handle)}`}
            className="b-topbar__account"
            aria-label={`profile @${account.handle}`}
            title={account.did}
          >
            @{account.handle}
          </Link>
        ) : authStatus === 'anonymous' ? (
          <Button
            variant="ghost"
            className="b-topbar__login"
            onClick={() => {
              openDialog('login')
            }}
          >
            log in
          </Button>
        ) : null}
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

        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={() => {
            openDialog('help')
          }}
          aria-label="keyboard help"
          title="keyboard help · ?"
        >
          <Kbd>?</Kbd>
        </Button>

        <Button
          variant="ghost"
          className="b-topbar__icon"
          onClick={() => {
            openDialog('settings')
          }}
          aria-label="settings"
          title="settings · ,"
        >
          <span className="b-topbar__glyph" aria-hidden="true">
            ⚙
          </span>
        </Button>
      </div>
    </header>
  )
}
