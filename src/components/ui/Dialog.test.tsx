import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

function dialogOf(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector('dialog')
  if (dialog === null) throw new Error('dialog missing')
  return dialog
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`${selector} missing`)
  return element
}

describe('Dialog', () => {
  beforeEach(() => {
    document.documentElement.dataset['theme'] = 'cyberpunk'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete document.documentElement.dataset['theme']
  })

  it('holds the dialog open for the close animation before closing it', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const { container, rerender } = render(
      <Dialog open title="test" onClose={onClose}>
        <p>body</p>
      </Dialog>,
    )
    const dialog = dialogOf(container)
    expect(dialog.open).toBe(true)

    rerender(
      <Dialog open={false} title="test" onClose={onClose}>
        <p>body</p>
      </Dialog>,
    )
    expect(dialog.open).toBe(true)
    expect(dialog.dataset['closing']).toBe('true')

    act(() => {
      vi.advanceTimersByTime(190)
    })
    expect(dialog.open).toBe(false)
    expect(dialog.dataset['closing']).toBeUndefined()
  })

  it('keeps a themed exit open for its declared duration past the floor', () => {
    vi.useFakeTimers()
    // cottagecore settles over 220ms, which is longer than the shared floor
    document.documentElement.dataset['theme'] = 'cottagecore'
    const onClose = vi.fn()
    const view = (open: boolean) => (
      <Dialog open={open} title="test" onClose={onClose}>
        <p>body</p>
      </Dialog>
    )
    const { container, rerender } = render(view(true))
    const dialog = dialogOf(container)
    // jsdom resolves this to the declared 220ms through the computed style
    dialog.style.setProperty('--motion-dur', '220ms')

    rerender(view(false))
    expect(dialog.open).toBe(true)
    expect(dialog.dataset['closing']).toBe('true')

    act(() => {
      vi.advanceTimersByTime(190)
    })
    expect(dialog.open).toBe(true)

    act(() => {
      vi.advanceTimersByTime(54)
    })
    expect(dialog.open).toBe(false)
    expect(dialog.dataset['closing']).toBeUndefined()
  })

  it('survives a reopen in the middle of the close animation', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const view = (open: boolean) => (
      <Dialog open={open} title="test" onClose={onClose}>
        <p>body</p>
      </Dialog>
    )
    const { container, rerender } = render(view(true))
    const dialog = dialogOf(container)

    rerender(view(false))
    expect(dialog.dataset['closing']).toBe('true')

    rerender(view(true))
    expect(dialog.dataset['closing']).toBeUndefined()
    expect(dialog.open).toBe(true)

    act(() => {
      vi.advanceTimersByTime(190)
    })
    expect(dialog.open).toBe(true)
  })

  it('closes immediately for a theme without an exit animation', () => {
    const onClose = vi.fn()
    const view = (open: boolean) => (
      <Dialog open={open} title="test" onClose={onClose}>
        <p>body</p>
      </Dialog>
    )
    const { container, rerender } = render(view(true))
    const dialog = dialogOf(container)
    expect(dialog.open).toBe(true)

    document.documentElement.dataset['theme'] = 'truth-to-materials'
    rerender(view(false))

    expect(dialog.open).toBe(false)
    expect(dialog.dataset['closing']).toBeUndefined()
  })

  it('closes immediately when reduced motion is preferred', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
    )
    const onClose = vi.fn()
    const view = (open: boolean) => (
      <Dialog open={open} title="test" onClose={onClose}>
        <p>body</p>
      </Dialog>
    )
    const { container, rerender } = render(view(true))
    const dialog = dialogOf(container)
    expect(dialog.open).toBe(true)

    rerender(view(false))

    expect(dialog.open).toBe(false)
    expect(dialog.dataset['closing']).toBeUndefined()
  })

  it('closes on a real backdrop click but not on a drag that started inside', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Dialog open title="test" onClose={onClose}>
        <input aria-label="field" />
      </Dialog>,
    )
    const dialog = dialogOf(container)
    const field = dialog.querySelector('input')
    if (field === null) throw new Error('field missing')

    // a selection drag starting inside the dialog retargets its click to the
    // dialog element; that is not a backdrop press
    fireEvent.pointerDown(field)
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    // the press state is per gesture, so a genuine backdrop click still closes
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('remembers the open size as custom properties without forcing a size', () => {
    vi.useFakeTimers()
    Object.defineProperty(HTMLDialogElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 320,
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 200,
    })

    const onClose = vi.fn()
    const view = (open: boolean) => (
      <Dialog open={open} title="test" onClose={onClose}>
        <p>body</p>
      </Dialog>
    )
    const { container, rerender } = render(view(true))
    const dialog = dialogOf(container)

    rerender(view(false))

    expect(dialog.style.getPropertyValue('--b-close-width')).toBe('320px')
    expect(dialog.style.getPropertyValue('--b-close-height')).toBe('200px')
    // the close size is only a custom property, so an open dialog keeps its
    // own layout instead of being pinned to the size it had while closing
    expect(dialog.style.width).toBe('')
    expect(dialog.style.height).toBe('')

    act(() => {
      vi.advanceTimersByTime(190)
    })
    expect(dialog.open).toBe(false)

    rerender(view(true))
    expect(dialog.open).toBe(true)
    expect(dialog.style.getPropertyValue('--b-close-width')).toBe('320px')
    expect(dialog.style.getPropertyValue('--b-close-height')).toBe('200px')
    expect(dialog.style.width).toBe('')
    expect(dialog.style.height).toBe('')
  })

  it('renders header extras only between the title and the close control', () => {
    const onClose = vi.fn()
    const view = (extra: boolean) => (
      <Dialog
        open
        title="test"
        onClose={onClose}
        headerClose
        headExtra={extra ? <span data-testid="hint">command enter posts</span> : undefined}
      >
        <p>body</p>
      </Dialog>
    )
    const { container, rerender } = render(view(false))
    const dialog = dialogOf(container)
    const head = query<HTMLElement>(dialog, '.b-dialog__head')
    expect(head.querySelector('[data-testid="hint"]')).toBeNull()

    rerender(view(true))
    const settledHead = query<HTMLElement>(dialog, '.b-dialog__head')
    const order = Array.from(settledHead.children)
    const extra = query<HTMLElement>(settledHead, '[data-testid="hint"]')
    expect(order.indexOf(extra)).toBe(1)
    expect(order.at(-1)).toBe(query<HTMLElement>(settledHead, '.b-dialog__close'))
  })

  it('opens on its first field instead of the header close control', () => {
    const { container } = render(
      <Dialog open title="test" onClose={vi.fn()} headerClose>
        <input aria-label="field" />
      </Dialog>,
    )
    const dialog = dialogOf(container)

    expect(document.activeElement).toBe(query<HTMLInputElement>(dialog, 'input'))
    expect(document.activeElement).not.toBe(query<HTMLButtonElement>(dialog, '.b-dialog__close'))
  })

  it('opens on the dialog itself when it has no field', () => {
    const { container } = render(
      <Dialog open title="test" onClose={vi.fn()} headerClose>
        <p>body</p>
      </Dialog>,
    )
    const dialog = dialogOf(container)

    expect(document.activeElement).toBe(dialog)
    expect(document.activeElement).not.toBe(query<HTMLButtonElement>(dialog, '.b-dialog__close'))
  })

  it('lets a marked element win the opening focus', () => {
    const { container } = render(
      <Dialog open title="test" onClose={vi.fn()} headerClose>
        <input aria-label="field" />
        <button type="button" data-autofocus>
          start
        </button>
      </Dialog>,
    )
    const dialog = dialogOf(container)

    expect(document.activeElement).toBe(query<HTMLButtonElement>(dialog, '[data-autofocus]'))
  })

  it('returns focus to the opener after closing', () => {
    document.documentElement.dataset['theme'] = 'truth-to-materials'
    const onClose = vi.fn()
    const view = (open: boolean) => (
      <>
        <button type="button">opener</button>
        <Dialog open={open} title="test" onClose={onClose} headerClose>
          <input aria-label="field" />
        </Dialog>
      </>
    )
    const { container, rerender } = render(view(false))
    const opener = query<HTMLButtonElement>(container, 'button')
    opener.focus()
    expect(document.activeElement).toBe(opener)

    rerender(view(true))
    expect(document.activeElement).toBe(query<HTMLInputElement>(container, 'input'))

    rerender(view(false))
    expect(document.activeElement).toBe(opener)
  })

  it('does not steal a focus the browser already placed inside the dialog', () => {
    // jsdom has no showModal, so the browser's own focusing steps are
    // simulated here: they honour a consumer's chosen field instead of the
    // first focusable element in DOM order
    const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      writable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '')
        this.querySelector<HTMLInputElement>('[aria-label="second"]')?.focus()
      },
    })

    try {
      const { container } = render(
        <Dialog open title="test" onClose={vi.fn()} headerClose>
          <input aria-label="first" />
          <input aria-label="second" />
        </Dialog>,
      )
      const dialog = dialogOf(container)

      expect(dialog.open).toBe(true)
      expect(document.activeElement).toBe(query<HTMLInputElement>(dialog, '[aria-label="second"]'))
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
      } else {
        Object.defineProperty(HTMLDialogElement.prototype, 'showModal', original)
      }
    }
  })
})
