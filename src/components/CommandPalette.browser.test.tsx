import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useAuthStore } from '../lib/auth'
import { createTestQueryClient } from '../test/queryClient'
import { installTransport, jsonResponse } from '../test/transport'
import { CommandPalette } from './CommandPalette'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 900, height: 420 },
] as const

const ACTORS = [
  { did: 'did:plc:alice', handle: 'alice.test', displayName: 'alice' },
  { did: 'did:plc:ada', handle: 'ada.test', displayName: 'ada' },
]

interface Rect {
  top: number
  height: number
}

/** Owns the open flag so a close key can actually dismiss the dialog. */
function PaletteHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <CommandPalette
      open={open}
      onClose={() => {
        setOpen(false)
        onClose()
      }}
      onOpenHelp={() => undefined}
      onOpenSettings={() => undefined}
    />
  )
}

function renderPalette() {
  // the typeahead answers from the recording transport: `a` has two handles and
  // every other query has none, so the pending window and both settled shapes
  // are deterministic without reaching the network
  const transport = installTransport()
  transport.route(
    'GET',
    'https://api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead',
    (request) => {
      const query = new URL(request.url).searchParams.get('q') ?? ''
      return jsonResponse(200, { actors: query === 'a' ? ACTORS : [] })
    },
  )
  const close = vi.fn()
  const queryClient = createTestQueryClient()
  const memory = memoryLocation({ path: '/', record: true })
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={memory.hook}>
        {/* a scrolled container above the palette, as every view shell has */}
        <div data-testid="scroller" style={{ height: '120px', overflow: 'auto' }}>
          <PaletteHost onClose={close} />
          <div style={{ height: '1200px' }} aria-hidden="true" />
        </div>
      </Router>
    </QueryClientProvider>,
  )

  const dialog = document.querySelector<HTMLDialogElement>('dialog.b-palette')
  if (dialog === null) throw new Error('palette dialog missing')
  const scroller = screen.getByTestId('scroller')
  scroller.scrollTop = 40
  return { dialog, input: screen.getByLabelText('command or jump'), scroller, close, memory }
}

function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect()
  return { top: rect.top, height: rect.height }
}

function expectSameRect(actual: Rect, baseline: Rect): void {
  expect(Math.abs(actual.top - baseline.top)).toBeLessThanOrEqual(0.5)
  expect(Math.abs(actual.height - baseline.height)).toBeLessThanOrEqual(0.5)
}

function rowIndex(rows: HTMLElement[]): number {
  return rows.findIndex((row) => row.getAttribute('data-selected') === 'true')
}

describe.each(VIEWPORTS)('command palette at $width×$height', (viewport) => {
  it('keeps the dialog in place while the results change shape', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { dialog, input } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    // one row: a mention with no typeahead matches, the shape the debounce
    // window shows before the query settles
    await userEvent.type(input, '@qqq')
    await waitFor(() => {
      expect(document.querySelectorAll('.b-palette__command').length).toBe(1)
    })
    const baseline = rectOf(dialog)

    // two rows: the settled suggestion list
    await userEvent.clear(input)
    await userEvent.type(input, '@a')
    await waitFor(() => {
      expect(document.querySelectorAll('.b-palette__command').length).toBe(ACTORS.length)
    })
    expectSameRect(rectOf(dialog), baseline)

    // many rows: the cleared query restores the full command list
    await userEvent.clear(input)
    await waitFor(() => {
      expect(document.querySelectorAll('.b-palette__command').length).toBeGreaterThan(ACTORS.length)
    })
    expectSameRect(rectOf(dialog), baseline)

    // no rows: the zero-match note fills the same reserved box
    await userEvent.type(input, 'zzzz')
    expect(document.querySelector('.b-palette__empty')?.textContent).toBe(
      'no matching command · enter searches the network',
    )
    expectSameRect(rectOf(dialog), baseline)
  })

  it('closes with ctrl+k while the field has focus', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { dialog, input, close } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    await userEvent.type(input, ' ')
    expect(dialog.open).toBe(true)

    await userEvent.keyboard('{Control>}k{/Control}')
    expect(close).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(dialog.open).toBe(false))
  })

  it('opens @me from the highlighted row with the keyboard', async () => {
    await page.viewport(viewport.width, viewport.height)
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    try {
      const { input, close, memory } = renderPalette()
      await waitFor(() => expect(document.activeElement).toBe(input))

      await userEvent.type(input, '@me')
      const option = screen.getByRole('option')
      expect(option.textContent).toContain('@me.test')
      expect(input.getAttribute('aria-activedescendant')).toBe(option.id)

      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
      expect(memory.history.at(-1)).toBe('/profile/me.test')
    } finally {
      useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
    }
  })

  it('opens @me from the same row when it is clicked', async () => {
    await page.viewport(viewport.width, viewport.height)
    useAuthStore.setState({
      status: 'authenticated',
      account: { did: 'did:plc:me', handle: 'me.test' },
      pending: false,
      error: null,
    })
    try {
      const { input, close, memory } = renderPalette()
      await waitFor(() => expect(document.activeElement).toBe(input))

      await userEvent.type(input, '@me')
      const option = screen.getByRole('option')
      await userEvent.click(option)
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
      expect(memory.history.at(-1)).toBe('/profile/me.test')
    } finally {
      useAuthStore.setState({ status: 'anonymous', account: null, pending: false, error: null })
    }
  })

  it('opens the actor the selection was moved to', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { input, close, memory } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    await userEvent.type(input, '@a')
    await waitFor(() => {
      expect(document.querySelectorAll('.b-palette__command').length).toBe(ACTORS.length)
    })
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.b-palette__command'))
    expect(rowIndex(rows)).toBe(0)

    await userEvent.keyboard('{ArrowDown}')
    const selected = rows[rowIndex(rows)]
    expect(selected?.textContent).toContain('@ada.test')
    expect(input.getAttribute('aria-activedescendant')).toBe(selected?.id)

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    expect(memory.history.at(-1)).toBe('/profile/ada.test')
  })

  it('leaves the caret keys native and closes once on Escape', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { dialog, input, close } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    await userEvent.type(input, 'zzzz')
    await waitFor(() => {
      expect(document.querySelector('.b-palette__empty')?.textContent).toContain('no matching')
    })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.getAttribute('aria-controls')).toBeNull()

    await userEvent.keyboard('{Home}')
    expect((input as HTMLInputElement).selectionStart).toBe(0)
    await userEvent.keyboard('{End}')
    expect((input as HTMLInputElement).selectionStart).toBe(4)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dialog.open).toBe(false))
  })
})
