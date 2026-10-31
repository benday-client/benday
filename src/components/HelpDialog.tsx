import { useEffect, useRef, useState } from 'react'
import { bindingsForScope, characterShortcutAllowed, displayKeys, SCOPES } from '../lib/keymap'
import { matchesSearchTokens } from '../lib/searchTokens'
import { useSettings } from '../lib/store'
import { Dialog, Kbd } from './ui'

export interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

interface Shortcut {
  id: string
  keys: readonly string[]
  what: string
}

interface ShortcutGroup {
  title: string
  note: string
  items: readonly Shortcut[]
}

// every row comes from the keyboard registry, so a new binding documents
// itself and the README/help drift has one place left to fix
const SHORTCUT_GROUPS: readonly ShortcutGroup[] = SCOPES.map((meta) => ({
  title: meta.title,
  note: meta.note,
  items: bindingsForScope(meta.scope).map((binding) => ({
    id: binding.id,
    keys: displayKeys(binding),
    what: binding.label,
  })),
})).filter((group) => group.items.length > 0)

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // every whitespace-separated token has to appear, in any order; the section
  // title counts as searchable text alongside the keys and the action name
  const groups = SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      matchesSearchTokens(`${group.title} ${item.keys.join(' ')} ${item.what}`, search),
    ),
  })).filter((group) => group.items.length > 0)

  useEffect(() => {
    if (!open) return
    setSearch('')
    const handleSearchKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== '/') return
      // bare characters obey the character-shortcut preference
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return
      if (event.target instanceof HTMLElement) {
        if (event.target.isContentEditable) return
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      }
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', handleSearchKey)
    return () => {
      window.removeEventListener('keydown', handleSearchKey)
    }
  }, [open])

  return (
    <Dialog open={open} title="keyboard" onClose={onClose} className="b-help" headerClose>
      <p className="b-help__note">
        global and per-surface keys are grouped below. a profile opened from a card gets a temporary
        tab.
      </p>

      <p className="b-help__note b-help__hold-note">
        hold <Kbd>?</Kbd> to reveal the keys over the controls it can run.
      </p>

      <div className="b-help__search">
        <input
          ref={searchRef}
          type="search"
          className="b-help__search-input"
          aria-label="search keybindings"
          placeholder="search keys · /"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value)
          }}
        />
      </div>

      {/* the status stays mounted so a query that matches nothing is announced
          from a live region that already existed */}
      <p className="b-help__empty" role="status" aria-live="polite" aria-atomic="true">
        {groups.length === 0 ? 'no matching keybinding' : ''}
      </p>

      {groups.length === 0 ? null : (
        <div className="b-help__groups">
          {groups.map((group) => (
            <section className="b-help__group" key={group.title}>
              <h3 className="b-help__heading mono-label">{group.title}</h3>
              <p className="b-help__group-note">{group.note}</p>
              <dl className="b-help__list">
                {group.items.map((shortcut) => (
                  <div className="b-help__row" key={shortcut.id}>
                    <dt className="b-help__keys">
                      {shortcut.keys.map((key, index) => (
                        <span className="b-help__key" key={`${shortcut.id}:${index}`}>
                          {index > 0 ? (
                            <span className="b-help__or" aria-hidden="true">
                              /
                            </span>
                          ) : null}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="b-help__what">{shortcut.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  )
}
