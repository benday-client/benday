import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { isEditableTarget, isImeComposing } from '../hooks/useHotkeys'
import { useAuthStore } from '../lib/auth'
import { bindingFor, characterShortcutAllowed, matchesBinding } from '../lib/keymap'
import { matchesSearchTokens } from '../lib/searchTokens'
import {
  parseSettingsFileJson,
  SETTINGS_FILE_NAME,
  serializeSettings,
} from '../lib/settingsTransfer'
import { useSettings } from '../lib/store'
import { Button, Dialog } from './ui'

interface SettingSearchEntry {
  id: string
  label: string
  keywords: string
}

// a portable settings file is tiny; anything larger is not this format
const MAX_SETTINGS_FILE_BYTES = 256 * 1024

// the dialog's bare characters come from the same registry the palette and the
// help list use, so a rebinding lands here too
const SEARCH_BINDING = bindingFor('dialog-search')
const CLOSE_BINDING = bindingFor('dialog-close')

const SETTING_SEARCH: readonly SettingSearchEntry[] = [
  {
    id: 'settings-appearance',
    label: 'appearance',
    keywords:
      'theme themes colors dither grunge image effects dither effects mode accessibility readable keyboard shortcuts wcag single key light dark system',
  },
  { id: 'settings-transfer', label: 'transfer', keywords: 'import export settings file backup' },
  { id: 'settings-account', label: 'account', keywords: 'sign in sign out login session' },
]

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const appearance = useSettings((state) => state.appearance)
  const setAppearance = useSettings((state) => state.setAppearance)
  const keyboardShortcuts = useSettings((state) => state.keyboardShortcuts)
  const setKeyboardShortcuts = useSettings((state) => state.setKeyboardShortcuts)
  const imageEffects = useSettings((state) => state.imageEffects)
  const setImageEffects = useSettings((state) => state.setImageEffects)
  const importSettings = useSettings((state) => state.importSettings)
  const account = useAuthStore((state) => state.account)
  const pending = useAuthStore((state) => state.pending)
  const signOut = useAuthStore((state) => state.signOut)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferNotice, setTransferNotice] = useState<string | null>(null)
  const [settingQuery, setSettingQuery] = useState('')
  const settingsFileInput = useRef<HTMLInputElement>(null)
  const settingSearchRef = useRef<HTMLInputElement>(null)
  // Monotonic id of the currently open instance. A sign-out captures it so a
  // completion can only close the opening it was started from.
  const openingRef = useRef(0)
  // the latest file pick owns the transfer; an older read that resolves last
  // cannot apply its settings or report into a newer opening
  const transferRef = useRef(0)
  const [signOutOpening, setSignOutOpening] = useState<number | null>(null)
  const settingMatches = SETTING_SEARCH.filter((entry) =>
    matchesSearchTokens(`${entry.label} ${entry.keywords}`, settingQuery),
  )
  const queryActive = settingQuery.trim().length > 0
  const sectionHidden = (id: string): 'true' | undefined =>
    queryActive && !settingMatches.some((entry) => entry.id === id) ? 'true' : undefined

  // A layout effect resets before paint, so a completion that settles right
  // after a reopened commit cannot touch the newer opening, and the search
  // filter never shows a previous opening's query for a frame.
  useLayoutEffect(() => {
    openingRef.current += 1
    setSignOutOpening(null)
    if (!open) return
    setSettingQuery('')
    // a fresh open starts clean; an in-flight transfer stays untouched while
    // the dialog remains open
    setTransferError(null)
    setTransferNotice(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleSearchKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (!matchesBinding(event, SEARCH_BINDING)) return
      // bare characters obey the character-shortcut preference
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      // an IME owns the key that commits its composition
      if (isImeComposing(event)) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      settingSearchRef.current?.focus()
    }
    window.addEventListener('keydown', handleSearchKey)
    return () => {
      window.removeEventListener('keydown', handleSearchKey)
    }
  }, [open])

  const handleSignOut = async () => {
    if (pending || signOutOpening !== null) return
    const opening = openingRef.current
    setSignOutOpening(opening)
    try {
      await signOut()
    } finally {
      // only the opening that started the request may be dismissed by it; a
      // stale completion leaves a reopened dialog alone. The token reset on the
      // next open clears the pending control.
      if (openingRef.current === opening) onClose()
    }
  }

  const exportSettings = () => {
    setTransferError(null)
    setTransferNotice(null)
    const json = serializeSettings({
      appearance,
      keyboardShortcuts,
      imageEffects,
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

    const opening = openingRef.current
    const transfer = ++transferRef.current

    setTransferError(null)
    setTransferNotice(null)

    // a settings file is a few kilobytes; refuse an oversized one before the
    // reader's browser loads it into memory, and leave settings untouched
    if (file.size > MAX_SETTINGS_FILE_BYTES) {
      setTransferError('settings file is too large · maximum 256 kib')
      return
    }

    let text: string
    try {
      text = await file.text()
    } catch {
      if (opening === openingRef.current && transfer === transferRef.current) {
        setTransferError('could not read settings file')
      }
      return
    }
    // a newer pick or another opening replaced this read while it waited
    if (opening !== openingRef.current || transfer !== transferRef.current) return

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

  // the dialog body is the scroll container now, so arrows have to move it
  // themselves; , closes the panel the way it opens it
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    // an IME owns the key that commits its composition
    if (isImeComposing(event.nativeEvent)) return
    if (isEditableTarget(event.target)) return

    if (matchesBinding(event, CLOSE_BINDING)) {
      // bare characters obey the character-shortcut preference
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      event.preventDefault()
      onClose()
      return
    }

    const body = event.currentTarget.querySelector<HTMLElement>('.b-dialog__body')
    if (body === null || body.scrollHeight <= body.clientHeight) return
    const page = Math.round(body.clientHeight * 0.85)
    const top = body.scrollTop
    const next =
      event.key === 'ArrowDown'
        ? top + 40
        : event.key === 'ArrowUp'
          ? top - 40
          : event.key === 'PageDown'
            ? top + page
            : event.key === 'PageUp'
              ? top - page
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? body.scrollHeight
                  : null
    if (next === null) return
    event.preventDefault()
    body.scrollTop = next
  }

  return (
    <Dialog
      open={open}
      title="settings"
      onClose={onClose}
      className="b-settings"
      headerClose
      onKeyDown={handleKeyDown}
    >
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
        <p className="b-settings__search-empty" role="status">
          {queryActive && settingMatches.length === 0 ? 'no matching setting' : ''}
        </p>
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
            checked={keyboardShortcuts}
            onChange={(event) => {
              setKeyboardShortcuts(event.currentTarget.checked)
            }}
          />
          <span>keyboard shortcuts</span>
          <span className="b-settings__toggle-note">
            single keys like f and j; modifier chords always work
          </span>
        </label>
        <label className="b-settings__toggle">
          <input
            type="checkbox"
            checked={imageEffects}
            onChange={(event) => {
              setImageEffects(event.currentTarget.checked)
            }}
          />
          <span>dither effects</span>
          <span className="b-settings__toggle-note">
            the grunge ordered dither on images and video posters
          </span>
        </label>
      </section>

      <section
        id="settings-transfer"
        className="b-settings__section"
        data-hidden={sectionHidden('settings-transfer')}
      >
        <h3 className="b-settings__heading">transfer</h3>
        <p className="b-settings__note">
          move the appearance mode, dither effects and keyboard shortcuts between browsers with one
          json file. sessions, credentials, drafts and account data are never included.
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
        <p className="b-settings__note" role="status">
          {transferNotice ?? ''}
        </p>
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
        {account === null ? null : (
          <div className="b-settings__account">
            <span className="b-settings__account-handle">@{account.handle}</span>
            <span className="b-settings__account-did">{account.did}</span>
            <Button
              variant="outline"
              disabled={pending || signOutOpening !== null}
              onClick={() => void handleSignOut()}
            >
              sign out
            </Button>
          </div>
        )}
      </section>
    </Dialog>
  )
}
