/**
 * App-entry provenance for in-app navigation.
 *
 * A thread opened from a card must only go back when there is a real app
 * entry behind it; a direct load (or a foreign predecessor) has to fall back
 * to the feed instead of leaving the app. The router stamps the entry depth
 * here, so every navigation path — links, query replacements and programmatic
 * calls — shares one answer.
 */
import type { NavigateOptions } from 'wouter'

export const THREAD_FALLBACK_VIEW = '/feed'

/** Reserved key inside `history.state`; nothing else reads or writes it. */
const HISTORY_KEY = '__bendayHistory'

function markedDepth(state: unknown): number {
  if (state === null || typeof state !== 'object' || !(HISTORY_KEY in state)) return 0
  const mark: unknown = state[HISTORY_KEY]
  if (mark === null || typeof mark !== 'object' || !('depth' in mark)) return 0
  const depth: unknown = mark.depth
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth <= 0) return 0
  return depth
}

/**
 * How many app-owned entries sit behind the current one. Unmarked, missing or
 * malformed state reads as zero, which is the "no safe back" case.
 */
export function appHistoryDepth(): number {
  return markedDepth(window.history.state)
}

/**
 * Stamp the navigation about to be committed with its entry depth. A push
 * adds one entry, a replace keeps the current depth, and the caller's own
 * state object and options survive untouched apart from this reserved field.
 */
export function withAppHistory(options: NavigateOptions | undefined): NavigateOptions {
  const depth = appHistoryDepth()
  const nextDepth = options?.replace === true ? depth : depth + 1
  const state: unknown = options?.state
  const callerState = state !== null && typeof state === 'object' ? { ...state } : {}
  return {
    ...options,
    state: { ...callerState, [HISTORY_KEY]: { depth: nextDepth } },
  }
}

let pendingBack = false

function settlePendingBack(): void {
  pendingBack = false
  window.removeEventListener('popstate', settlePendingBack)
  window.removeEventListener('pushState', settlePendingBack)
  window.removeEventListener('replaceState', settlePendingBack)
}

/**
 * Leave the current surface: go back through a real app entry when one exists,
 * otherwise replace the current entry with `fallback` so the app never hands
 * navigation to a foreign page. A second call before the first pop settles is
 * dropped, so a rapid double Escape cannot walk two entries back.
 */
export function goBackOrFallback(
  navigate: (to: string, options?: NavigateOptions) => void,
  fallback: string,
): void {
  if (pendingBack) return
  if (appHistoryDepth() === 0) {
    navigate(fallback, { replace: true })
    return
  }
  pendingBack = true
  window.addEventListener('popstate', settlePendingBack)
  window.addEventListener('pushState', settlePendingBack)
  window.addEventListener('replaceState', settlePendingBack)
  window.history.back()
}
