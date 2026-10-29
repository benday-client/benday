import { useEffect, useState } from 'react'
import { appViewHostname } from '../lib/appviews'
import { useSettings } from '../lib/store'
import { formatClock } from '../lib/time'
import { useUiStore } from '../lib/ui'

export function StatusBar() {
  const appView = useSettings((state) => state.appView)
  const openDialog = useUiStore((state) => state.openDialog)
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
      <span className="b-statusbar__item">
        <span className="b-statusbar__label">appview</span>
        <span
          className="b-statusbar__value"
          title={`${appView.label} // ${appViewHostname(appView)}`}
        >
          {appView.label}
          <span className="b-statusbar__host">{` // ${appViewHostname(appView)}`}</span>
        </span>
      </span>

      <div className="b-statusbar__group b-statusbar__group--end">
        <time className="b-statusbar__clock" dateTime={now.toISOString()}>
          {formatClock(now)}
        </time>
        <button
          type="button"
          className="b-statusbar__keys"
          onClick={() => {
            openDialog('help')
          }}
        >
          <span className="b-statusbar__glyph" aria-hidden="true">
            ?
          </span>
          keys
        </button>
      </div>
    </footer>
  )
}
