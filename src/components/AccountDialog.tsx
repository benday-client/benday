import { useRef } from 'react'
import { useAuthStore } from '../lib/auth'
import { Button, Dialog } from './ui'

export interface AccountDialogProps {
  open: boolean
  onClose: () => void
}

export function AccountDialog({ open, onClose }: AccountDialogProps) {
  const account = useAuthStore((state) => state.account)
  const status = useAuthStore((state) => state.status)
  const pending = useAuthStore((state) => state.pending)
  const signOut = useAuthStore((state) => state.signOut)
  // Sign-out awaits a revocation; only close if this dialog is still the open
  // one when it finishes.
  const openRef = useRef(open)
  openRef.current = open

  const handleSignOut = async () => {
    if (pending) return
    await signOut()
    if (openRef.current) onClose()
  }

  const note = status === 'restoring' ? 'restoring the stored session' : 'session stored locally'

  return (
    <Dialog
      open={open}
      title="account"
      onClose={onClose}
      className="b-account"
      footer={
        <Button variant="ghost" onClick={onClose}>
          close
        </Button>
      }
    >
      {account === null ? (
        <p className="b-account__note">not signed in</p>
      ) : (
        <>
          <span className="b-account__handle">@{account.handle}</span>
          <span className="b-account__did">{account.did}</span>
          <p className="b-account__note">{note}</p>
          <div className="b-account__actions">
            <Button variant="outline" disabled={pending} onClick={handleSignOut}>
              sign out
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
