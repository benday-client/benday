import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Kbd } from './ui'

export interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

interface Shortcut {
  keys: string
  what: string
}

interface ShortcutGroup {
  title: string
  items: readonly Shortcut[]
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'anywhere',
    items: [
      { keys: '/', what: 'open the command prompt' },
      { keys: 's', what: 'go to search' },
      { keys: 'ctrl/cmd ← →', what: 'switch feed / notifications tabs' },
      { keys: 'a', what: 'open appview picker' },
      { keys: ',', what: 'open settings' },
      { keys: '?', what: 'open this help' },
      { keys: 'esc', what: 'close a dialog or go back' },
    ],
  },
  {
    title: 'move',
    items: [
      { keys: '← → / h l', what: 'move between cards (wide)' },
      { keys: '↑ ↓ / j k', what: 'move between cards (narrow)' },
      { keys: 'g / G', what: 'first / last card' },
      { keys: '1-9', what: 'focus card by position' },
      { keys: '← at first post', what: 'open the feeds deck' },
      { keys: '← at first feed', what: 'return to posts' },
      { keys: 'enter / space', what: 'open replies on the focused card' },
      { keys: '↓ wide · → narrow', what: 'open the full post' },
    ],
  },
  {
    title: 'card actions',
    items: [
      { keys: 'f', what: 'like / unlike' },
      { keys: 'b', what: 'repost / unrepost' },
      { keys: 'r', what: 'reply' },
      { keys: 'q', what: 'quote' },
      { keys: 'v', what: 'play the focused post video inline' },
      { keys: 'm', what: 'open media when present' },
      { keys: '0', what: 'open quoted post when present' },
      { keys: '+', what: 'more posts like this in a feed' },
      { keys: '-', what: 'less posts like this in a feed' },
      { keys: 'd d', what: 'delete own post (press twice)' },
      { keys: 'R R', what: 'refresh the feed (press twice)' },
    ],
  },
  {
    title: 'thread',
    items: [
      { keys: '↑ / k', what: 'close the full post' },
      { keys: '↑ ↓ in replies', what: 'move between replies' },
      { keys: '1-9 in a thread', what: 'focus reply by position' },
      { keys: 'enter on a reply', what: 'open that reply as its own thread' },
      { keys: 'pgup / pgdn', what: 'scroll the full post' },
      { keys: 'shift ↑ ↓', what: 'scroll the full post' },
    ],
  },
  {
    title: 'write',
    items: [
      { keys: 'c', what: 'compose a post' },
      { keys: 'ctrl/cmd enter', what: 'send from the composer' },
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
            `${item.keys} ${item.what}`.toLowerCase().includes(needle),
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
    <Dialog
      open={open}
      title="keyboard"
      onClose={onClose}
      className="b-help"
      footer={
        <Button variant="ghost" onClick={onClose}>
          close
        </Button>
      }
    >
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
              <dl className="b-help__list">
                {group.items.map((shortcut) => (
                  <div className="b-help__row" key={shortcut.keys}>
                    <dt className="b-help__keys">
                      <Kbd>{shortcut.keys}</Kbd>
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
