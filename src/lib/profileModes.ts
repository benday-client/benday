export type ProfileMode = 'profile' | 'posts' | 'replies' | 'media'

export type ProfileContentMode = Exclude<ProfileMode, 'profile'>

export interface ProfileModeOption {
  mode: ProfileMode
  name: string
  description: string
}

export const PROFILE_MODES: readonly ProfileModeOption[] = [
  {
    mode: 'profile',
    name: 'profile',
    description: 'the identity card',
  },
  {
    mode: 'posts',
    name: 'posts',
    description: 'standalone posts by this account',
  },
  {
    mode: 'replies',
    name: 'replies',
    description: 'replies this account has written',
  },
  {
    mode: 'media',
    name: 'media',
    description: "this account's own images and video",
  },
]

export function profileModeName(mode: ProfileMode): string {
  return PROFILE_MODES.find((option) => option.mode === mode)?.name ?? mode
}

export function cardCountLabel(count: number): string {
  return count === 1 ? '1 card' : `${count} cards`
}
