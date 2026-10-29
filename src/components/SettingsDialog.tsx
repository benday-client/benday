import { useEffect, useState } from 'react'
import { useLabelerDetails } from '../hooks/useLabelerDetails'
import {
  APPVIEW_PRESETS,
  appViewHostname,
  makeCustomAppView,
  sameAppView,
  toAppViewTarget,
} from '../lib/appviews'
import { fetchLabelerPrefs } from '../lib/atproto'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { THEME_LABELS, THEMES } from '../lib/themes'
import type { AppViewPreset } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { Button, Dialog, Tag, TextInput } from './ui'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onOpenHelp: () => void
}

export function SettingsDialog({ open, onClose, onOpenHelp }: SettingsDialogProps) {
  const appView = useSettings((state) => state.appView)
  const setAppView = useSettings((state) => state.setAppView)
  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)
  const labelers = useSettings((state) => state.labelers)
  const addLabeler = useSettings((state) => state.addLabeler)
  const removeLabeler = useSettings((state) => state.removeLabeler)
  const account = useAuthStore((state) => state.account)
  const signOut = useAuthStore((state) => state.signOut)
  const openDialog = useUiStore((state) => state.openDialog)
  const [host, setHost] = useState('')
  const [labelerInput, setLabelerInput] = useState('')
  const [importingLabelers, setImportingLabelers] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const details = useLabelerDetails(labelers)

  useEffect(() => {
    if (open) setHost(appView.kind === 'custom' ? appView.host : '')
  }, [open, appView])

  const custom = makeCustomAppView(host)
  const invalidHost = host.trim().length > 0 && custom === null
  const labelerDid = labelerInput.trim()
  const validLabeler = labelerDid.startsWith('did:') && labelerDid.length > 4
  const detailByDid = new Map(details.labelers.map((labeler) => [labeler.did, labeler]))

  const choosePreset = (preset: AppViewPreset) => {
    setAppView(toAppViewTarget(preset))
  }

  const useCustom = () => {
    if (custom === null) return
    setAppView(custom)
  }

  const add = () => {
    if (!validLabeler) return
    addLabeler(labelerDid)
    setLabelerInput('')
  }

  const importFromAccount = async () => {
    if (importingLabelers) return
    setImportingLabelers(true)
    setImportError(null)
    try {
      const dids = await fetchLabelerPrefs()
      for (const did of dids) addLabeler(did)
    } catch {
      setImportError('could not read account labelers')
    } finally {
      setImportingLabelers(false)
    }
  }

  const signIn = () => {
    openDialog('login')
  }

  const handleSignOut = async () => {
    await signOut()
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="settings"
      onClose={onClose}
      className="b-settings"
      footer={
        <Button variant="ghost" onClick={onClose}>
          close
        </Button>
      }
    >
      <section className="b-settings__section">
        <h3 className="b-settings__heading">appearance</h3>
        <div className="b-settings__themes">
          {THEMES.map((item) => (
            <button
              key={item}
              type="button"
              className="b-settings__theme"
              data-active={theme === item ? 'true' : 'false'}
              aria-pressed={theme === item}
              onClick={() => {
                setTheme(item)
              }}
            >
              <span>{THEME_LABELS[item]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="b-settings__section">
        <h3 className="b-settings__heading">appview</h3>
        <div className="b-settings__appviews">
          {APPVIEW_PRESETS.map((preset) => {
            const active = sameAppView(appView, preset)
            return (
              <button
                key={preset.id}
                type="button"
                className="b-settings__appview"
                data-active={active ? 'true' : 'false'}
                aria-pressed={active}
                onClick={() => {
                  choosePreset(preset)
                }}
              >
                <span className="b-settings__appview-name">{preset.label}</span>
                <span className="b-settings__appview-host">{appViewHostname(preset)}</span>
                <span className="b-settings__appview-note">{preset.note}</span>
              </button>
            )
          })}
        </div>
        <TextInput
          label="custom host"
          placeholder="https://api.example.com"
          hint="https origin · public reads only"
          value={host}
          onChange={(event) => {
            setHost(event.target.value)
          }}
        />
        {invalidHost ? (
          <p className="b-settings__error">invalid host · use an https origin without a path</p>
        ) : null}
        <div className="b-settings__row">
          <Button variant="outline" disabled={custom === null} onClick={useCustom}>
            use custom appview
          </Button>
        </div>
      </section>

      <section className="b-settings__section">
        <h3 className="b-settings__heading">labelers</h3>
        <p className="b-settings__note">
          these labeler services are asked for labels on feed reads. labels still render as tags.
        </p>
        {details.isPending ? <p className="b-settings__note">resolving labeler services</p> : null}
        {details.error !== null ? (
          <p className="b-settings__error">could not resolve labeler details</p>
        ) : null}
        <ul className="b-settings__labelers">
          {labelers.map((did) => {
            const detail = detailByDid.get(did)
            const name = detail?.displayName ?? did
            return (
              <li key={did} className="b-settings__labeler">
                <span className="b-settings__labeler-main">
                  <span className="b-settings__labeler-name">{name}</span>
                  <span className="b-settings__labeler-did">@{detail?.handle ?? did}</span>
                  {detail !== undefined ? (
                    <span className="b-settings__labeler-meta">
                      <Tag>{detail.labelCount} labels</Tag>
                    </span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    removeLabeler(did)
                  }}
                >
                  remove
                </Button>
              </li>
            )
          })}
        </ul>
        {labelers.length === 0 ? <p className="b-settings__note">no labelers configured</p> : null}
        {account !== null ? (
          <div className="b-settings__row">
            <Button
              variant="outline"
              disabled={importingLabelers}
              onClick={() => void importFromAccount()}
            >
              {importingLabelers ? 'importing' : 'import from account'}
            </Button>
          </div>
        ) : null}
        {importError !== null ? <p className="b-settings__error">{importError}</p> : null}
        <div className="b-settings__labeler-add">
          <TextInput
            label="labeler did"
            placeholder="did:plc:…"
            value={labelerInput}
            onChange={(event) => {
              setLabelerInput(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              add()
            }}
          />
          <Button variant="outline" disabled={!validLabeler} onClick={add}>
            add labeler
          </Button>
        </div>
        {labelerInput.trim().length > 0 && !validLabeler ? (
          <p className="b-settings__error">enter a did</p>
        ) : null}
      </section>

      <section className="b-settings__section">
        <h3 className="b-settings__heading">account</h3>
        {account === null ? (
          <Button variant="outline" onClick={signIn}>
            sign in
          </Button>
        ) : (
          <div className="b-settings__account">
            <span className="b-settings__account-handle">@{account.handle}</span>
            <span className="b-settings__account-did">{account.did}</span>
            <Button variant="outline" onClick={() => void handleSignOut()}>
              sign out
            </Button>
          </div>
        )}
      </section>

      <section className="b-settings__section">
        <h3 className="b-settings__heading">help</h3>
        <Button variant="outline" onClick={onOpenHelp}>
          keyboard help
        </Button>
      </section>
    </Dialog>
  )
}
