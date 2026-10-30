import { type ChangeEvent, useEffect, useRef, useState } from 'react'
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
import {
  parseSettingsFileJson,
  SETTINGS_FILE_NAME,
  serializeSettings,
} from '../lib/settingsTransfer'
import { useSettings } from '../lib/store'
import {
  availableThemeGroups,
  SEASONAL_THEMES,
  THEME_EFFECTS,
  THEME_LABELS,
  themeAvailable,
} from '../lib/themes'
import type { AppViewPreset } from '../lib/types'
import { useUiStore } from '../lib/ui'
import { ThemePreview } from './ThemePreview'
import { Button, Dialog, Tag, TextInput } from './ui'

interface SettingSearchEntry {
  id: string
  label: string
  keywords: string
}

const SETTING_SEARCH: readonly SettingSearchEntry[] = [
  {
    id: 'settings-appearance',
    label: 'appearance',
    keywords: `theme themes colors image effects dither grunge light dark system ${Object.values(THEME_LABELS).join(' ')}`,
  },
  {
    id: 'settings-appview',
    label: 'appview',
    keywords: `host server instance custom ${APPVIEW_PRESETS.map((preset) => `${preset.label} ${preset.host}`).join(' ')}`,
  },
  { id: 'settings-labelers', label: 'labelers', keywords: 'labels moderation did import account' },
  { id: 'settings-transfer', label: 'transfer', keywords: 'import export settings file backup' },
  { id: 'settings-account', label: 'account', keywords: 'sign in sign out login session' },
]

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const appView = useSettings((state) => state.appView)
  const setAppView = useSettings((state) => state.setAppView)
  const theme = useSettings((state) => state.theme)
  const appearance = useSettings((state) => state.appearance)
  const setAppearance = useSettings((state) => state.setAppearance)
  const lightTheme = useSettings((state) => state.lightTheme)
  const darkTheme = useSettings((state) => state.darkTheme)
  const setLightTheme = useSettings((state) => state.setLightTheme)
  const setDarkTheme = useSettings((state) => state.setDarkTheme)
  const imageEffects = useSettings((state) => state.imageEffects)
  const setImageEffects = useSettings((state) => state.setImageEffects)
  const labelers = useSettings((state) => state.labelers)
  const addLabeler = useSettings((state) => state.addLabeler)
  const removeLabeler = useSettings((state) => state.removeLabeler)
  const importSettings = useSettings((state) => state.importSettings)
  const account = useAuthStore((state) => state.account)
  const signOut = useAuthStore((state) => state.signOut)
  const openDialog = useUiStore((state) => state.openDialog)
  const [host, setHost] = useState('')
  const [labelerInput, setLabelerInput] = useState('')
  const [importingLabelers, setImportingLabelers] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferNotice, setTransferNotice] = useState<string | null>(null)
  const [settingQuery, setSettingQuery] = useState('')
  const settingsFileInput = useRef<HTMLInputElement>(null)
  const settingSearchRef = useRef<HTMLInputElement>(null)
  const details = useLabelerDetails(labelers)
  const today = new Date()
  const themeGroups = [...availableThemeGroups(today)].reverse()
  const seasonalThemesHidden = SEASONAL_THEMES.some((item) => !themeAvailable(item, today))
  const normalizedQuery = settingQuery.trim().toLowerCase()
  const settingMatches =
    normalizedQuery.length === 0
      ? []
      : SETTING_SEARCH.filter((entry) =>
          `${entry.label} ${entry.keywords}`.toLowerCase().includes(normalizedQuery),
        )
  const visibleEffectThemes = appearance === 'system' ? [lightTheme, darkTheme] : [theme]
  const imageEffectAvailable = visibleEffectThemes.some(
    (visibleTheme) => THEME_EFFECTS[visibleTheme] !== 'none',
  )
  const queryActive = normalizedQuery.length > 0
  const sectionHidden = (id: string): 'true' | undefined =>
    queryActive && !settingMatches.some((entry) => entry.id === id) ? 'true' : undefined

  useEffect(() => {
    if (open) setHost(appView.kind === 'custom' ? appView.host : '')
  }, [open, appView])

  useEffect(() => {
    if (!open) return
    const handleSearchKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== '/') return
      if (event.target instanceof HTMLElement) {
        if (event.target.isContentEditable) return
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      }
      event.preventDefault()
      settingSearchRef.current?.focus()
    }
    window.addEventListener('keydown', handleSearchKey)
    return () => {
      window.removeEventListener('keydown', handleSearchKey)
    }
  }, [open])

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

  const exportSettings = () => {
    setTransferError(null)
    setTransferNotice(null)
    const json = serializeSettings({
      theme,
      appearance,
      lightTheme,
      darkTheme,
      imageEffects,
      appView,
      labelers,
    })
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = SETTINGS_FILE_NAME
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    link.remove()
    // let the browser claim the blob before the object url is dropped
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 0)
    setTransferNotice('settings exported')
  }

  const importSettingsFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // clearing lets the same file be picked again after a failed import
    event.target.value = ''
    if (file === undefined) return

    setTransferError(null)
    setTransferNotice(null)

    let text: string
    try {
      text = await file.text()
    } catch {
      setTransferError('could not read settings file')
      return
    }

    const result = parseSettingsFileJson(text)
    if (!result.ok) {
      setTransferError(result.error)
      return
    }
    if (!importSettings(result.settings)) {
      setTransferError('could not apply settings')
      return
    }
    setTransferNotice('settings imported')
  }

  return (
    <Dialog open={open} title="settings" onClose={onClose} className="b-settings" headerClose>
      <div className="b-settings__search">
        <input
          ref={settingSearchRef}
          type="search"
          className="b-settings__search-input"
          aria-label="search settings"
          placeholder="search settings · /"
          value={settingQuery}
          onChange={(event) => {
            setSettingQuery(event.currentTarget.value)
          }}
        />
        {queryActive && settingMatches.length === 0 ? (
          <p className="b-settings__search-empty">no matching setting</p>
        ) : null}
      </div>
      <section
        id="settings-appearance"
        className="b-settings__section"
        data-hidden={sectionHidden('settings-appearance')}
      >
        <h3 className="b-settings__heading">appearance</h3>
        <fieldset className="b-settings__appearance-mode">
          <legend className="visually-hidden">appearance mode</legend>
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="b-settings__mode"
              data-active={appearance === mode ? 'true' : 'false'}
              aria-pressed={appearance === mode}
              onClick={() => {
                setAppearance(mode)
              }}
            >
              {mode}
            </button>
          ))}
        </fieldset>
        <label className="b-settings__toggle">
          <input
            type="checkbox"
            checked={imageEffects}
            disabled={!imageEffectAvailable}
            onChange={(event) => {
              setImageEffects(event.currentTarget.checked)
            }}
          />
          <span>image effects</span>
          <span className="b-settings__toggle-note">
            {!imageEffectAvailable ? 'visible themes keep images raw' : 'dither and grunge'}
          </span>
        </label>
        <ThemePreview />
        <div className="b-settings__theme-groups">
          {themeGroups.map((group) => {
            const selected = group.scheme === 'light' ? lightTheme : darkTheme
            return (
              <section className="b-settings__theme-group" key={group.scheme}>
                <h4 className="b-settings__subheading mono-label">{group.scheme}</h4>
                <div className="b-settings__themes">
                  {group.themes.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="b-settings__theme"
                      data-active={selected === item ? 'true' : 'false'}
                      data-current={theme === item ? 'true' : 'false'}
                      aria-pressed={selected === item}
                      onClick={() => {
                        if (group.scheme === 'light') {
                          setLightTheme(item)
                        } else {
                          setDarkTheme(item)
                        }
                      }}
                    >
                      <span>{THEME_LABELS[item]}</span>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
        {seasonalThemesHidden ? (
          <p className="b-settings__note">seasonal themes return in october</p>
        ) : null}
      </section>

      <section
        id="settings-appview"
        className="b-settings__section"
        data-hidden={sectionHidden('settings-appview')}
      >
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

      <section
        id="settings-labelers"
        className="b-settings__section"
        data-hidden={sectionHidden('settings-labelers')}
      >
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

      <section
        id="settings-transfer"
        className="b-settings__section"
        data-hidden={sectionHidden('settings-transfer')}
      >
        <h3 className="b-settings__heading">transfer</h3>
        <p className="b-settings__note">
          move theme appview and labelers between browsers with one json file. sessions,
          credentials, drafts and account data are never included.
        </p>
        <div className="b-settings__row">
          <Button variant="outline" onClick={exportSettings}>
            export settings
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              settingsFileInput.current?.click()
            }}
          >
            import settings
          </Button>
          <input
            ref={settingsFileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              void importSettingsFile(event)
            }}
          />
        </div>
        {transferNotice !== null ? <p className="b-settings__note">{transferNotice}</p> : null}
        {transferError !== null ? (
          <p className="b-settings__error" role="alert">
            {transferError}
          </p>
        ) : null}
      </section>

      <section
        id="settings-account"
        className="b-settings__section"
        data-hidden={sectionHidden('settings-account')}
      >
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
    </Dialog>
  )
}
