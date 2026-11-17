import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../lib/auth'
import { type PortableSettings, serializeSettings } from '../lib/settingsTransfer'
import { SETTINGS_STORAGE_KEY, useSettings } from '../lib/store'
import { createTestQueryClient } from '../test/queryClient'
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

describe('SettingsDialog keyboard shortcuts setting', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    localStorage.clear()
    useSettings.setState({ keyboardShortcuts: true })
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
    expect(useSettings.getState().theme).toBe(before.theme)

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

  it('obeys the character-shortcut opt-out for / and ,', () => {
    useSettings.setState({ keyboardShortcuts: false })
    const first = renderSettings()
    const closeButton = screen.getByRole('button', { name: 'close settings' })
    const search = screen.getByRole('searchbox', { name: 'search settings' })
    closeButton.focus()

    fireEvent.keyDown(window, { key: '/' })
    expect(search).not.toHaveFocus()

    fireEvent.keyDown(closeButton, { key: ',' })
    expect(first.onClose).not.toHaveBeenCalled()
    expect(dialogElement(first.container).open).toBe(true)
    first.unmount()

    useSettings.setState({ keyboardShortcuts: true })
    renderSettings()
    fireEvent.keyDown(window, { key: '/' })
    expect(screen.getByRole('searchbox', { name: 'search settings' })).toHaveFocus()
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

describe('SettingsDialog appearance inventory', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    localStorage.clear()
    useSettings.setState({ appearance: 'dark', keyboardShortcuts: true, imageEffects: true })
  })

  it('offers exactly the three appearance modes and the two toggles', () => {
    const { container } = renderSettings()
    const section = document.getElementById('settings-appearance')
    if (section === null) throw new Error('appearance section missing')

    const modes = Array.from(section.querySelectorAll('button[aria-pressed]'))
    expect(modes.map((mode) => mode.textContent)).toEqual(['light', 'dark', 'system'])
    for (const mode of modes) {
      expect(mode).toHaveAttribute('aria-pressed', mode.textContent === 'dark' ? 'true' : 'false')
    }

    // the mode buttons and the two toggles are the section's whole inventory
    expect(section.querySelectorAll('button')).toHaveLength(3)
    const inputs = Array.from(section.querySelectorAll('input'))
    expect(inputs).toHaveLength(2)
    for (const input of inputs) expect(input.getAttribute('type')).toBe('checkbox')
    expect(within(section).getByRole('checkbox', { name: /keyboard shortcuts/ })).toBeChecked()
    expect(within(section).getByRole('checkbox', { name: /dither effects/ })).toBeChecked()

    // no contrast, preview or labeler control survives anywhere
    const dialog = dialogElement(container)
    expect(dialog.querySelectorAll('input[type="range"], select, textarea')).toHaveLength(0)
    expect(dialog.querySelector('[role="slider"]')).toBeNull()
    expect(
      dialog.querySelectorAll(
        '[class*="effect"], [class*="preview"], [class*="picker"], [class*="labeler"], [class*="contrast"]',
      ),
    ).toHaveLength(0)
    for (const name of [/high contrast/i, /theme picker/i, /labeler/i]) {
      expect(within(dialog).queryByRole('button', { name })).toBeNull()
      expect(within(dialog).queryByRole('checkbox', { name })).toBeNull()
    }
  })
})

describe('SettingsDialog dither effects setting', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
    localStorage.clear()
    useSettings.setState({ imageEffects: true })
  })

  it('reflects the stored setting', () => {
    renderSettings()
    expect(screen.getByRole('checkbox', { name: /dither effects/ })).toBeChecked()
  })

  it('shows a stored disabled setting as unchecked', () => {
    useSettings.setState({ imageEffects: false })
    renderSettings()
    expect(screen.getByRole('checkbox', { name: /dither effects/ })).not.toBeChecked()
  })

  it('writes the toggle through the store and persists it', () => {
    const setImageEffects = vi.spyOn(useSettings.getState(), 'setImageEffects')
    renderSettings()
    const toggle = screen.getByRole('checkbox', { name: /dither effects/ })
    const before = useSettings.getState()

    fireEvent.click(toggle)

    expect(setImageEffects).toHaveBeenCalledTimes(1)
    expect(setImageEffects).toHaveBeenCalledWith(false)
    expect(toggle).not.toBeChecked()
    expect(useSettings.getState().imageEffects).toBe(false)
    // the neighbouring preferences keep their values
    expect(useSettings.getState().appearance).toBe(before.appearance)
    expect(useSettings.getState().keyboardShortcuts).toBe(before.keyboardShortcuts)

    const persisted = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (persisted === null) throw new Error('settings were not persisted')
    const stored = JSON.parse(persisted) as {
      version?: number
      state?: { imageEffects?: boolean }
    }
    expect(stored.version).toBe(3)
    expect(stored.state?.imageEffects).toBe(false)

    fireEvent.click(toggle)
    expect(useSettings.getState().imageEffects).toBe(true)
  })

  it('is found by its dither keywords', () => {
    renderSettings()
    const search = screen.getByRole('searchbox', { name: 'search settings' })

    for (const query of ['dither effects', 'image effects']) {
      fireEvent.change(search, { target: { value: query } })
      expect(document.getElementById('settings-appearance')?.getAttribute('data-hidden')).not.toBe(
        'true',
      )
      expect(document.getElementById('settings-account')?.getAttribute('data-hidden')).toBe('true')
      expect(screen.getByRole('checkbox', { name: /dither effects/ })).toBeInTheDocument()
    }
  })

  it('exports the dither preference in the settings file', async () => {
    useSettings.setState({ appearance: 'dark', keyboardShortcuts: true, imageEffects: false })
    const blobs: Blob[] = []
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((source) => {
      if (!(source instanceof Blob)) throw new Error('settings export was not a blob')
      blobs.push(source)
      return 'blob:benday-settings'
    })
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    // jsdom would try to navigate to the blob and never download it
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'export settings' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
    const anchor = download.mock.contexts[0]
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error('export anchor missing')
    expect(anchor.download).toBe('benday-settings.json')
    expect(anchor.getAttribute('href')).toBe('blob:benday-settings')
    // the temporary anchor is gone once the download was handed off
    expect(document.querySelector('a[download]')).toBeNull()

    const blob = blobs[0]
    if (blob === undefined) throw new Error('settings export blob missing')
    const file = JSON.parse(await blob.text()) as Record<string, unknown>
    expect(file).toMatchObject({
      version: 3,
      appearance: 'dark',
      keyboardShortcuts: true,
      imageEffects: false,
    })
    expect(await screen.findByText('settings exported')).toBeInTheDocument()

    // the object url is released once the download has been claimed
    await settle()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:benday-settings')
  })
})

describe('SettingsDialog search', () => {
  beforeEach(() => {
    delete document.documentElement.dataset['theme']
  })

  it('matches every token of a natural multi-word query', () => {
    renderSettings()
    const search = screen.getByRole('searchbox', { name: 'search settings' })

    for (const query of ['light dark system', 'dither grunge']) {
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

  it('does not index the retired effect and labeler controls', () => {
    renderSettings()
    const search = screen.getByRole('searchbox', { name: 'search settings' })
    const searchBlock = search.parentElement
    if (searchBlock === null) throw new Error('search block missing')
    const status = within(searchBlock).getByRole('status')

    for (const query of ['high contrast', 'labelers']) {
      fireEvent.change(search, { target: { value: query } })

      expect(status).toHaveTextContent('no matching setting')
      // only the surviving sections are indexed, so every one is filtered out
      for (const id of ['settings-appearance', 'settings-transfer', 'settings-account']) {
        expect(document.getElementById(id)?.getAttribute('data-hidden')).toBe('true')
      }
    }
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

describe('SettingsDialog sign-out ownership', () => {
  const realSignOut = useAuthStore.getState().signOut

  beforeEach(() => {
    delete document.documentElement.dataset['theme']
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

describe('SettingsDialog import limits', () => {
  const MAX_BYTES = 256 * 1024
  const SAMPLE: PortableSettings = {
    appearance: 'dark',
    keyboardShortcuts: true,
    imageEffects: true,
  }

  function pickFile(container: HTMLElement, file: File): void {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (input === null) throw new Error('settings file input missing')
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('rejects an oversized file before reading it and leaves settings alone', async () => {
    const { container } = renderSettings()
    const before = useSettings.getState()
    const read = vi.spyOn(File.prototype, 'text')
    const oversized = new File([new Uint8Array(MAX_BYTES + 1)], 'big.json', {
      type: 'application/json',
    })

    pickFile(container, oversized)

    expect(await screen.findByText(/settings file is too large/)).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
    expect(useSettings.getState()).toBe(before)
    // the dialog is still usable and the same picker can be used again
    expect(dialogElement(container).open).toBe(true)
    read.mockRestore()
  })

  it('accepts a file at the limit and applies it', async () => {
    const { container } = renderSettings()
    const json = serializeSettings(SAMPLE)
    const padded = json + ' '.repeat(MAX_BYTES - json.length)
    const file = new File([padded], 'settings.json', { type: 'application/json' })
    expect(file.size).toBe(MAX_BYTES)

    pickFile(container, file)

    expect(await screen.findByText('settings imported')).toBeInTheDocument()
    expect(useSettings.getState().theme).toBe('dark')
  })

  it.each(['resolve', 'reject'])(
    'keeps the newer size error when an older read will %s',
    async (completion) => {
      useSettings.getState().importSettings({
        appearance: 'light',
        keyboardShortcuts: false,
        imageEffects: false,
      })
      const { container } = renderSettings()
      const before = useSettings.getState()
      const pending = Promise.withResolvers<string>()
      const slow = new File([serializeSettings(SAMPLE)], 'slow.json', { type: 'application/json' })
      Object.defineProperty(slow, 'text', { value: () => pending.promise })
      const oversized = new File([new Uint8Array(MAX_BYTES + 1)], 'big.json', {
        type: 'application/json',
      })

      pickFile(container, slow)
      pickFile(container, oversized)
      const sizeError = await screen.findByText(/settings file is too large/)

      await act(async () => {
        if (completion === 'resolve') pending.resolve(serializeSettings(SAMPLE))
        else pending.reject(new Error('older read failed'))
      })

      expect(useSettings.getState()).toBe(before)
      expect(sizeError).toBeInTheDocument()
      expect(screen.queryByText('settings imported')).toBeNull()
      expect(screen.queryByText('could not read settings file')).toBeNull()
    },
  )

  it('keeps the newer pick when an older read resolves last', async () => {
    const { container } = renderSettings()
    const slowRead = Promise.withResolvers<string>()
    const slow = new File(['slow'], 'slow.json', { type: 'application/json' })
    Object.defineProperty(slow, 'text', { value: () => slowRead.promise })
    const fast = new File([serializeSettings({ ...SAMPLE, appearance: 'light' })], 'fast.json', {
      type: 'application/json',
    })

    pickFile(container, slow)
    pickFile(container, fast)
    expect(await screen.findByText('settings imported')).toBeInTheDocument()
    expect(useSettings.getState().appearance).toBe('light')

    // the older pick lands after the newer one and changes nothing
    slowRead.resolve(serializeSettings(SAMPLE))
    await act(async () => undefined)
    expect(useSettings.getState().appearance).toBe('light')
    expect(screen.queryByText('could not read settings file')).toBeNull()
  })
})
