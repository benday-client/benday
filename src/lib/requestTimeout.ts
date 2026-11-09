// Auth and portal requests must settle. A host that accepts the connection and
// then stalls would otherwise leave sign-in, logout or restore pending for as
// long as the tab is open.
export const REQUEST_TIMEOUT_MS = 8000

/**
 * A fetch with a deadline. The caller's own signal still wins, so a cancelled
 * or replaced request keeps its cancellation instead of waiting out the timeout.
 */
export const boundedFetch: typeof globalThis.fetch = (input, init) => {
  const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = caller === undefined ? deadline : AbortSignal.any([caller, deadline])
  return globalThis.fetch(input, { ...init, signal })
}
