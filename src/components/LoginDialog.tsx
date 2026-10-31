import { type FormEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { useAuthStore } from '../lib/auth'
import { canUseOAuth } from '../lib/oauth'
import { Button, Dialog, Tag, TextInput } from './ui'

export interface LoginDialogProps {
  open: boolean
  onClose: () => void
}

const APP_PASSWORD_URL = 'https://bsky.app/settings/app-passwords'

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const signIn = useAuthStore((state) => state.signIn)
  const signInWithPortal = useAuthStore((state) => state.signInWithPortal)
  const clearError = useAuthStore((state) => state.clearError)
  const pending = useAuthStore((state) => state.pending)
  const status = useAuthStore((state) => state.status)
  const error = useAuthStore((state) => state.error)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [pds, setPds] = useState('')
  const formId = useId()
  const identifierId = `${formId}-identifier`
  const passwordId = `${formId}-password`
  const errorId = `${formId}-error`
  // Monotonic id of the currently open instance. A submit captures it so a
  // completion can only touch the dialog instance it was started from, and a
  // close or reopen immediately invalidates every older completion.
  const openingRef = useRef(0)
  const [attemptOpening, setAttemptOpening] = useState<number | null>(null)
  const restoring = status === 'restoring'

  // A layout effect resets before paint, so a completion that settles right
  // after a reopened commit cannot race the token reset.
  useLayoutEffect(() => {
    openingRef.current += 1
    setAttemptOpening(null)
    if (open) {
      setIdentifier('')
      setPassword('')
      setPds('')
      clearError()
      return
    }
    setPassword('')
  }, [open, clearError])

  const close = () => {
    setPassword('')
    onClose()
  }

  // only an attempt made in the current opening may speak for it
  const shownError = attemptOpening === openingRef.current ? error : null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || restoring) return

    const opening = openingRef.current
    setAttemptOpening(opening)
    const host = pds.trim()
    const ok = await signIn(identifier, password, host.length > 0 ? host : undefined)
    if (ok && openingRef.current === opening) close()
  }

  const handlePortal = async () => {
    if (pending || restoring || identifier.trim().length === 0) return
    setAttemptOpening(openingRef.current)
    await signInWithPortal(identifier)
  }

  const portal = canUseOAuth()
  const disabled = pending || restoring || identifier.trim().length === 0 || password.length === 0

  return (
    <Dialog
      open={open}
      title="sign in"
      onClose={close}
      className="b-auth"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            cancel
          </Button>
          <Button type="submit" form={formId} variant="solid" disabled={disabled}>
            sign in
          </Button>
        </>
      }
    >
      <form id={formId} className="b-auth__form" onSubmit={handleSubmit}>
        <TextInput
          label="handle or did"
          id={identifierId}
          placeholder="@handle.bsky.social"
          autoComplete="username"
          value={identifier}
          aria-invalid={shownError !== null ? true : undefined}
          aria-describedby={shownError !== null ? errorId : undefined}
          onChange={(event) => {
            setIdentifier(event.target.value)
          }}
        />
        {portal ? (
          <>
            <div className="b-auth__portal">
              <Button
                type="button"
                variant="solid"
                disabled={pending || restoring || identifier.trim().length === 0}
                onClick={() => {
                  void handlePortal()
                }}
              >
                continue with bluesky
              </Button>
              <p className="b-auth__portal-note">
                opens the pds sign-in page. the password stays there.
              </p>
            </div>
            <p className="b-auth__divider">or use a password</p>
          </>
        ) : null}

        <TextInput
          label="password or app password"
          id={passwordId}
          type="password"
          autoComplete="current-password"
          hint="app passwords are safer where supported"
          value={password}
          aria-invalid={shownError !== null ? true : undefined}
          aria-describedby={shownError !== null ? errorId : undefined}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
        />

        <details className="b-auth__advanced">
          <summary>pds (optional)</summary>
          <TextInput
            label="pds host"
            placeholder="https://bsky.social"
            value={pds}
            onChange={(event) => {
              setPds(event.target.value)
            }}
          />
        </details>

        {shownError !== null ? (
          <p className="b-auth__error" id={errorId} role="alert">
            {shownError}
          </p>
        ) : null}

        <div className="b-auth__note">
          <Tag tone="accent">app password</Tag>
          <span>
            credentials are used only to sign in. the session tokens stay in local storage.
          </span>
        </div>

        <a
          className="b-auth__link"
          href={APP_PASSWORD_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          create an app password
        </a>
      </form>
    </Dialog>
  )
}
