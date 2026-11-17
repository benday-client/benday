import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../lib/auth'
import { AccountDialog } from './AccountDialog'

function dialogOf(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog')
  if (dialog === null) throw new Error('account dialog missing')
  return dialog
}

async function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => {
    await promise
  })
}

function renderAccount() {
  const onClose = vi.fn()

  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true)
          }}
        >
          reopen account
        </button>
        <AccountDialog
          open={open}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      </>
    )
  }

  const result = render(<Harness />)
  return { ...result, onClose }
}

const ACCOUNT = { did: 'did:plc:accountowner', handle: 'owner.test' }
const realSignOut = useAuthStore.getState().signOut

beforeEach(() => {
  // no themed exit animation: closing takes effect at once
  delete document.documentElement.dataset['theme']
  useAuthStore.setState({ status: 'authenticated', account: ACCOUNT, pending: false })
})

afterEach(() => {
  useAuthStore.setState({
    signOut: realSignOut,
    status: 'anonymous',
    account: null,
    pending: false,
    error: null,
  })
})

describe('AccountDialog', () => {
  it('names the signed-in account', () => {
    renderAccount()

    expect(screen.getByText('@owner.test')).toBeInTheDocument()
    expect(screen.getByText('did:plc:accountowner')).toBeInTheDocument()
    expect(screen.getByText('session stored locally')).toBeInTheDocument()
  })

  it('says when nobody is signed in', () => {
    useAuthStore.setState({ status: 'anonymous', account: null })
    renderAccount()

    expect(screen.getByText('not signed in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sign out' })).toBeNull()
  })

  it('closes exactly once when the current sign-out settles', async () => {
    const deferred = Promise.withResolvers<void>()
    const signOut = vi.fn(() => deferred.promise)
    useAuthStore.setState({ signOut })

    const { container, onClose } = renderAccount()
    const button = screen.getByRole('button', { name: 'sign out' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()

    deferred.resolve()
    await settle()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogOf(container).open).toBe(false)
  })

  it('keeps the dialog open on a failed revocation', async () => {
    const signOut = vi.fn(async () => {
      useAuthStore.setState({
        status: 'anonymous',
        account: null,
        error: 'signed out on this device, but revocation failed: offline',
      })
    })
    useAuthStore.setState({ signOut })

    const { container, onClose } = renderAccount()
    fireEvent.click(screen.getByRole('button', { name: 'sign out' }))
    await settle()

    // the local sign-out stands; the dialog says the remote revocation failed
    // instead of closing silently
    expect(dialogOf(container).open).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'signed out on this device, but revocation failed: offline',
    )
  })

  it('ignores a completion that settles after the dialog was reopened', async () => {
    const deferred = Promise.withResolvers<void>()
    const signOut = vi.fn(() => deferred.promise)
    useAuthStore.setState({ signOut })

    const { container, onClose } = renderAccount()
    fireEvent.click(screen.getByRole('button', { name: 'sign out' }))

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogOf(container).open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'reopen account' }))
    const dialog = dialogOf(container)
    expect(dialog.open).toBe(true)

    deferred.resolve()
    await settle()

    expect(dialog.open).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'sign out' })).toBeEnabled()
  })
})
