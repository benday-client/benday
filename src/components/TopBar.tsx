import { Link, useLocation } from 'wouter'
import { useAuthStore } from '../lib/auth'
import { useUiStore } from '../lib/ui'
import { Button, Kbd } from './ui'

export function TopBar() {
  const [pathname] = useLocation()
  const authStatus = useAuthStore((state) => state.status)
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)

  const searchActive = pathname.startsWith('/search')
  const feedsActive = pathname === '/' || pathname.startsWith('/feed')
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
          href="/search"
          className="b-topbar__link"
          data-active={searchActive ? 'true' : 'false'}
          aria-current={searchActive ? 'page' : undefined}
        >
          search
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
            openDialog('settings')
          }}
          aria-label="settings"
          title="settings · ,"
        >
          <span aria-hidden="true">⚙</span>
        </Button>
      </div>
    </header>
  )
}
