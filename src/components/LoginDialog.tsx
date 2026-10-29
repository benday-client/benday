import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
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
  // Survives across the await of a sign-in so a completion only closes the
  // dialog it started in, never one the user opened afterwards.
  const openRef = useRef(open)
  openRef.current = open
  const restoring = status === 'restoring'

  useEffect(() => {
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || restoring) return

    const host = pds.trim()
    const ok = await signIn(identifier, password, host.length > 0 ? host : undefined)
    if (ok && openRef.current) close()
  }

  const handlePortal = async () => {
    if (pending || restoring || identifier.trim().length === 0) return
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
          placeholder="@handle.bsky.social"
          autoComplete="username"
          value={identifier}
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
                opens the sign-in page for your pds. the password stays there.
              </p>
            </div>
            <p className="b-auth__divider">or use a password</p>
          </>
        ) : null}

        <TextInput
          label="password or app password"
          type="password"
          autoComplete="current-password"
          hint="prefer an app password when your pds supports it"
          value={password}
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

        {error !== null ? (
          <p className="b-auth__error" role="alert">
            {error}
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
