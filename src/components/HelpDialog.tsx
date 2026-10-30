import { useEffect, useRef, useState } from 'react'
import { Dialog, Kbd } from './ui'

export interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

interface Shortcut {
  keys: readonly string[]
  what: string
}

interface ShortcutGroup {
  title: string
  note: string
  items: readonly Shortcut[]
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'anywhere',
    note: 'global keys; they apply when no dialog or composer is open',
    items: [
      { keys: ['/'], what: 'open the command prompt' },
      { keys: ['s'], what: 'go to search' },
      {
        keys: ['ctrl/cmd ←', 'ctrl/cmd →'],
        what: 'switch between the feed and notifications tabs',
      },
      { keys: ['a'], what: 'open the appview picker' },
      { keys: [','], what: 'open settings' },
      { keys: ['?'], what: 'open this help' },
      { keys: ['esc'], what: 'close a dialog or go back' },
    ],
  },
  {
    title: 'deck',
    note: 'moving between cards',
    items: [
      { keys: ['←', '→', 'h', 'l'], what: 'move between cards in a wide layout' },
      { keys: ['↑', '↓', 'j', 'k'], what: 'move between cards in a narrow layout' },
      { keys: ['g', 'G'], what: 'jump to the first or last card' },
      { keys: ['1-9'], what: 'focus a card by position' },
      { keys: ['↓'], what: 'open the full post from a card in a wide layout' },
      { keys: ['→'], what: 'open the full post from a card in a narrow layout' },
    ],
  },
  {
    title: 'deck · first card',
    note: 'the left edge of the posts deck',
    items: [{ keys: ['←'], what: 'open the feeds deck' }],
  },
  {
    title: 'feed',
    note: 'the feeds deck',
    items: [{ keys: ['←'], what: 'return to the posts deck from the first feed' }],
  },
  {
    title: 'feed actions',
    note: 'on a post shown inside a feed',
    items: [
      { keys: ['+'], what: 'show more posts like this' },
      { keys: ['-'], what: 'show fewer posts like this' },
      { keys: ['R R'], what: 'refresh the feed; press twice' },
    ],
  },
  {
    title: 'post',
    note: 'opening and reading the full post',
    items: [
      { keys: ['enter', 'space'], what: 'open replies on the focused card' },
      { keys: ['↑', 'k'], what: 'close the full post' },
      { keys: ['pgup', 'pgdn'], what: 'scroll the full post' },
      { keys: ['shift ↑', 'shift ↓'], what: 'scroll the full post one line at a time' },
    ],
  },
  {
    title: 'post actions',
    note: 'on the focused card',
    items: [
      { keys: ['f'], what: 'like or unlike' },
      { keys: ['b'], what: 'repost or unrepost' },
      { keys: ['r'], what: 'reply' },
      { keys: ['q'], what: 'quote' },
      { keys: ['y'], what: 'copy a bsky.app link to the post' },
      { keys: ['v'], what: 'play the focused post video inline' },
      { keys: ['m'], what: 'open media when present' },
      { keys: ['0'], what: 'open the quoted post when present' },
      { keys: ['d d'], what: 'delete your own post; press twice' },
    ],
  },
  {
    title: 'thread',
    note: 'the replies under a post',
    items: [
      { keys: ['↑', '↓'], what: 'move between replies' },
      { keys: ['1-9'], what: 'focus a reply by position' },
      { keys: ['enter'], what: 'open the focused reply as its own thread' },
    ],
  },
  {
    title: 'composer',
    note: 'writing a post',
    items: [
      { keys: ['c'], what: 'open the composer' },
      { keys: ['ctrl/cmd enter'], what: 'send from the composer' },
    ],
  },
]

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const needle = search.trim().toLowerCase()
  const groups =
    needle.length === 0
      ? SHORTCUT_GROUPS
      : SHORTCUT_GROUPS.map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            `${group.title} ${item.keys.join(' ')} ${item.what}`.toLowerCase().includes(needle),
          ),
        })).filter((group) => group.items.length > 0)

  useEffect(() => {
    if (!open) return
    setSearch('')
    const handleSearchKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== '/') return
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
        keys apply when no dialog or composer is open. a profile opened from a card gets a temporary
        tab.
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

      {groups.length === 0 ? (
        <p className="b-help__empty">no matching keybinding</p>
      ) : (
        <div className="b-help__groups">
          {groups.map((group) => (
            <section className="b-help__group" key={group.title}>
              <h3 className="b-help__heading mono-label">{group.title}</h3>
              <p className="b-help__group-note">{group.note}</p>
              <dl className="b-help__list">
                {group.items.map((shortcut) => (
                  <div className="b-help__row" key={`${shortcut.keys.join('+')}:${shortcut.what}`}>
                    <dt className="b-help__keys">
                      {shortcut.keys.map((key, index) => (
                        <span className="b-help__key" key={key}>
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
