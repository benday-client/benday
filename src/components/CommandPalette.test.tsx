import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
import { createTestQueryClient } from '../test/queryClient'
import { CommandPalette } from './CommandPalette'

const pinnedState = vi.hoisted(() => ({
  feeds: [] as { uri: string; name: string; description: string; avatar: string | null }[],
  isPending: false,
  error: null as Error | null,
  reload: () => undefined,
}))

vi.mock('../hooks/usePinnedFeeds', () => ({
  usePinnedFeeds: () => pinnedState,
}))

interface RenderOptions {
  open?: boolean
  onClose?: () => void
  onOpenAppView?: () => void
  onOpenHelp?: () => void
  onOpenSettings?: () => void
}

function renderPalette(options: RenderOptions = {}) {
  const location = memoryLocation({ path: '/', record: true })
  const onClose = options.onClose ?? vi.fn()
  const onOpenAppView = options.onOpenAppView ?? vi.fn()
  const onOpenHelp = options.onOpenHelp ?? vi.fn()
  const onOpenSettings = options.onOpenSettings ?? vi.fn()

  const queryClient = createTestQueryClient()

  const view = (open: boolean) => (
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <CommandPalette
          open={open}
          onClose={onClose}
          onOpenAppView={onOpenAppView}
          onOpenHelp={onOpenHelp}
          onOpenSettings={onOpenSettings}
        />
      </Router>
    </QueryClientProvider>
  )

  const result = render(view(options.open ?? true))

  return {
    onClose,
    onOpenAppView,
    onOpenHelp,
    onOpenSettings,
    history: location.history,
    queryClient,
    rerender: (open: boolean) => {
      result.rerender(view(open))
    },
  }
}

function submit(value: string) {
  const input = screen.getByLabelText('command or jump')
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear()
    pinnedState.feeds = []
    useSettings.setState({ theme: 'void' })
    useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
    useUiStore.setState({ dialog: null })
  })

  it('sets a theme from the command prompt', () => {
    const { onClose } = renderPalette()
    submit('theme cyberpunk 2077')
    expect(useSettings.getState().theme).toBe('cyberpunk')
    expect(onClose).toHaveBeenCalled()
  })

  it('sets an appview from the command prompt', () => {
    const { onClose } = renderPalette()
    submit('appview public')
    expect(useSettings.getState().appView.id).toBe('public')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the signed-in profile with the @me command', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    const { history } = renderPalette()
    submit('@me')
    expect(history.at(-1)).toBe('/profile/me.test')
  })

  it('answers @me with the real account row and never with a literal /profile/me', () => {
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    const { history } = renderPalette()
    const input = screen.getByLabelText('command or jump')
    fireEvent.change(input, { target: { value: '@me' } })

    const options = screen.getAllByRole('option')
    // the account row replaced the literal handle row rather than joining it
    expect(options).toHaveLength(1)
    expect(options[0]?.textContent).toContain('@me.test')

    fireEvent.click(options[0] as HTMLElement)
    expect(history.at(-1)).toBe('/profile/me.test')
    expect(history).not.toContain('/profile/me')
  })

  it('asks for sign in from the @me row when signed out', () => {
    const { history } = renderPalette()
    submit('@me')
    expect(useUiStore.getState().dialog).toBe('login')
    expect(history).not.toContain('/profile/me')
    expect(history.at(-1)).toBe('/')
  })

  it('runs the highlighted row for a bare @ instead of searching its text', () => {
    const { history, onClose } = renderPalette()
    submit('@')
    expect(useUiStore.getState().dialog).toBe('login')
    expect(onClose).toHaveBeenCalled()
    expect(history.at(-1)).toBe('/')
  })

  it('wires the combobox to one listbox and one selected option', () => {
    const { rerender } = renderPalette()
    const input = screen.getByLabelText('command or jump')
    const listbox = screen.getByRole('listbox', { name: 'commands' })

    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox.id)

    const options = screen.getAllByRole('option')
    const selected = options.filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(input).toHaveAttribute('aria-activedescendant', selected[0]?.id)
    for (const option of options) {
      expect(option.tabIndex).toBe(-1)
    }

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const rows = screen.getAllByRole('option')
    const moved = rows.filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(moved).toHaveLength(1)
    expect(moved[0]?.id).not.toBe(selected[0]?.id)
    expect(input).toHaveAttribute('aria-activedescendant', moved[0]?.id)

    rerender(false)
    expect(input).not.toHaveAttribute('aria-expanded')
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  it('leaves Home, End and the arrows to the caret when nothing matches', () => {
    renderPalette()
    const input = screen.getByLabelText('command or jump')
    fireEvent.change(input, { target: { value: 'zzzz' } })
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true)

    // with rows on screen the palette keeps owning list navigation
    fireEvent.change(input, { target: { value: 'theme' } })
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(false)
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false)
  })

  it('closes once through the dialog cancel event', () => {
    const { onClose } = renderPalette()
    const dialog = document.querySelector('dialog.b-palette')
    if (dialog === null) throw new Error('palette dialog missing')
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens settings from the settings command', () => {
    const { onClose, onOpenSettings } = renderPalette()
    submit('settings')
    expect(onOpenSettings).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('opens help when the help command is selected by typing', () => {
    const { onOpenHelp } = renderPalette()
    submit('help')
    expect(onOpenHelp).toHaveBeenCalled()
  })

  it('resets the selection when the palette reopens', () => {
    const { rerender } = renderPalette()
    const input = screen.getByLabelText('command or jump')
    fireEvent.change(input, { target: { value: 'settings' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    const staleRow = screen.getByText('appview settings').closest('.b-palette__command')
    expect(staleRow?.getAttribute('data-selected')).toBe('true')

    rerender(false)
    rerender(true)

    const reopenedInput = screen.getByLabelText('command or jump')
    expect((reopenedInput as HTMLInputElement).value).toBe('')
    const rows = Array.from(document.querySelectorAll('.b-palette__command'))
    expect(rows[0]?.getAttribute('data-selected')).toBe('true')
    expect(
      screen
        .getByText('appview settings')
        .closest('.b-palette__command')
        ?.getAttribute('data-selected'),
    ).toBe('false')
  })

  it('offers a retry instead of an invented empty preference list', () => {
    const reload = vi.fn()
    pinnedState.feeds = []
    pinnedState.error = new Error('preferences failed')
    pinnedState.reload = reload
    const { onClose } = renderPalette()

    const retry = screen.getByText('could not load pinned feeds')
    expect(retry).toBeInTheDocument()
    expect(screen.queryByText('@me')).toBeInTheDocument()

    fireEvent.click(retry)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()

    pinnedState.error = null
    pinnedState.reload = () => undefined
  })

  it('keeps the highlight in range when pinned feeds shrink', () => {
    const feed = (name: string) => ({
      uri: `at://did:plc:test/app.bsky.feed.generator/${name}`,
      name,
      description: `${name} feed`,
      avatar: null,
    })
    pinnedState.feeds = [feed('alpha'), feed('beta'), feed('gamma')]
    const { history, onClose, rerender } = renderPalette()

    const input = screen.getByLabelText('command or jump')
    const rowsBefore = Array.from(document.querySelectorAll('.b-palette__command'))
    const pinnedIndex = rowsBefore.findIndex((row) => row.textContent?.trim().startsWith('beta'))
    expect(pinnedIndex).toBeGreaterThanOrEqual(0)
    for (let index = 0; index < pinnedIndex; index += 1) {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    }
    expect(screen.getByText('beta').closest('.b-palette__command')).toHaveAttribute(
      'data-selected',
      'true',
    )
    const initialRows = rowsBefore.length

    pinnedState.feeds = [feed('alpha')]
    rerender(true)

    const rows = Array.from(document.querySelectorAll('.b-palette__command'))
    expect(rows.length).toBeLessThan(initialRows)
    const selected = rows.findIndex((row) => row.getAttribute('data-selected') === 'true')
    expect(selected).toBeGreaterThanOrEqual(0)
    expect(selected).toBeLessThan(rows.length)
    expect(rows[selected]?.textContent).toContain('@me')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onClose).toHaveBeenCalled()
    expect(useUiStore.getState().dialog).toBe('login')
    expect(history.at(-1)).toBe('/')
  })

  it('moves the selection with the arrow keys and wraps at both ends', () => {
    renderPalette()
    const input = screen.getByLabelText('command or jump')
    const rows = () => Array.from(document.querySelectorAll('.b-palette__command'))
    const selectedIndex = () =>
      rows().findIndex((row) => row.getAttribute('data-selected') === 'true')
    const selectedLabel = () => rows()[selectedIndex()]?.textContent ?? ''

    expect(selectedLabel()).toContain('sign in')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(selectedLabel()).toContain('@me')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(selectedLabel()).toContain('feeds')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(selectedLabel()).toContain('@me')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(selectedIndex()).toBe(0)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(selectedIndex()).toBe(rows().length - 1)
    expect(selectedLabel()).toContain('keyboard help')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(selectedIndex()).toBe(0)
  })

  it('falls through to a network search when no command matches', () => {
    const { history, onClose } = renderPalette()
    submit('atproto')
    expect(history.at(-1)).toBe('/search?q=atproto')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('palette jump history', () => {
  const KEY = 'benday:jump-history'

  function seedHistory(entries: unknown[]): void {
    localStorage.setItem(KEY, JSON.stringify(entries))
  }

  it('keeps only destinations this document can open', () => {
    seedHistory([
      {
        href: '/thread?uri=at%3A%2F%2Fdid%3Aplc%3Atest%2Fapp.bsky.feed.post%2F1#reply-3',
        label: 'deep thread',
        meta: 'recent',
      },
      { href: '//evil.test/steal', label: 'protocol relative' },
      { href: '/\\evil.test/steal', label: 'backslash authority' },
      { href: `blob:${window.location.origin}/id`, label: 'blob' },
      { href: 'javascript:alert(1)', label: 'script' },
      { href: '/feed', label: 7 },
      { label: 'no href' },
      null,
      'string',
      { href: '/feed', label: 'saved feed', extra: 'legacy field' },
    ])

    const { history } = renderPalette()

    // only the two document paths survive, in their stored order
    expect(screen.getByText('deep thread')).toBeInTheDocument()
    expect(screen.getByText('saved feed')).toBeInTheDocument()
    for (const label of ['protocol relative', 'backslash authority', 'blob', 'script', 'no href']) {
      expect(screen.queryByText(label)).toBeNull()
    }

    fireEvent.keyDown(screen.getByLabelText('command or jump'), { key: 'Enter' })
    expect(history.at(-1)).toBe(
      '/thread?uri=at%3A%2F%2Fdid%3Aplc%3Atest%2Fapp.bsky.feed.post%2F1#reply-3',
    )
  })

  it('drops a stored history that is not a list', () => {
    localStorage.setItem(KEY, JSON.stringify({ href: '/feed', label: 'stored feed' }))
    renderPalette()

    expect(screen.queryByText('stored feed')).toBeNull()
  })

  it('normalizes an absolute same-origin destination to its path', () => {
    const absolute = `${window.location.origin}/feed?tab=1#top`
    seedHistory([{ href: absolute, label: 'absolute' }])
    const { history } = renderPalette()

    fireEvent.keyDown(screen.getByLabelText('command or jump'), { key: 'Enter' })

    expect(history.at(-1)).toBe('/feed?tab=1#top')
  })
})

it('falls back to the literal handle when the typeahead has no match', async () => {
  const { history } = renderPalette()
  const input = screen.getByLabelText('command or jump')
  await waitFor(() => expect(document.activeElement).toBe(input))

  fireEvent.change(input, { target: { value: '@nobody.test' } })
  const option = await screen.findByRole('option')
  expect(option.textContent).toContain('@nobody.test')

  fireEvent.keyDown(input, { key: 'Enter' })
  expect(history.at(-1)).toBe('/profile/nobody.test')
})
