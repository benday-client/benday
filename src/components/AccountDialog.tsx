import { useLayoutEffect, useRef, useState } from 'react'
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
  // Monotonic id of the currently open instance. Sign-out captures it, so a
  // completion can only close the opening it was started from.
  const openingRef = useRef(0)
  const [signOutOpening, setSignOutOpening] = useState<number | null>(null)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  // resetting before paint keeps a stale completion from touching a reopened
  // dialog on the frame the reopen commits
  useLayoutEffect(() => {
    openingRef.current += 1
    setSignOutOpening(null)
    setSignOutError(null)
  }, [open])

  const handleSignOut = async () => {
    if (pending || signOutOpening !== null) return
    const opening = openingRef.current
    setSignOutOpening(opening)
    setSignOutError(null)
    // A failed portal revocation does not reject: the reader is signed out
    // locally, and the control that started it says why it stays that way.
    let failed = false
    try {
      await signOut()
      const failure = useAuthStore.getState().error
      if (failure !== null && openingRef.current === opening) {
        failed = true
        setSignOutError(failure)
      }
    } finally {
      // only the opening that started the request may be dismissed by it; the
      // token reset on the next open clears the pending control
      if (!failed && openingRef.current === opening) onClose()
    }
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
      {signOutError !== null ? (
        <p className="b-account__error" role="alert">
          {signOutError}
        </p>
      ) : null}
      {account === null ? (
        <p className="b-account__note">not signed in</p>
      ) : (
        <>
          <span className="b-account__handle">@{account.handle}</span>
          <span className="b-account__did">{account.did}</span>
          <p className="b-account__note">{note}</p>
          <div className="b-account__actions">
            <Button
              variant="outline"
              disabled={pending || signOutOpening !== null}
              onClick={() => void handleSignOut()}
            >
              sign out
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
