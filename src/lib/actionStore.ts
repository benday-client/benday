import { create } from 'zustand'
import {
  fetchViewerStates,
  likePost,
  repostPost,
  unlikePost,
  unrepostPost,
  type ViewerState,
} from './actions'
import { useAuthStore } from './auth'
import { errorInfo } from './errors'
import type { PostModel } from './types'

export type ActionPending = 'like' | 'unlike' | 'repost' | 'unrepost'

export interface ActionEntry {
  likeUri: string | null
  repostUri: string | null
  likeDelta: number
  repostDelta: number
  likeBaseCount: number | null
  repostBaseCount: number | null
  pending: ActionPending | null
  error: string | null
  /** when each side was last confirmed, by a canonical read or a local write */
  likeCheckedAt: number | null
  repostCheckedAt: number | null
  /** when this tab last wrote each side; canonical state may lag until then */
  likeWrittenAt: number | null
  repostWrittenAt: number | null
}

export const VIEWER_STALE_TIME = 45_000
export const WRITE_CONFIRMATION_TIME = 45_000
export const UNCONFIRMED_STATE = 'could not confirm the current interaction state'

interface ActionState {
  byUri: Record<string, ActionEntry>
  syncViewer: (uris: readonly string[]) => Promise<void>
  retireCounts: (snapshots: readonly PostCountSnapshot[]) => void
  toggleLike: (post: PostModel) => Promise<void>
  toggleRepost: (post: PostModel) => Promise<void>
  reset: () => void
}

type Side = 'like' | 'repost'

/** the canonical counts a currently loaded card carries */
type PostCountSnapshot = Pick<PostModel, 'uri' | 'likeCount' | 'repostCount'>

const EMPTY_ENTRY: ActionEntry = {
  likeUri: null,
  repostUri: null,
  likeDelta: 0,
  repostDelta: 0,
  likeBaseCount: null,
  repostBaseCount: null,
  pending: null,
  error: null,
  likeCheckedAt: null,
  repostCheckedAt: null,
  likeWrittenAt: null,
  repostWrittenAt: null,
}

let generation = 0
// one write lock per post uri; a second toggle waits for the first to settle
const inFlight = new Map<string, symbol>()
// one read per post uri, shared by the background sync and by toggles
const reads = new Map<string, Promise<void>>()

function startBusy(map: Map<string, symbol>, key: string): symbol {
  const token = Symbol(key)
  map.set(key, token)
  return token
}

function endBusy(map: Map<string, symbol>, key: string, token: symbol): void {
  if (map.get(key) === token) map.delete(key)
}

function entryFor(state: ActionState, uri: string): ActionEntry {
  return state.byUri[uri] ?? EMPTY_ENTRY
}

function withEntry(
  state: ActionState,
  uri: string,
  patch: Partial<ActionEntry>,
): Record<string, ActionEntry> {
  return {
    ...state.byUri,
    [uri]: { ...entryFor(state, uri), ...patch },
  }
}

/**
 * Optimistic counts are relative to the post count the toggle was based on.
 * A refreshed post count that no longer matches that base means the delta is
 * stale, so the refreshed count wins.
 */
export function displayedCount(count: number, base: number | null, delta: number): number {
  if (base === null || count !== base) return count
  return Math.max(0, count + delta)
}

function rebaseCount(
  base: number | null,
  delta: number,
  count: number,
): { base: number; delta: number } {
  if (base !== null && base === count) return { base, delta }
  return { base: count, delta: 0 }
}

function sideStale(checkedAt: number | null, now: number): boolean {
  return checkedAt === null || now - checkedAt >= VIEWER_STALE_TIME
}

function needsViewerRead(entry: ActionEntry, now: number): boolean {
  return sideStale(entry.likeCheckedAt, now) || sideStale(entry.repostCheckedAt, now)
}

/**
 * Reconcile one side against the canonical appview state. A local write keeps
 * winning until its confirmation deadline, because an appview read can still
 * describe the state from before that write.
 */
function reconcileSide(
  entry: ActionEntry,
  side: Side,
  canonical: string | null,
  now: number,
): Partial<ActionEntry> {
  const writtenAt = side === 'like' ? entry.likeWrittenAt : entry.repostWrittenAt
  const localUri = side === 'like' ? entry.likeUri : entry.repostUri
  const confirming = writtenAt !== null && now - writtenAt < WRITE_CONFIRMATION_TIME

  if (canonical === localUri) {
    // the appview caught up: acknowledge and drop the delta's protection
    return side === 'like'
      ? { likeCheckedAt: now, likeWrittenAt: null }
      : { repostCheckedAt: now, repostWrittenAt: null }
  }

  if (confirming) return {}

  return side === 'like'
    ? {
        likeUri: canonical,
        likeDelta: 0,
        likeBaseCount: null,
        likeCheckedAt: now,
        likeWrittenAt: null,
      }
    : {
        repostUri: canonical,
        repostDelta: 0,
        repostBaseCount: null,
        repostCheckedAt: now,
        repostWrittenAt: null,
      }
}

function applyViewerRead(
  captured: ReadonlyMap<string, ActionEntry | undefined>,
  states: ReadonlyMap<string, ViewerState>,
): void {
  const now = Date.now()
  useActionStore.setState((state) => {
    let byUri: Record<string, ActionEntry> = state.byUri
    let changed = false
    for (const [uri, viewer] of states) {
      // only the entry object that started the read may consume its result
      if (state.byUri[uri] !== captured.get(uri)) continue
      const base = entryFor(state, uri)
      const patch = {
        ...reconcileSide(base, 'like', viewer.likeUri, now),
        ...reconcileSide(base, 'repost', viewer.repostUri, now),
      }
      if (Object.keys(patch).length === 0) continue
      if (!changed) {
        byUri = { ...state.byUri }
        changed = true
      }
      byUri[uri] = { ...base, ...patch }
    }
    return changed ? { byUri } : {}
  })
}

function startViewerRead(uris: readonly string[], session: number): Promise<void> {
  const captured = new Map<string, ActionEntry | undefined>()
  for (const uri of uris) captured.set(uri, useActionStore.getState().byUri[uri])

  const promise = (async () => {
    const states = await fetchViewerStates(uris)
    if (generation !== session) return
    // uris the appview omitted keep their previous freshness and are retried
    applyViewerRead(captured, states)
  })()

  for (const uri of uris) reads.set(uri, promise)
  const cleanup = () => {
    for (const uri of uris) {
      if (reads.get(uri) === promise) reads.delete(uri)
    }
  }
  void promise.then(cleanup, cleanup)
  return promise
}

function readViewer(uris: readonly string[], session: number): Promise<void> {
  const shared: Promise<void>[] = []
  const missing: string[] = []
  for (const uri of uris) {
    const pending = reads.get(uri)
    if (pending === undefined) missing.push(uri)
    else shared.push(pending)
  }
  if (missing.length > 0) shared.push(startViewerRead(missing, session))
  return Promise.all(shared).then(() => undefined)
}

export const useActionStore = create<ActionState>()((set, get) => {
  /**
   * One side of the interaction state. Both sides share the canonical read,
   * the one-write-per-uri lock and the freshness policy, but each keeps its own
   * fields and its own write, branch by branch, so neither drifts into the
   * other's patch.
   */
  const toggleSide = async (post: PostModel, side: Side): Promise<void> => {
    const session = generation
    const entry = entryFor(get(), post.uri)
    if (entry.pending !== null || inFlight.has(post.uri)) return

    // only the requested kind is captured before awaiting; the uri comes from
    // the entry once its state is confirmed
    const entryUri = side === 'like' ? entry.likeUri : entry.repostUri
    const intent: ActionPending =
      side === 'like'
        ? entryUri === null
          ? 'like'
          : 'unlike'
        : entryUri === null
          ? 'repost'
          : 'unrepost'
    const token = startBusy(inFlight, post.uri)

    try {
      const checkedAt = side === 'like' ? entry.likeCheckedAt : entry.repostCheckedAt
      if (sideStale(checkedAt, Date.now())) {
        try {
          await readViewer([post.uri], session)
        } catch {
          if (generation === session) {
            set((state) => ({
              byUri: withEntry(state, post.uri, { pending: null, error: UNCONFIRMED_STATE }),
            }))
          }
          return
        }
        if (generation !== session) return

        const refreshed = entryFor(get(), post.uri)
        const refreshedChecked =
          side === 'like' ? refreshed.likeCheckedAt : refreshed.repostCheckedAt
        if (sideStale(refreshedChecked, Date.now())) {
          set((state) => ({
            byUri: withEntry(state, post.uri, { pending: null, error: UNCONFIRMED_STATE }),
          }))
          return
        }
        if (refreshed.pending !== null) return
      }

      const current = entryFor(get(), post.uri)
      const uri = side === 'like' ? current.likeUri : current.repostUri
      const satisfied = intent === 'like' || intent === 'repost' ? uri !== null : uri === null
      if (satisfied) {
        // the requested state already holds, so there is nothing to write. A
        // failure alert from an earlier attempt must not outlive the click
        // that confirmed the state.
        if (current.error !== null) {
          set((state) => ({ byUri: withEntry(state, post.uri, { error: null }) }))
        }
        return
      }

      const rebased =
        side === 'like'
          ? rebaseCount(current.likeBaseCount, current.likeDelta, post.likeCount)
          : rebaseCount(current.repostBaseCount, current.repostDelta, post.repostCount)
      set((state) => ({
        byUri: withEntry(
          state,
          post.uri,
          side === 'like'
            ? {
                pending: intent,
                error: null,
                likeBaseCount: rebased.base,
                likeDelta: rebased.delta,
              }
            : {
                pending: intent,
                error: null,
                repostBaseCount: rebased.base,
                repostDelta: rebased.delta,
              },
        ),
      }))

      if (intent === 'unlike') {
        if (uri === null) return
        await unlikePost(uri)
        if (generation !== session) return
        const now = Date.now()
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            likeUri: null,
            likeDelta: entryFor(state, post.uri).likeDelta - 1,
            pending: null,
            likeCheckedAt: now,
            likeWrittenAt: now,
          }),
        }))
        return
      }

      if (intent === 'unrepost') {
        if (uri === null) return
        await unrepostPost(uri)
        if (generation !== session) return
        const now = Date.now()
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            repostUri: null,
            repostDelta: entryFor(state, post.uri).repostDelta - 1,
            pending: null,
            repostCheckedAt: now,
            repostWrittenAt: now,
          }),
        }))
        return
      }

      const result = side === 'like' ? await likePost(post) : await repostPost(post)
      if (generation !== session) return
      const now = Date.now()
      set((state) => ({
        byUri: withEntry(
          state,
          post.uri,
          side === 'like'
            ? {
                likeUri: result.uri,
                likeDelta: entryFor(state, post.uri).likeDelta + 1,
                pending: null,
                likeCheckedAt: now,
                likeWrittenAt: now,
              }
            : {
                repostUri: result.uri,
                repostDelta: entryFor(state, post.uri).repostDelta + 1,
                pending: null,
                repostCheckedAt: now,
                repostWrittenAt: now,
              },
        ),
      }))
    } catch (error) {
      if (generation !== session) return
      set((state) => ({
        byUri: withEntry(state, post.uri, {
          pending: null,
          error: errorInfo(error).detail,
        }),
      }))
    } finally {
      endBusy(inFlight, post.uri, token)
    }
  }

  return {
    byUri: {},

    syncViewer: async (uris) => {
      const session = generation
      const now = Date.now()
      const stale = [...new Set(uris)].filter((uri) => needsViewerRead(entryFor(get(), uri), now))
      if (stale.length === 0) return

      try {
        await readViewer(stale, session)
      } catch {
        // viewer state is an enhancement here; a toggle reports its own failure
      }
    },

    /**
     * a newer canonical snapshot that disagrees with a stored base makes its
     * delta permanently stale; leaving the delta in place would revive it on
     * the next snapshot that happens to match the old base again
     */
    retireCounts: (snapshots) => {
      set((state) => {
        let byUri = state.byUri
        let changed = false
        for (const snapshot of snapshots) {
          const entry = byUri[snapshot.uri]
          if (entry === undefined) continue
          const retireLike =
            entry.likeBaseCount !== null &&
            entry.likeBaseCount !== snapshot.likeCount &&
            entry.likeDelta !== 0
          const retireRepost =
            entry.repostBaseCount !== null &&
            entry.repostBaseCount !== snapshot.repostCount &&
            entry.repostDelta !== 0
          if (!retireLike && !retireRepost) continue
          if (!changed) {
            byUri = { ...state.byUri }
            changed = true
          }
          byUri[snapshot.uri] = {
            ...entry,
            ...(retireLike ? { likeBaseCount: null, likeDelta: 0 } : {}),
            ...(retireRepost ? { repostBaseCount: null, repostDelta: 0 } : {}),
          }
        }
        return changed ? { byUri } : {}
      })
    },

    toggleLike: async (post) => {
      await toggleSide(post, 'like')
    },

    toggleRepost: async (post) => {
      await toggleSide(post, 'repost')
    },

    reset: () => {
      generation += 1
      inFlight.clear()
      reads.clear()
      set({ byUri: {} })
    },
  }
})

useAuthStore.subscribe((state, previous) => {
  const signedOut = previous.status === 'authenticated' && state.status !== 'authenticated'
  const switchedAccount =
    previous.status === 'authenticated' &&
    state.status === 'authenticated' &&
    previous.account?.did !== state.account?.did
  if (signedOut || switchedAccount) useActionStore.getState().reset()
})
