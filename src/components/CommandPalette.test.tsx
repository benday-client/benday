import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useAuthStore } from '../lib/auth'
import { useSettings } from '../lib/store'
import { CommandPalette } from './CommandPalette'

interface RenderOptions {
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

  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <CommandPalette
          open
          onClose={onClose}
          onOpenAppView={onOpenAppView}
          onOpenHelp={onOpenHelp}
          onOpenSettings={onOpenSettings}
        />
      </Router>
    </QueryClientProvider>,
  )

  return { onClose, onOpenAppView, onOpenHelp, onOpenSettings, history: location.history }
}

function submit(value: string) {
  const input = screen.getByLabelText('command or jump')
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('CommandPalette', () => {
  beforeEach(() => {
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

  it('falls through to a network search when no command matches', () => {
    const { history, onClose } = renderPalette()
    submit('atproto')
    expect(history.at(-1)).toBe('/search?q=atproto')
    expect(onClose).toHaveBeenCalled()
  })
})
