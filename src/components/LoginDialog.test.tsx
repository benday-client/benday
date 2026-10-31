import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../lib/auth'
import { installTransport, jsonResponse } from '../test/transport'
import { LoginDialog } from './LoginDialog'

const oauthControl = vi.hoisted(() => ({ portalError: 'portal unavailable' }))

// The portal chat is external I/O; everything the dialog itself owns stays real.
vi.mock('../lib/oauth', () => ({
  canUseOAuth: () => true,
  restoreOAuth: async () => null,
  signInOAuth: async () => {
    throw new Error(oauthControl.portalError)
  },
  signOutOAuth: async () => {},
}))

const PDS = 'https://pds.test'
const CREATE_SESSION = `${PDS}/xrpc/com.atproto.server.createSession`

const SESSION = {
  accessJwt: 'access-jwt',
  refreshJwt: 'refresh-jwt',
  handle: 'fresh.test',
  did: 'did:plc:freshaccount',
  active: true,
}

function dialogOf(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog')
  if (dialog === null) throw new Error('login dialog missing')
  return dialog
}

function formOf(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form')
  if (form === null) throw new Error('login form missing')
  return form
}

function inputs() {
  return {
    identifier: screen.getByLabelText('handle or did'),
    password: screen.getByLabelText('password or app password'),
    pds: screen.getByLabelText('pds host'),
  }
}

function fillLogin(identifier: string, password: string): void {
  const fields = inputs()
  fireEvent.change(fields.identifier, { target: { value: identifier } })
  fireEvent.change(fields.password, { target: { value: password } })
  fireEvent.change(fields.pds, { target: { value: PDS } })
}

async function flush(): Promise<void> {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 0)
    await promise
  })
}

function renderOpen() {
  function Harness() {
    const [open, setOpen] = useState(true)
    return <LoginDialog open={open} onClose={() => setOpen(false)} />
  }
  return render(<Harness />)
}

describe('LoginDialog opening ownership', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
  })

  it('closes only when the sign-in still owns the open dialog', async () => {
    const transport = installTransport()
    transport.route('POST', CREATE_SESSION, () => jsonResponse(200, SESSION))

    const { container } = renderOpen()
    fillLogin('fresh.test', 'correct horse')
    fireEvent.submit(formOf(container))

    await flush()

    const dialog = dialogOf(container)
    expect(dialog.open).toBe(false)
    expect(useAuthStore.getState().account?.handle).toBe('fresh.test')
  })

  async function reopenWhilePending(response: () => Response) {
    const gate = Promise.withResolvers<void>()
    const transport = installTransport()
    transport.route('POST', CREATE_SESSION, async () => {
      await gate.promise
      return response()
    })

    const onClose = vi.fn()
    const view = (open: boolean) => <LoginDialog open={open} onClose={onClose} />
    const { container, rerender } = render(view(true))

    fillLogin('fresh.test', 'first password')
    fireEvent.submit(formOf(container))
    await flush()
    expect(transport.calls.some((call) => call.url === CREATE_SESSION)).toBe(true)

    // the user gives up on the pending attempt, closes and starts over
    rerender(view(false))
    rerender(view(true))
    expect(dialogOf(container).open).toBe(true)
    expect(inputs().password).toHaveValue('')

    const fields = inputs()
    fireEvent.change(fields.identifier, { target: { value: 'someone.else' } })
    fireEvent.change(fields.password, { target: { value: 'second password' } })

    gate.resolve()
    await flush()

    return { container, onClose, transport }
  }

  it('does not close, clear or alert a reopened dialog for an earlier success', async () => {
    const { container, onClose, transport } = await reopenWhilePending(() =>
      jsonResponse(200, SESSION),
    )

    expect(JSON.parse(transport.calls[0]?.body ?? '{}')).toEqual({
      identifier: 'fresh.test',
      password: 'first password',
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(dialogOf(container).open).toBe(true)
    expect(screen.getByLabelText('password or app password')).toHaveValue('second password')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not alert a reopened dialog for an earlier failure', async () => {
    const { container, onClose } = await reopenWhilePending(() =>
      jsonResponse(401, {
        error: 'AuthenticationRequired',
        message: 'invalid identifier or password',
      }),
    )

    expect(onClose).not.toHaveBeenCalled()
    expect(dialogOf(container).open).toBe(true)
    expect(screen.getByLabelText('password or app password')).toHaveValue('second password')
    // the stale failure belongs to the closed opening, so it stays silent
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('alerts for a failure that belongs to the current opening', async () => {
    const transport = installTransport()
    transport.route('POST', CREATE_SESSION, () =>
      jsonResponse(401, {
        error: 'AuthenticationRequired',
        message: 'invalid identifier or password',
      }),
    )

    const { container } = renderOpen()
    fillLogin('fresh.test', 'wrong password')
    fireEvent.submit(formOf(container))

    await flush()

    expect(screen.getByRole('alert')).toHaveTextContent('invalid identifier or password')
    expect(dialogOf(container).open).toBe(true)
  })

  it('alerts when the portal sign-in fails in the current opening', async () => {
    oauthControl.portalError = 'portal refused'
    const { container } = renderOpen()

    fireEvent.change(inputs().identifier, { target: { value: 'fresh.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'continue with bluesky' }))

    await flush()

    expect(screen.getByRole('alert')).toHaveTextContent('portal refused')
    expect(dialogOf(container).open).toBe(true)
  })

  it('associates a shown failure with both credential fields', async () => {
    const transport = installTransport()
    transport.route('POST', CREATE_SESSION, () =>
      jsonResponse(401, {
        error: 'AuthenticationRequired',
        message: 'invalid identifier or password',
      }),
    )

    const { container } = renderOpen()
    fillLogin('fresh.test', 'wrong password')
    fireEvent.submit(formOf(container))

    await flush()

    const alert = screen.getByRole('alert')
    const fields = inputs()
    expect(fields.identifier).toHaveAttribute('aria-invalid', 'true')
    expect(fields.password).toHaveAttribute('aria-invalid', 'true')
    expect(fields.identifier.getAttribute('aria-describedby')).toBe(alert.id)
    expect(fields.password.getAttribute('aria-describedby')?.split(' ')).toEqual([
      `${fields.password.id}-hint`,
      alert.id,
    ])
    expect(fields.identifier.getAttribute('aria-describedby')).not.toContain('pds')
  })

  it('clears the failing association when the dialog reopens', async () => {
    const transport = installTransport()
    transport.route('POST', CREATE_SESSION, () =>
      jsonResponse(401, {
        error: 'AuthenticationRequired',
        message: 'invalid identifier or password',
      }),
    )

    const onClose = vi.fn()
    const view = (open: boolean) => <LoginDialog open={open} onClose={onClose} />
    const { container, rerender } = render(view(true))

    fillLogin('fresh.test', 'wrong password')
    fireEvent.submit(formOf(container))
    await flush()
    expect(screen.getByRole('alert')).toBeTruthy()

    rerender(view(false))
    rerender(view(true))

    const fields = inputs()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fields.identifier).not.toHaveAttribute('aria-invalid')
    expect(fields.password).not.toHaveAttribute('aria-invalid')
    expect(fields.identifier).not.toHaveAttribute('aria-describedby')
    expect(fields.password.getAttribute('aria-describedby')).toBe(`${fields.password.id}-hint`)
  })
})
