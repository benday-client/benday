import { create } from 'zustand'
import type { PostModel } from './types'

export type DialogKind =
  | 'palette'
  | 'appview'
  | 'help'
  | 'login'
  | 'account'
  | 'feed-add'
  | 'settings'
  | null

export type ComposeMode = 'post' | 'reply' | 'quote'

export interface ComposeRequest {
  mode: ComposeMode
  post: PostModel | null
}

interface UiState {
  dialog: DialogKind
  compose: ComposeRequest | null
  openingPost: PostModel | null
  openPost: (post: PostModel) => void
  openDialog: (dialog: Exclude<DialogKind, null>) => void
  closeDialog: () => void
  openCompose: (request: ComposeRequest) => void
  closeCompose: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  dialog: null,
  compose: null,
  openingPost: null,
  openPost: (post) => set({ openingPost: post }),
  openDialog: (dialog) => set({ dialog, compose: null }),
  closeDialog: () => set({ dialog: null }),
  openCompose: (request) => set({ compose: request, dialog: null }),
  closeCompose: () => set({ compose: null }),
}))
