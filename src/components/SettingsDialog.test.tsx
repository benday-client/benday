import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APPVIEW, makeCustomAppView, toAppViewTarget } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { SETTINGS_STORAGE_KEY, useSettings } from '../lib/store'
import type { AppViewTarget } from '../lib/types'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse } from '../test/transport'
import { SettingsDialog } from './SettingsDialog'

function dialogElement(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog')
  if (dialog === null) throw new Error('settings dialog missing')
  return dialog
}

function bodyElement(dialog: HTMLDialogElement): HTMLElement {
  const body = dialog.querySelector<HTMLElement>('.b-dialog__body')
  if (body === null) throw new Error('dialog body missing')
  return body
}

// jsdom has no layout, so the scroll container's metrics and position are ours
function stubScroll(body: HTMLElement, scrollHeight: number, clientHeight: number) {
  let scrollTop = 0
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: clientHeight })
  Object.defineProperty(body, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value
    },
  })
  return {
    top: () => scrollTop,
  }
}

function renderSettings() {
  const onClose = vi.fn()
  const queryClient = createTestQueryClient()

  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <SettingsDialog
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      />
    )
  }

  const result = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )
  return { ...result, onClose }
}

describe('SettingsDialog keyboard', () => {
  beforeEach(() => {
    // no themed exit animation: closing must take effect at once
    delete document.documentElement.dataset['theme']
  })

  it('scrolls the dialog body with ArrowDown', () => {
    const { container } = renderSettings()
    const dialog = dialogElement(container)
    const body = bodyElement(dialog)
    const scroll = stubScroll(body, 800, 300)

    fireEvent.keyDown(body, { key: 'ArrowDown' })

    expect(scroll.top()).toBe(40)
  })

  it('pages and jumps through the dialog body', () => {
    const { container } = renderSettings()
    const dialog = dialogElement(container)
    const body = bodyElement(dialog)
    const scroll = stubScroll(body, 800, 300)

    fireEvent.keyDown(body, { key: 'PageDown' })
    expect(scroll.top()).toBe(Math.round(300 * 0.85))

    fireEvent.keyDown(body, { key: 'End' })
    expect(scroll.top()).toBe(800)
  })

  it('closes on a comma pressed outside a field without opening another dialog', () => {
    const { container, onClose } = renderSettings()
    const dialog = dialogElement(container)
    const closeButton = screen.getByRole('button', { name: 'close settings' })
    closeButton.focus()

    fireEvent.keyDown(closeButton, { key: ',' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(false)
    expect(document.querySelectorAll('dialog')).toHaveLength(1)
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(0)
  })

  it('keeps a comma typed into the search field', () => {
    const { container, onClose } = renderSettings()
    const input = screen.getByRole('searchbox', { name: 'search settings' })
    input.focus()

    fireEvent.keyDown(input, { key: ',' })
    fireEvent.change(input, { target: { value: 'high, contrast' } })

    expect(onClose).not.toHaveBeenCalled()
    expect(input).toHaveValue('high, contrast')
    expect((input as HTMLInputElement).value).toContain(',')
    expect(dialogElement(container).open).toBe(true)
  })
})

function requireTarget(target: AppViewTarget | null): AppViewTarget {
  if (target === null) throw new Error('expected an appview target')
  return target
}

function seedSettings(patch: { appView?: AppViewTarget; labelers?: string[] }) {
  useSettings.setState({
    appView: patch.appView ?? toAppViewTarget(DEFAULT_APPVIEW),
    labelers: patch.labelers ?? [],
  })
}

async function rehydrateFrom(stored: Record<string, unknown>): Promise<void> {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, state: stored }))
  await act(async () => {
    await useSettings.persist.rehydrate()
  })
}

describe('SettingsDialog labelers', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    seedSettings({})
  })

  it('rejects labeler dids the sdk would refuse', () => {
    renderSettings()
    const input = screen.getByRole('textbox', { name: 'labeler did' })
    const addButton = screen.getByRole('button', { name: 'add labeler' })

    for (const value of ['did:plc', 'did:plcabc', 'did:plc:']) {
      fireEvent.change(input, { target: { value } })
      expect(addButton).toBeDisabled()
      expect(screen.getByText('enter a did')).toBeInTheDocument()
    }
    expect(useSettings.getState().labelers).toEqual([])

    fireEvent.change(input, { target: { value: 'did:plc:bendaylabeler' } })
    expect(addButton).toBeEnabled()
    expect(screen.queryByText('enter a did')).toBeNull()
  })

  it('stops adding at the cap and keeps the typed did', () => {
    const transport = installTransport()
    transport.route('GET', 'https://api.bsky.app/xrpc/app.bsky.labeler.getServices', () =>
      jsonResponse(200, { views: [] }),
    )
    const dids = Array.from({ length: 20 }, (_, index) => `did:plc:labeler${index}`)
    seedSettings({ labelers: dids })

    renderSettings()
    const input = screen.getByRole('textbox', { name: 'labeler did' })
    fireEvent.change(input, { target: { value: 'did:plc:extralabeler' } })

    const addButton = screen.getByRole('button', { name: 'add labeler' })
    expect(addButton).toBeDisabled()
    expect(screen.getByText('labeler limit is 20')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('did:plc:extralabeler')
    expect(useSettings.getState().labelers).toHaveLength(20)

    // freeing a slot makes the same typed did addable again
    const removeButtons = screen.getAllByRole('button', { name: /^remove / })
    const firstRemove = removeButtons[0]
    if (firstRemove === undefined) throw new Error('no remove control rendered')
    fireEvent.click(firstRemove)
    expect(useSettings.getState().labelers).toHaveLength(19)
    expect(screen.queryByText('labeler limit is 20')).toBeNull()
    expect(addButton).toBeEnabled()

    fireEvent.click(addButton)
    expect(useSettings.getState().labelers).toHaveLength(20)
    expect(useSettings.getState().labelers).toContain('did:plc:extralabeler')
  })
})

describe('SettingsDialog appview host draft', () => {
  const CUSTOM = requireTarget(makeCustomAppView('api.example.com'))

  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    seedSettings({ appView: CUSTOM })
  })

  it('keeps an unsubmitted host when another tab only changes the theme', async () => {
    renderSettings()
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

  it('follows a genuinely different custom host', async () => {
    renderSettings()
    const input = screen.getByRole('textbox', { name: 'custom host' })
    fireEvent.change(input, { target: { value: 'https://draft.example.com' } })

    const other = makeCustomAppView('other.example.com')
    if (other === null) throw new Error('expected a custom appview')

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

describe('SettingsDialog keyboard shortcuts setting', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    localStorage.clear()
    seedSettings({})
    useSettings.setState({ keyboardShortcuts: true, imageEffects: true, highContrast: false })
  })

  it('reflects the stored setting', () => {
    renderSettings()
    expect(screen.getByRole('checkbox', { name: /keyboard shortcuts/ })).toBeChecked()
  })

  it('shows a stored disabled setting as unchecked', () => {
    useSettings.setState({ keyboardShortcuts: false })
    renderSettings()
    expect(screen.getByRole('checkbox', { name: /keyboard shortcuts/ })).not.toBeChecked()
  })

  it('updates only the keyboard shortcuts setting when toggled', () => {
    renderSettings()
    const toggle = screen.getByRole('checkbox', { name: /keyboard shortcuts/ })
    const before = useSettings.getState()

    fireEvent.click(toggle)

    expect(toggle).not.toBeChecked()
    expect(useSettings.getState().keyboardShortcuts).toBe(false)
    // every other accessible preference keeps its value
    expect(useSettings.getState().imageEffects).toBe(before.imageEffects)
    expect(useSettings.getState().highContrast).toBe(before.highContrast)
    expect(useSettings.getState().theme).toBe(before.theme)
    expect(useSettings.getState().appView).toBe(before.appView)
    expect(useSettings.getState().labelers).toBe(before.labelers)

    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as { state?: { keyboardShortcuts?: boolean } }
    expect(stored.state?.keyboardShortcuts).toBe(false)

    fireEvent.click(toggle)
    expect(useSettings.getState().keyboardShortcuts).toBe(true)
  })

  it('is found by its search keywords', () => {
    renderSettings()
    const search = screen.getByRole('searchbox', { name: 'search settings' })

    for (const query of ['keyboard shortcuts', 'wcag']) {
      fireEvent.change(search, { target: { value: query } })
      expect(document.getElementById('settings-appearance')?.getAttribute('data-hidden')).not.toBe(
        'true',
      )
      expect(document.getElementById('settings-account')?.getAttribute('data-hidden')).toBe('true')
      expect(screen.getByRole('checkbox', { name: /keyboard shortcuts/ })).toBeInTheDocument()
    }
  })
})

async function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => {
    await promise
  })
}

function renderReopenableSettings() {
  const onClose = vi.fn()
  const queryClient = createTestQueryClient()

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
          reopen settings
        </button>
        <SettingsDialog
          open={open}
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        />
      </>
    )
  }

  const result = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )
  return { ...result, onClose }
}

describe('SettingsDialog search', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    seedSettings({})
  })

  it('matches every token of a natural multi-word query', () => {
    renderSettings()
    const search = screen.getByRole('searchbox', { name: 'search settings' })

    for (const query of ['high contrast', 'maximum preview']) {
      fireEvent.change(search, { target: { value: query } })
      expect(document.getElementById('settings-appearance')?.getAttribute('data-hidden')).not.toBe(
        'true',
      )
      expect(document.getElementById('settings-account')?.getAttribute('data-hidden')).toBe('true')
    }
  })

  it('announces an empty no-match result through a mounted status', () => {
    renderSettings()
    const search = screen.getByRole('searchbox', { name: 'search settings' })
    const searchBlock = search.parentElement
    if (searchBlock === null) throw new Error('search block missing')
    const status = within(searchBlock).getByRole('status')

    expect(status).toBeEmptyDOMElement()

    fireEvent.change(search, { target: { value: 'no such setting' } })

    expect(status).toHaveTextContent('no matching setting')
  })

  it('starts with an empty filter every time it opens', () => {
    renderReopenableSettings()
    const search = screen.getByRole('searchbox', { name: 'search settings' })

    fireEvent.change(search, { target: { value: 'transfer' } })
    expect(document.getElementById('settings-appearance')?.getAttribute('data-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'close settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'reopen settings' }))

    expect(screen.getByRole('searchbox', { name: 'search settings' })).toHaveValue('')
    expect(document.getElementById('settings-appearance')?.getAttribute('data-hidden')).not.toBe(
      'true',
    )
    expect(document.getElementById('settings-account')?.getAttribute('data-hidden')).not.toBe(
      'true',
    )
  })
})

describe('SettingsDialog field associations', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    seedSettings({})
  })

  it('associates an invalid custom host with its hint and error', () => {
    renderSettings()
    const input = screen.getByRole('textbox', { name: 'custom host' })

    fireEvent.change(input, { target: { value: 'http://example.com' } })

    const error = screen.getByRole('alert')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(error).toHaveTextContent('invalid host')
    expect(error.id).not.toBe('')
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-hint ${error.id}`)

    fireEvent.change(input, { target: { value: '' } })

    expect(input).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('invalid host · use an https origin without a path')).toBeNull()
  })

  it('associates an invalid labeler did with its error and names each remove control', () => {
    const transport = installTransport()
    transport.route('GET', 'https://api.bsky.app/xrpc/app.bsky.labeler.getServices', () =>
      jsonResponse(200, { views: [] }),
    )
    seedSettings({ labelers: ['did:plc:firstlabeler', 'did:plc:secondlabeler'] })
    renderSettings()
    const input = screen.getByRole('textbox', { name: 'labeler did' })

    fireEvent.change(input, { target: { value: 'not-a-did' } })

    const error = screen.getByRole('alert')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(error).toHaveTextContent('enter a did')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)

    expect(screen.getByRole('button', { name: 'remove did:plc:firstlabeler' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'remove did:plc:secondlabeler' })).toBeInTheDocument()
  })
})

describe('SettingsDialog theme markers', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    seedSettings({})
    useSettings.setState({
      theme: 'oxide',
      appearance: 'dark',
      lightTheme: 'bone',
      darkTheme: 'oxide',
    })
  })

  it('marks the effective theme current and keeps the saved slot pressed', () => {
    renderSettings()

    const current = screen.getByRole('button', { name: 'oxide' })
    expect(current).toHaveAttribute('aria-pressed', 'true')
    expect(current).toHaveAttribute('aria-current', 'true')

    const savedLight = screen.getByRole('button', { name: 'bone' })
    expect(savedLight).toHaveAttribute('aria-pressed', 'true')
    expect(savedLight).not.toHaveAttribute('aria-current')

    const unselected = screen.getByRole('button', { name: 'void' })
    expect(unselected).toHaveAttribute('aria-pressed', 'false')
    expect(unselected).not.toHaveAttribute('aria-current')
  })
})

describe('SettingsDialog sign-out ownership', () => {
  const realSignOut = useAuthStore.getState().signOut

  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    seedSettings({})
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:settingsowner', handle: 'owner.test' },
    })
  })

  afterEach(() => {
    useAuthStore.setState({
      signOut: realSignOut,
      status: 'anonymous',
      account: null,
      pending: false,
    })
  })

  it('ignores a completion that settles after the dialog was reopened', async () => {
    const deferred = Promise.withResolvers<void>()
    const signOut = vi.fn(() => deferred.promise)
    useAuthStore.setState({ signOut })

    const { container, onClose } = renderReopenableSettings()
    fireEvent.click(screen.getByRole('button', { name: 'sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'close settings' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'reopen settings' }))
    const dialog = dialogElement(container)
    expect(dialog.open).toBe(true)

    deferred.resolve()
    await settle()

    expect(dialog.open).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'sign out' })).toBeEnabled()
  })

  it('closes exactly once when the current sign-out settles', async () => {
    const deferred = Promise.withResolvers<void>()
    const signOut = vi.fn(() => deferred.promise)
    useAuthStore.setState({ signOut })

    const { container, onClose } = renderReopenableSettings()
    const button = screen.getByRole('button', { name: 'sign out' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()

    deferred.resolve()
    await settle()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialogElement(container).open).toBe(false)
  })
})
