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
      onOpenAppView={() => undefined}
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

function expectSelectedRowVisible(list: HTMLElement): void {
  const selected = list.querySelector<HTMLElement>('[data-selected="true"]')
  if (selected === null) throw new Error('no selected command row')
  const box = list.getBoundingClientRect()
  const row = selected.getBoundingClientRect()
  expect(row.height).toBeGreaterThan(0)
  expect(row.top).toBeGreaterThanOrEqual(box.top - 1)
  expect(row.bottom).toBeLessThanOrEqual(box.top + list.clientHeight + 1)
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

  it('keeps the dialog still and the selected row visible while arrowing', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { dialog, input, scroller } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    await userEvent.type(input, 'theme')
    const list = document.querySelector<HTMLElement>('.b-palette__list')
    if (list === null) throw new Error('palette list missing')
    // non-vacuous: the results genuinely overflow their box
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)

    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.b-palette__command'))
    const baseline = rectOf(dialog)
    const assertStep = () => {
      expectSameRect(rectOf(dialog), baseline)
      expect(document.scrollingElement?.scrollTop ?? 0).toBe(0)
      // the container above the palette was never asked to move
      expect(scroller.scrollTop).toBe(40)
      expectSelectedRowVisible(list)
    }

    assertStep()

    for (let press = 0; press < 12; press += 1) {
      const before = rowIndex(rows())
      await userEvent.keyboard('{ArrowDown}')
      expect(rowIndex(rows())).toBe(before + 1)
      assertStep()
    }
    // the selection really scrolled the list instead of the dialog
    expect(list.scrollTop).toBeGreaterThan(0)

    for (let press = 0; press < 4; press += 1) {
      const before = rowIndex(rows())
      await userEvent.keyboard('{ArrowUp}')
      expect(rowIndex(rows())).toBe(before - 1)
      assertStep()
    }

    // walk to the last row, then one more press wraps to the first
    for (let press = rowIndex(rows()); press < rows().length - 1; press += 1) {
      await userEvent.keyboard('{ArrowDown}')
    }
    expect(rowIndex(rows())).toBe(rows().length - 1)
    assertStep()

    await userEvent.keyboard('{ArrowDown}')
    expect(rowIndex(rows())).toBe(0)
    assertStep()
    // wrapping back to the first row scrolls the list itself back to the top
    expect(list.scrollTop).toBe(0)
    expect(list.querySelector('[data-selected="true"]')?.textContent).toContain('theme void')
  })

  it('keeps keyboard selection while the pointer is parked over the list', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { dialog, input, scroller } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    await userEvent.type(input, 'theme')
    const list = document.querySelector<HTMLElement>('.b-palette__list')
    if (list === null) throw new Error('palette list missing')
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)

    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.b-palette__command'))
    // the pointer parks over the middle of the list, selecting whatever row is
    // there, and then never moves again
    await userEvent.hover(list)
    expect(document.activeElement).toBe(input)
    const sequence = [rowIndex(rows())]
    expect(sequence[0]).toBeGreaterThanOrEqual(0)

    const baseline = rectOf(dialog)
    const scrollBefore = list.scrollTop
    for (let press = 0; press < 10; press += 1) {
      const previous = sequence[sequence.length - 1] ?? 0
      const total = rows().length
      await userEvent.keyboard('{ArrowDown}')
      const current = rowIndex(rows())
      sequence.push(current)
      // one row per press, wrapping only from the last row to the first: a row
      // scrolling under the parked cursor must never pull the selection back
      expect(
        current,
        `selection after ${press + 1} presses of arrow down: [${sequence.join(', ')}]`,
      ).toBe(previous === total - 1 ? 0 : previous + 1)
      expectSameRect(rectOf(dialog), baseline)
      expect(document.scrollingElement?.scrollTop ?? 0).toBe(0)
      expect(scroller.scrollTop).toBe(40)
    }
    // the list itself did scroll as the selection advanced
    expect(list.scrollTop).toBeGreaterThan(scrollBefore)

    // a genuine pointer move still takes the selection over
    const target = rows()[2]
    if (target === undefined) throw new Error('third row missing')
    await userEvent.hover(target)
    expect(rowIndex(rows())).toBe(2)
  })

  it('moves with ctrl chords, Home/End and PageDown without moving the dialog', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { dialog, input, scroller } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    await userEvent.type(input, 'theme')
    const list = document.querySelector<HTMLElement>('.b-palette__list')
    if (list === null) throw new Error('palette list missing')
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)

    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.b-palette__command'))
    const baseline = rectOf(dialog)
    const assertStill = () => {
      expectSameRect(rectOf(dialog), baseline)
      expect(document.scrollingElement?.scrollTop ?? 0).toBe(0)
      expect(scroller.scrollTop).toBe(40)
      expectSelectedRowVisible(list)
    }

    expect(rowIndex(rows())).toBe(0)
    await userEvent.keyboard('{Control>}n{/Control}')
    expect(rowIndex(rows())).toBe(1)
    assertStill()

    await userEvent.keyboard('{Control>}n{/Control}')
    expect(rowIndex(rows())).toBe(2)
    await userEvent.keyboard('{Control>}p{/Control}')
    expect(rowIndex(rows())).toBe(1)
    assertStill()

    await userEvent.keyboard('{End}')
    expect(rowIndex(rows())).toBe(rows().length - 1)
    assertStill()

    await userEvent.keyboard('{Home}')
    expect(rowIndex(rows())).toBe(0)
    assertStill()

    // a page is the number of rows the results box really fits
    const rowHeight = rows()[0]?.getBoundingClientRect().height ?? 0
    expect(rowHeight).toBeGreaterThan(0)
    const pageRows = Math.max(1, Math.floor(list.clientHeight / rowHeight))

    await userEvent.keyboard('{PageDown}')
    expect(rowIndex(rows())).toBe(Math.min(pageRows, rows().length - 1))
    assertStill()

    await userEvent.keyboard('{PageDown}')
    expect(rowIndex(rows())).toBe(Math.min(pageRows * 2, rows().length - 1))
    assertStill()

    await userEvent.keyboard('{PageUp}')
    expect(rowIndex(rows())).toBe(Math.min(pageRows, rows().length - 1))
    assertStill()
  })

  it('closes with ctrl+k while the field has focus', async () => {
    await page.viewport(viewport.width, viewport.height)
    const { dialog, input, close } = renderPalette()
    await waitFor(() => expect(document.activeElement).toBe(input))

    await userEvent.type(input, 'theme')
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
