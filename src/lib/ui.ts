import { create } from 'zustand'
import type { PostModel } from './types'

export type DialogKind = 'palette' | 'help' | 'login' | 'account' | 'feed-add' | 'settings' | null

export type ComposeMode = 'post' | 'reply' | 'quote'

export interface ComposeRequest {
  mode: ComposeMode
  post: PostModel | null
}

interface UiState {
  dialog: DialogKind
  compose: ComposeRequest | null
  inlineCompose: ComposeRequest | null
  openingPost: PostModel | null
  openPost: (post: PostModel) => void
  openDialog: (dialog: Exclude<DialogKind, null>) => void
  closeDialog: () => void
  openCompose: (request: ComposeRequest) => void
  closeCompose: () => void
  openInlineCompose: (request: ComposeRequest) => void
  closeInlineCompose: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  dialog: null,
  compose: null,
  inlineCompose: null,
  openingPost: null,
  openPost: (post) => set({ openingPost: post }),
  openDialog: (dialog) => set({ dialog, compose: null, inlineCompose: null }),
  closeDialog: () => set({ dialog: null }),
  openCompose: (request) => set({ compose: request, inlineCompose: null, dialog: null }),
  closeCompose: () => set({ compose: null }),
  openInlineCompose: (request) => set({ inlineCompose: request, compose: null, dialog: null }),
  closeInlineCompose: () => set({ inlineCompose: null }),
}))

/**
 * A store-backed dialog or composer owns the keyboard while it is open. Global
 * key layers ask this inside their handler, because an effect that unmounts
 * the layer can lag a frame behind the store.
 */
export function uiOwnsKeyboard(): boolean {
  const state = useUiStore.getState()
  return state.dialog !== null || state.compose !== null || state.inlineCompose !== null
}
