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
  { keys: 'g / G', what: 'first / last card' },
  { keys: 'enter / space', what: 'open replies' },
  { keys: 'esc', what: 'back out of replies' },
  { keys: '/ or ctrl/cmd+k', what: 'jump' },
  { keys: 'ctrl/cmd ← →', what: 'switch tabs' },
  { keys: 's', what: 'search' },
  { keys: 'c', what: 'compose' },
  { keys: 'a', what: 'appviews' },
  { keys: 't', what: 'themes menu' },
  { keys: 'v b o p m l d a g h u', what: 'pick a theme' },
  { keys: 'f', what: 'like the focused card' },
  { keys: 'b', what: 'repost the focused card' },
  { keys: 'r', what: 'reply to the focused card' },
  { keys: 'q', what: 'quote the focused card' },
  { keys: 'd d', what: 'delete your focused post' },
  { keys: '?', what: 'help' },
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
        sign in to like, repost, quote and reply. sessions stay local. themes are void, bone, oxide,
        phosphor, catppuccin, dracula, atom one dark, github, duotone and cyberpunk 2077.
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
