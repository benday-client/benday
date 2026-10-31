import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPVIEW_PRESETS,
  DEFAULT_APPVIEW,
  makeCustomAppView,
  toAppViewTarget,
} from '../lib/appviews'
import { SETTINGS_STORAGE_KEY, useSettings } from '../lib/store'
import type { AppViewTarget } from '../lib/types'
import { installTransport, jsonResponse } from '../test/transport'
import { AppViewDialog } from './AppViewDialog'

function requireTarget(target: AppViewTarget | null): AppViewTarget {
  if (target === null) throw new Error('expected an appview target')
  return target
}

/** The dialog probes every preset it lists, so those reads are answered offline. */
function routeProbes() {
  const transport = installTransport()
  for (const host of [
    'https://api.bsky.app',
    'https://public.api.bsky.app',
    'https://api.blacksky.community',
  ]) {
    transport.route('GET', `${host}/xrpc/app.bsky.actor.getProfile`, () =>
      jsonResponse(200, { did: 'did:plc:bsky', handle: 'bsky.app' }),
    )
  }
  return transport
}

function renderDialog() {
  const onClose = vi.fn()

  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <AppViewDialog
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      />
    )
  }

  return { ...render(<Harness />), onClose }
}

async function rehydrateFrom(stored: Record<string, unknown>): Promise<void> {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, state: stored }))
  await act(async () => {
    await useSettings.persist.rehydrate()
  })
}

const CUSTOM = requireTarget(makeCustomAppView('api.example.com'))

describe('AppViewDialog host draft', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState({ appView: CUSTOM })
    routeProbes()
  })

  it('keeps an unsubmitted host when another tab only changes the theme', async () => {
    renderDialog()
    const input = screen.getByRole('textbox', { name: 'custom host' })
    expect(input).toHaveValue(CUSTOM.host)

    fireEvent.change(input, { target: { value: 'https://draft.example.com' } })

    await rehydrateFrom({
      appView: { ...CUSTOM },
      theme: 'oxide',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'oxide',
      imageEffects: true,
      labelers: [],
    })

    expect(useSettings.getState().theme).toBe('oxide')
    expect(input).toHaveValue('https://draft.example.com')
  })

  it('follows a genuinely different custom host from another tab', async () => {
    renderDialog()
    const input = screen.getByRole('textbox', { name: 'custom host' })
    fireEvent.change(input, { target: { value: 'https://draft.example.com' } })

    const other = requireTarget(makeCustomAppView('other.example.com'))
    await rehydrateFrom({
      appView: { ...other },
      theme: 'oxide',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'oxide',
      imageEffects: true,
      labelers: [],
    })

    expect(input).toHaveValue('https://other.example.com')
  })
})

describe('AppViewDialog selection and field associations', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState({ appView: toAppViewTarget(DEFAULT_APPVIEW) })
    routeProbes()
  })

  it('exposes the active preset as pressed and keeps its marker', () => {
    const { container } = renderDialog()
    const rows = [...container.querySelectorAll<HTMLButtonElement>('.b-appview__select')]

    expect(rows).toHaveLength(APPVIEW_PRESETS.length)
    expect(rows.map((row) => row.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, null, null])
    expect(rows[0]?.getAttribute('data-active')).toBe('true')
    expect(rows[0]?.querySelector('.b-appview__mark')?.textContent).toBe('*')
  })

  it('closes through the shared dialog header control', () => {
    const { onClose } = renderDialog()
    const close = screen.getByRole('button', { name: 'close appviews' })

    expect(close.closest('.b-dialog__head')).not.toBeNull()
    fireEvent.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('associates an invalid custom host with its alert and clears it', () => {
    renderDialog()
    const input = screen.getByRole('textbox', { name: 'custom host' })
    expect(input).not.toHaveAttribute('aria-invalid')

    fireEvent.change(input, { target: { value: 'https://api.example.com/path' } })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('invalid host · use an https origin without a path')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toContain(alert.id)
    expect(describedBy).toContain(`${input.id}-hint`)

    fireEvent.change(input, { target: { value: 'https://api.example.com' } })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-hint`)
  })
})
