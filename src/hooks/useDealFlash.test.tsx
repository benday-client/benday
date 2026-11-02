import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDealFlash } from './useDealFlash'

afterEach(() => {
  vi.useRealTimers()
})

describe('useDealFlash', () => {
  it('holds a deal for its beat and restarts on a newer one', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDealFlash<'modes' | 'posts'>())
    expect(result.current[0]).toBeNull()

    act(() => result.current[1]('posts'))
    expect(result.current[0]).toBe('posts')

    act(() => vi.advanceTimersByTime(600))
    act(() => result.current[1]('modes'))
    act(() => vi.advanceTimersByTime(600))
    // the first deal's timer cannot clear the second one early
    expect(result.current[0]).toBe('modes')

    act(() => vi.advanceTimersByTime(300))
    expect(result.current[0]).toBeNull()
  })

  it('clears its timer on unmount', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useDealFlash<'a'>())
    act(() => result.current[1]('a'))
    unmount()

    act(() => vi.advanceTimersByTime(2000))
    expect(vi.getTimerCount()).toBe(0)
  })
})
