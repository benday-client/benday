import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { appViewHostname } from '../lib/appviews'
import { useSettings } from '../lib/store'
import { formatClock } from '../lib/time'

export interface StatusBarProps {
  onOpenHelp: () => void
}

export function StatusBar({ onOpenHelp }: StatusBarProps) {
  const [pathname] = useLocation()
  const appView = useSettings((state) => state.appView)
  const flow = useSettings((state) => state.flow)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 30_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return (
    <footer className="b-statusbar">
      <div className="b-statusbar__group">
        <span className="b-statusbar__item">
          <span className="b-statusbar__label">read-only</span>
        </span>
        <span className="b-statusbar__item">
          <span className="b-statusbar__label">appview</span>
          <span className="b-statusbar__value">
            {`${appView.label} // ${appViewHostname(appView)}`}
          </span>
        </span>
        <span className="b-statusbar__item b-statusbar__flow">
          <span className="b-statusbar__label">flow</span>
          <span className="b-statusbar__value">{flow}</span>
        </span>
      </div>

      <span className="b-statusbar__path" title={pathname}>
        {pathname}
      </span>

      <div className="b-statusbar__group b-statusbar__group--end">
        <time className="b-statusbar__clock" dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>
        <button type="button" className="b-statusbar__keys" onClick={onOpenHelp}>
          <span className="b-statusbar__glyph" aria-hidden="true">
            ?
          </span>
          keys
        </button>
      </div>
    </footer>
  )
}
