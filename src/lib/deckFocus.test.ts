import { expect, it, vi } from 'vitest'
import { focusDeckAfterSwap } from './deckFocus'

it('keeps newer external focus while a deck recovery is queued', () => {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})

  const view = document.createElement('section')
  const deck = document.createElement('div')
  deck.className = 'b-deck'
  deck.tabIndex = 0
  view.append(deck)
  const outside = document.createElement('button')
  outside.textContent = 'outside control'
  document.body.append(view, outside)

  const dispose = focusDeckAfterSwap(view)
  try {
    outside.focus()
    const frame = frames.shift()
    if (frame === undefined) throw new Error('missing queued focus frame')
    frame(0)

    expect(outside).toHaveFocus()
  } finally {
    dispose()
    view.remove()
    outside.remove()
    vi.restoreAllMocks()
  }
})
