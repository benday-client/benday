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
  themeMenuOpen: boolean
  openPost: (post: PostModel) => void
  openDialog: (dialog: Exclude<DialogKind, null>) => void
  closeDialog: () => void
  openCompose: (request: ComposeRequest) => void
  closeCompose: () => void
  toggleThemeMenu: () => void
  closeThemeMenu: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  dialog: null,
  compose: null,
  openingPost: null,
  themeMenuOpen: false,
  openPost: (post) => set({ openingPost: post }),
  openDialog: (dialog) => set({ dialog, compose: null, themeMenuOpen: false }),
  closeDialog: () => set({ dialog: null }),
  openCompose: (request) => set({ compose: request, dialog: null, themeMenuOpen: false }),
  closeCompose: () => set({ compose: null }),
  toggleThemeMenu: () => set((state) => ({ themeMenuOpen: !state.themeMenuOpen })),
  closeThemeMenu: () => set({ themeMenuOpen: false }),
}))
