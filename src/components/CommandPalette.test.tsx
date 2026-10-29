import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
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
  const input = screen.getByLabelText('jump to')
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useSettings.setState({ theme: 'void' })
  })

  it('opens settings for the theme command instead of searching', () => {
    const { onClose, onOpenSettings } = renderPalette()
    submit('theme')
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
