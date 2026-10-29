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
      { keys: '/ or ctrl/cmd k', what: 'jump' },
      { keys: 's', what: 'search' },
      { keys: 'a', what: 'appviews' },
      { keys: ',', what: 'settings' },
      { keys: '?', what: 'keyboard help' },
      { keys: 'ctrl/cmd ← →', what: 'switch tabs' },
      { keys: 'esc', what: 'close a dialog or go back' },
    ],
  },
  {
    title: 'cards',
    items: [
      { keys: '← → / h l', what: 'scan on laptop' },
      { keys: '↑ ↓ / j k', what: 'scan on mobile' },
      { keys: 'g / G', what: 'first / last card' },
      { keys: '← at first post', what: 'open the feeds deck' },
      { keys: '← at first feed', what: 'back to posts' },
      { keys: 'enter / space', what: 'open replies' },
      { keys: '1', what: 'open the quoted post' },
      { keys: '↓ wide · → narrow', what: 'open the full post' },
    ],
  },
  {
    title: 'card actions',
    items: [
      { keys: 'f', what: 'like' },
      { keys: 'b', what: 'repost' },
      { keys: 'r', what: 'reply' },
      { keys: 'q', what: 'quote' },
      { keys: '+', what: 'more like this' },
      { keys: '-', what: 'less like this' },
      { keys: 'd d', what: 'delete own post' },
    ],
  },
  {
    title: 'reading',
    items: [
      { keys: '↑ / k', what: 'close the full post' },
      { keys: '↑ ↓ in replies', what: 'focus reply rows' },
      { keys: 'enter on a reply', what: 'open that reply' },
      { keys: 'pgup / pgdn', what: 'scroll the focused post' },
      { keys: 'shift ↑ ↓', what: 'scroll the focused post' },
    ],
  },
  {
    title: 'writing',
    items: [
      { keys: 'c', what: 'compose a post' },
      { keys: 'ctrl/cmd enter', what: 'send' },
    ],
  },
]

export function HelpDialog({ open, onClose }: HelpDialogProps) {
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

      <div className="b-help__groups">
        {SHORTCUT_GROUPS.map((group) => (
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
    </Dialog>
  )
}
