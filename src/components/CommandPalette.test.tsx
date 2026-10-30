import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { useUiStore } from '../lib/ui'
import { CommandPalette } from './CommandPalette'

const pinnedState = vi.hoisted(() => ({
  feeds: [] as { uri: string; name: string; description: string; avatar: string | null }[],
}))

vi.mock('../hooks/usePinnedFeeds', () => ({
  usePinnedFeeds: () => ({ feeds: pinnedState.feeds, isPending: false }),
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

  const queryClient = new QueryClient()

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

  it('falls through to a network search when no command matches', () => {
    const { history, onClose } = renderPalette()
    submit('atproto')
    expect(history.at(-1)).toBe('/search?q=atproto')
    expect(onClose).toHaveBeenCalled()
  })
})
