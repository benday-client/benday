import { Button, Dialog, Kbd } from './ui'

export interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

interface Shortcut {
  keys: string
  what: string
}

const SHORTCUTS: readonly Shortcut[] = [
  { keys: '← → / h l', what: 'scan cards on laptop' },
  { keys: '↑ ↓ / j k', what: 'scan cards on mobile' },
  { keys: '↓ wide · → narrow', what: 'open comments' },
  { keys: 'g / G', what: 'first / last card' },
  { keys: 'enter', what: 'open thread' },
  { keys: '/ or ctrl/cmd+k', what: 'jump' },
  { keys: 's', what: 'search' },
  { keys: 'c', what: 'compose' },
  { keys: 'a', what: 'appviews' },
  { keys: 't', what: 'themes' },
  { keys: 'f', what: 'flow' },
  { keys: '?', what: 'help' },
  { keys: 'esc', what: 'close' },
]

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  return (
    <Dialog
      open={open}
      title="keys"
      onClose={onClose}
      className="b-help"
      footer={
        <Button variant="ghost" onClick={onClose}>
          close
        </Button>
      }
    >
      <p className="b-help__note">
        sign in to like, repost, quote and reply. sessions stay local. themes cycle void, bone,
        oxide and phosphor.
      </p>

      <dl className="b-help__grid">
        {SHORTCUTS.map((shortcut) => (
          <div className="b-help__section" key={shortcut.keys}>
            <dt className="b-help__keys">
              <Kbd>{shortcut.keys}</Kbd>
            </dt>
            <dd className="b-help__what">{shortcut.what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
