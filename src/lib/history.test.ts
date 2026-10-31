import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NavigateOptions } from 'wouter'
import { appHistoryDepth, goBackOrFallback, THREAD_FALLBACK_VIEW, withAppHistory } from './history'

function seedDepth(depth: number): void {
  window.history.replaceState({ __bendayHistory: { depth } }, '')
}

function stamped(options: NavigateOptions): unknown {
  const state: unknown = options.state
  if (state === null || typeof state !== 'object' || !('__bendayHistory' in state)) return undefined
  return state.__bendayHistory
}

beforeEach(() => {
  window.history.replaceState(null, '')
})

afterEach(() => {
  // settle any pending-back latch so one case cannot block the next
  window.dispatchEvent(new Event('popstate'))
  vi.restoreAllMocks()
})

describe('app history depth', () => {
  it('reads a marked entry depth', () => {
    seedDepth(3)
    expect(appHistoryDepth()).toBe(3)
    seedDepth(1)
    expect(appHistoryDepth()).toBe(1)
  })

  it('treats unmarked and malformed state as depth zero', () => {
    window.history.replaceState(null, '')
    expect(appHistoryDepth()).toBe(0)

    window.history.replaceState({ other: true }, '')
    expect(appHistoryDepth()).toBe(0)

    window.history.replaceState({ __bendayHistory: null }, '')
    expect(appHistoryDepth()).toBe(0)

    window.history.replaceState({ __bendayHistory: {} }, '')
    expect(appHistoryDepth()).toBe(0)

    for (const depth of [0, -2, 1.5, '2', true, null]) {
      window.history.replaceState({ __bendayHistory: { depth } }, '')
      expect(appHistoryDepth(), `depth ${String(depth)}`).toBe(0)
    }
  })
})

describe('history stamping', () => {
  it('adds an entry for a push and keeps the depth for a replace', () => {
    expect(stamped(withAppHistory(undefined))).toEqual({ depth: 1 })
    expect(stamped(withAppHistory({ replace: false }))).toEqual({ depth: 1 })
    expect(stamped(withAppHistory({ replace: true }))).toEqual({ depth: 0 })

    seedDepth(2)
    expect(stamped(withAppHistory(undefined))).toEqual({ depth: 3 })
    expect(stamped(withAppHistory({ replace: true }))).toEqual({ depth: 2 })
  })

  it('preserves the caller state and every other option', () => {
    seedDepth(4)
    const options = { replace: true, transition: true, state: { from: 'feed' } }
    const result = withAppHistory(options)

    expect(result.replace).toBe(true)
    expect(result.transition).toBe(true)
    expect(result.state.from).toBe('feed')
    expect(stamped(result)).toEqual({ depth: 4 })
    // the caller's object is untouched
    expect(options.state).toEqual({ from: 'feed' })
  })

  it('keeps modifier options off a bare call', () => {
    const result = withAppHistory(undefined)
    expect(Object.keys(result).sort()).toEqual(['state'])
    expect(result.replace).toBeUndefined()
    expect(result.transition).toBeUndefined()
  })
})

describe('back with a fallback', () => {
  it('replaces with the fallback and never calls native back at depth zero', () => {
    const navigate = vi.fn()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    goBackOrFallback(navigate, THREAD_FALLBACK_VIEW)

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/feed', { replace: true })
    expect(back).not.toHaveBeenCalled()
  })

  it('honours the caller fallback', () => {
    const navigate = vi.fn()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    goBackOrFallback(navigate, '/search')

    expect(navigate).toHaveBeenCalledWith('/search', { replace: true })
    expect(back).not.toHaveBeenCalled()
  })

  it('pops one app entry and drops a second call in the same tick', () => {
    seedDepth(2)
    const navigate = vi.fn()
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    goBackOrFallback(navigate, THREAD_FALLBACK_VIEW)
    goBackOrFallback(navigate, THREAD_FALLBACK_VIEW)

    expect(back).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('settles the latch on popstate', () => {
    seedDepth(2)
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    goBackOrFallback(vi.fn(), THREAD_FALLBACK_VIEW)
    window.dispatchEvent(new Event('popstate'))
    goBackOrFallback(vi.fn(), THREAD_FALLBACK_VIEW)

    expect(back).toHaveBeenCalledTimes(2)
  })

  it('settles the latch on a router push or replace', () => {
    seedDepth(2)
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    goBackOrFallback(vi.fn(), THREAD_FALLBACK_VIEW)
    window.dispatchEvent(new Event('pushState'))
    goBackOrFallback(vi.fn(), THREAD_FALLBACK_VIEW)
    window.dispatchEvent(new Event('replaceState'))
    goBackOrFallback(vi.fn(), THREAD_FALLBACK_VIEW)

    expect(back).toHaveBeenCalledTimes(3)
  })
})
