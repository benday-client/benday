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
  likeLocal: boolean
  repostLocal: boolean
  pending: ActionPending | null
  error: string | null
  checked: boolean
}

interface ActionState {
  byUri: Record<string, ActionEntry>
  seedViewer: (states: ReadonlyMap<string, ViewerState>) => void
  syncViewer: (uris: readonly string[]) => Promise<void>
  toggleLike: (post: PostModel) => Promise<void>
  toggleRepost: (post: PostModel) => Promise<void>
  reset: () => void
}

const EMPTY_ENTRY: ActionEntry = {
  likeUri: null,
  repostUri: null,
  likeDelta: 0,
  repostDelta: 0,
  likeBaseCount: null,
  repostBaseCount: null,
  likeLocal: false,
  repostLocal: false,
  pending: null,
  error: null,
  checked: false,
}

let generation = 0
const inFlight = new Map<string, symbol>()
const preflight = new Map<string, symbol>()

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
  return count + delta
}

function rebaseCount(
  base: number | null,
  delta: number,
  count: number,
): { base: number; delta: number } {
  if (base !== null && base === count) return { base, delta }
  return { base: count, delta: 0 }
}

export const useActionStore = create<ActionState>()((set, get) => ({
  byUri: {},

  seedViewer: (states) => {
    set((state) => {
      const byUri = { ...state.byUri }
      for (const [uri, viewer] of states) {
        const current = byUri[uri]
        if (current !== undefined && current.pending !== null) continue
        const base = current ?? EMPTY_ENTRY
        byUri[uri] = {
          ...base,
          likeUri: base.likeLocal ? base.likeUri : viewer.likeUri,
          repostUri: base.repostLocal ? base.repostUri : viewer.repostUri,
          likeDelta: base.likeLocal ? base.likeDelta : 0,
          likeBaseCount: base.likeLocal ? base.likeBaseCount : null,
          repostDelta: base.repostLocal ? base.repostDelta : 0,
          repostBaseCount: base.repostLocal ? base.repostBaseCount : null,
          checked: true,
          error: null,
          pending: null,
        }
      }
      return { byUri }
    })
  },

  syncViewer: async (uris) => {
    const session = generation
    const unique = [...new Set(uris)]
    const unchecked = unique.filter(
      (uri) => get().byUri[uri]?.checked !== true && !inFlight.has(uri),
    )
    if (unchecked.length === 0) return

    const tokens = new Map<string, symbol>()
    for (const uri of unchecked) {
      tokens.set(uri, startBusy(inFlight, uri))
    }

    try {
      const states = await fetchViewerStates(unchecked)
      if (generation !== session) return
      get().seedViewer(states)
      set((state) => {
        const byUri = { ...state.byUri }
        for (const uri of unchecked) {
          const current = byUri[uri]
          if (current !== undefined && current.pending !== null) continue
          byUri[uri] = { ...(current ?? EMPTY_ENTRY), checked: true }
        }
        return { byUri }
      })
    } catch {
      // viewer state is an enhancement; writes still work without it
    } finally {
      for (const [uri, token] of tokens) endBusy(inFlight, uri, token)
    }
  },

  toggleLike: async (post) => {
    const session = generation
    const key = `like:${post.uri}`
    let current = entryFor(get(), post.uri)
    if (current.pending !== null || preflight.has(key)) return

    if (!current.checked && current.likeUri === null) {
      const token = startBusy(preflight, key)
      try {
        const states = await fetchViewerStates([post.uri])
        if (generation !== session) return
        get().seedViewer(states)
      } catch {
        // viewer state is an enhancement; the optimistic write can still proceed
      } finally {
        endBusy(preflight, key, token)
      }
      if (generation !== session) return
      current = entryFor(get(), post.uri)
      // another kind of write started while the viewer state was fetched
      if (current.pending !== null) return
      // the account already likes this post; do not create a duplicate like
      if (current.likeUri !== null) return
    }

    const likeUri = current.likeUri
    const rebased = rebaseCount(current.likeBaseCount, current.likeDelta, post.likeCount)
    set((state) => ({
      byUri: withEntry(state, post.uri, {
        pending: likeUri === null ? 'like' : 'unlike',
        error: null,
        likeBaseCount: rebased.base,
        likeDelta: rebased.delta,
      }),
    }))

    try {
      if (likeUri !== null) {
        await unlikePost(likeUri)
        if (generation !== session) return
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            likeUri: null,
            likeDelta: entryFor(state, post.uri).likeDelta - 1,
            likeLocal: true,
            pending: null,
          }),
        }))
      } else {
        const result = await likePost(post)
        if (generation !== session) return
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            likeUri: result.uri,
            likeDelta: entryFor(state, post.uri).likeDelta + 1,
            likeLocal: true,
            pending: null,
          }),
        }))
      }
    } catch (error) {
      if (generation !== session) return
      set((state) => ({
        byUri: withEntry(state, post.uri, {
          pending: null,
          error: errorInfo(error).detail,
        }),
      }))
    }
  },

  toggleRepost: async (post) => {
    const session = generation
    const key = `repost:${post.uri}`
    let current = entryFor(get(), post.uri)
    if (current.pending !== null || preflight.has(key)) return

    if (!current.checked && current.repostUri === null) {
      const token = startBusy(preflight, key)
      try {
        const states = await fetchViewerStates([post.uri])
        if (generation !== session) return
        get().seedViewer(states)
      } catch {
        // viewer state is an enhancement; the optimistic write can still proceed
      } finally {
        endBusy(preflight, key, token)
      }
      if (generation !== session) return
      current = entryFor(get(), post.uri)
      // another kind of write started while the viewer state was fetched
      if (current.pending !== null) return
      // the account already reposted this post; do not create a duplicate repost
      if (current.repostUri !== null) return
    }

    const repostUri = current.repostUri
    const rebased = rebaseCount(current.repostBaseCount, current.repostDelta, post.repostCount)
    set((state) => ({
      byUri: withEntry(state, post.uri, {
        pending: repostUri === null ? 'repost' : 'unrepost',
        error: null,
        repostBaseCount: rebased.base,
        repostDelta: rebased.delta,
      }),
    }))

    try {
      if (repostUri !== null) {
        await unrepostPost(repostUri)
        if (generation !== session) return
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            repostUri: null,
            repostDelta: entryFor(state, post.uri).repostDelta - 1,
            repostLocal: true,
            pending: null,
          }),
        }))
      } else {
        const result = await repostPost(post)
        if (generation !== session) return
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            repostUri: result.uri,
            repostDelta: entryFor(state, post.uri).repostDelta + 1,
            repostLocal: true,
            pending: null,
          }),
        }))
      }
    } catch (error) {
      if (generation !== session) return
      set((state) => ({
        byUri: withEntry(state, post.uri, {
          pending: null,
          error: errorInfo(error).detail,
        }),
      }))
    }
  },

  reset: () => {
    generation += 1
    inFlight.clear()
    preflight.clear()
    set({ byUri: {} })
  },
}))

useAuthStore.subscribe((state, previous) => {
  const signedOut = previous.status === 'authenticated' && state.status !== 'authenticated'
  const switchedAccount =
    previous.status === 'authenticated' &&
    state.status === 'authenticated' &&
    previous.account?.did !== state.account?.did
  if (signedOut || switchedAccount) useActionStore.getState().reset()
})
