import { useEffect, useState } from 'react'
import { useAppViewProbe } from '../hooks/useAppViewProbe'
import {
  APPVIEW_PRESETS,
  appViewHostname,
  makeCustomAppView,
  sameAppView,
  toAppViewTarget,
} from '../lib/appviews'
import { useSettings } from '../lib/store'
import type { AppViewPreset } from '../lib/types'
import { Button, Dialog, Tag, TextInput } from './ui'

export interface AppViewDialogProps {
  open: boolean
  onClose: () => void
}

interface AppViewRowProps {
  preset: AppViewPreset
  active: boolean
  open: boolean
  onSelect: (preset: AppViewPreset) => void
}

function probeLabel(
  status: 'idle' | 'checking' | 'ok' | 'error',
  latencyMs: number | null,
): string {
  if (status === 'checking') return 'checking'
  if (status === 'ok') return `ok · ${latencyMs ?? 0}ms`
  if (status === 'error') return 'error'
  return 'idle'
}

function AppViewRow({ preset, active, open, onSelect }: AppViewRowProps) {
  const probe = useAppViewProbe(preset, open)
  const status = probeLabel(probe.status, probe.latencyMs)

  return (
    <li className="b-appview__row">
      <button
        type="button"
        className="b-appview__select"
        data-active={active ? 'true' : 'false'}
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          onSelect(preset)
        }}
      >
        <span className="b-appview__rowhead">
          <span className="b-appview__mark" aria-hidden="true">
            {active ? '*' : '\u00a0'}
          </span>
          <span className="b-appview__name">{preset.label}</span>
          <span className="b-appview__host">{appViewHostname(preset)}</span>
          <span
            className="b-appview__status"
            data-state={probe.status}
            title={probe.status === 'error' ? probe.detail : undefined}
          >
            {status}
          </span>
        </span>
        <span className="b-appview__note">{preset.note}</span>
        <span className="b-appview__caps">
          {preset.capabilities.search ? (
            <Tag>search</Tag>
          ) : (
            <Tag tone="warn">search unavailable</Tag>
          )}
          {preset.capabilities.feeds ? <Tag>feeds</Tag> : <Tag tone="warn">feeds unavailable</Tag>}
        </span>
      </button>
    </li>
  )
}

export function AppViewDialog({ open, onClose }: AppViewDialogProps) {
  const appView = useSettings((state) => state.appView)
  const setAppView = useSettings((state) => state.setAppView)
  const [host, setHost] = useState('')

  useEffect(() => {
    if (open) setHost(appView.kind === 'custom' ? appView.host : '')
  }, [open, appView])

  const custom = makeCustomAppView(host)
  const invalid = host.trim().length > 0 && custom === null

  const choose = (preset: AppViewPreset) => {
    setAppView(toAppViewTarget(preset))
    onClose()
  }

  const useCustom = () => {
    if (custom === null) return
    setAppView(custom)
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="appviews"
      onClose={onClose}
      className="b-appview"
      footer={
        <Button variant="ghost" onClick={onClose}>
          close
        </Button>
      }
    >
      <ul className="b-appview__list">
        {APPVIEW_PRESETS.map((preset) => (
          <AppViewRow
            key={preset.id}
            preset={preset}
            active={sameAppView(appView, preset)}
            open={open}
            onSelect={choose}
          />
        ))}
      </ul>

      <div className="b-appview__custom">
        <TextInput
          label="custom host"
          placeholder="https://api.example.com"
          hint="https origin · public reads only"
          value={host}
          onChange={(event) => {
            setHost(event.target.value)
          }}
        />
        {invalid ? (
          <p className="b-appview__error">invalid host · use an https origin without a path</p>
        ) : null}
        <div className="b-appview__custom-actions">
          <Button variant="outline" disabled={custom === null} onClick={useCustom}>
            use appview
          </Button>
        </div>
        <p className="b-appview__disclaimer">
          custom appviews are public reads only. no automatic probe runs for a custom host.
        </p>
      </div>
    </Dialog>
  )
}
