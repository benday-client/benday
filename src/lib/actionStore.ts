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
  pending: null,
  error: null,
  checked: false,
}

const inFlight = new Set<string>()

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

export const useActionStore = create<ActionState>()((set, get) => ({
  byUri: {},

  seedViewer: (states) => {
    set((state) => {
      const byUri = { ...state.byUri }
      for (const [uri, viewer] of states) {
        const current = byUri[uri]
        if (current !== undefined && current.pending !== null) continue
        byUri[uri] = {
          ...(current ?? EMPTY_ENTRY),
          likeUri: viewer.likeUri,
          repostUri: viewer.repostUri,
          likeDelta: 0,
          repostDelta: 0,
          checked: true,
          error: null,
          pending: null,
        }
      }
      return { byUri }
    })
  },

  syncViewer: async (uris) => {
    const unique = [...new Set(uris)]
    const unchecked = unique.filter(
      (uri) => get().byUri[uri]?.checked !== true && !inFlight.has(uri),
    )
    if (unchecked.length === 0) return

    for (const uri of unchecked) inFlight.add(uri)
    try {
      const states = await fetchViewerStates(unchecked)
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
      for (const uri of unchecked) inFlight.delete(uri)
    }
  },

  toggleLike: async (post) => {
    const current = entryFor(get(), post.uri)
    if (current.pending !== null) return
    const wasLiked = current.likeUri !== null
    set((state) => ({
      byUri: withEntry(state, post.uri, {
        pending: wasLiked ? 'unlike' : 'like',
        error: null,
      }),
    }))

    try {
      if (wasLiked) {
        const likeUri = current.likeUri
        if (likeUri === null) return
        await unlikePost(likeUri)
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            likeUri: null,
            likeDelta: entryFor(state, post.uri).likeDelta - 1,
            pending: null,
          }),
        }))
      } else {
        const result = await likePost(post)
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            likeUri: result.uri,
            likeDelta: entryFor(state, post.uri).likeDelta + 1,
            pending: null,
          }),
        }))
      }
    } catch (error) {
      set((state) => ({
        byUri: withEntry(state, post.uri, {
          pending: null,
          error: errorInfo(error).detail,
        }),
      }))
    }
  },

  toggleRepost: async (post) => {
    const current = entryFor(get(), post.uri)
    if (current.pending !== null) return
    const wasReposted = current.repostUri !== null
    set((state) => ({
      byUri: withEntry(state, post.uri, {
        pending: wasReposted ? 'unrepost' : 'repost',
        error: null,
      }),
    }))

    try {
      if (wasReposted) {
        const repostUri = current.repostUri
        if (repostUri === null) return
        await unrepostPost(repostUri)
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            repostUri: null,
            repostDelta: entryFor(state, post.uri).repostDelta - 1,
            pending: null,
          }),
        }))
      } else {
        const result = await repostPost(post)
        set((state) => ({
          byUri: withEntry(state, post.uri, {
            repostUri: result.uri,
            repostDelta: entryFor(state, post.uri).repostDelta + 1,
            pending: null,
          }),
        }))
      }
    } catch (error) {
      set((state) => ({
        byUri: withEntry(state, post.uri, {
          pending: null,
          error: errorInfo(error).detail,
        }),
      }))
    }
  },

  reset: () => set({ byUri: {} }),
}))

useAuthStore.subscribe((state, previous) => {
  if (previous.status === 'authenticated' && state.status !== 'authenticated') {
    useActionStore.getState().reset()
  }
})
