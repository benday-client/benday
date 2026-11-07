import { fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '../lib/store'
import { useHotkeys } from './useHotkeys'

interface Handlers {
  onMove: () => void
  onLike: () => void
  onSearch: () => void
  onHelp: () => void
  onPalette: () => void
  onBack: () => void
  onDown: () => void
}

function Harness({ handlers }: { handlers: Handlers }) {
  useHotkeys([
    { key: 'j', handler: handlers.onMove },
    { key: 'f', handler: handlers.onLike },
    { key: '/', handler: handlers.onSearch },
    { key: '?', handler: handlers.onHelp },
    { key: 'k', ctrlOrMeta: true, handler: handlers.onPalette },
    { key: 'Escape', handler: handlers.onBack },
    { key: 'ArrowDown', handler: handlers.onDown },
  ])
  return null
}

function handlers(): Handlers {
  return {
    onMove: vi.fn(),
    onLike: vi.fn(),
    onSearch: vi.fn(),
    onHelp: vi.fn(),
    onPalette: vi.fn(),
    onBack: vi.fn(),
    onDown: vi.fn(),
  }
}

/** Whether the handler under test claimed (prevented) the keydown. */
function keyConsumed(init: KeyboardEventInit): boolean {
  let consumed = false
  const probe = (event: Event) => {
    consumed = (event as KeyboardEvent).defaultPrevented
  }
  window.addEventListener('keydown', probe)
  fireEvent.keyDown(window, init)
  window.removeEventListener('keydown', probe)
  return consumed
}

afterEach(() => {
  useSettings.setState({ keyboardShortcuts: true })
})

describe('useHotkeys character shortcut opt-out', () => {
  it('lets a modifier chord fire from an editable field but not a bare key', () => {
    const spies = handlers()
    render(
      createElement(
        'div',
        null,
        createElement(Harness, { handlers: spies }),
        createElement('input', { type: 'text', 'aria-label': 'field' }),
      ),
    )
    const field = document.querySelector('input')
    if (field === null) throw new Error('field missing')
    field.focus()

    fireEvent.keyDown(field, { key: 'k', ctrlKey: true })
    expect(spies.onPalette).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(field, { key: 'j' })
    expect(spies.onMove).not.toHaveBeenCalled()
  })

  it('runs every binding while the setting is on', () => {
    const spies = handlers()
    render(createElement(Harness, { handlers: spies }))

    expect(keyConsumed({ key: 'j' })).toBe(true)
    fireEvent.keyDown(window, { key: 'f' })
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.keyDown(window, { key: '?' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    expect(spies.onMove).toHaveBeenCalledTimes(1)
    expect(spies.onLike).toHaveBeenCalledTimes(1)
    expect(spies.onSearch).toHaveBeenCalledTimes(1)
    expect(spies.onHelp).toHaveBeenCalledTimes(1)
    expect(spies.onPalette).toHaveBeenCalledTimes(1)
    expect(spies.onBack).toHaveBeenCalledTimes(1)
    expect(spies.onDown).toHaveBeenCalledTimes(1)
  })

  it('rejects every bare character shortcut and keeps modifier and navigation keys', () => {
    useSettings.setState({ keyboardShortcuts: false })
    const spies = handlers()
    render(createElement(Harness, { handlers: spies }))

    // a rejected key is neither handled nor claimed, including the anchors
    for (const key of ['j', 'f', '/', '?']) {
      expect(keyConsumed({ key }), key).toBe(false)
    }
    fireEvent.keyDown(window, { key: 'f' })
    fireEvent.keyDown(window, { key: '/' })
    fireEvent.keyDown(window, { key: '?' })
    expect(spies.onMove).not.toHaveBeenCalled()
    expect(spies.onLike).not.toHaveBeenCalled()
    expect(spies.onSearch).not.toHaveBeenCalled()
    expect(spies.onHelp).not.toHaveBeenCalled()

    // a modifier chord is not a single-character shortcut
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(spies.onPalette).toHaveBeenCalledTimes(1)

    // non-character keys never depended on the setting
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(spies.onBack).toHaveBeenCalledTimes(1)
    expect(spies.onDown).toHaveBeenCalledTimes(1)
  })
})
