export type SearchMode = 'posts' | 'feeds' | 'users'

export interface SearchModeOption {
  mode: SearchMode
  name: string
  description: string
}

export const SEARCH_MODES: readonly SearchModeOption[] = [
  {
    mode: 'posts',
    name: 'posts',
    description: 'posts whose text or author matches the query',
  },
  {
    mode: 'feeds',
    name: 'feeds',
    description: 'feed generators matching the query',
  },
  {
    mode: 'users',
    name: 'users',
    description: 'accounts whose handle or name matches the query',
  },
]

export function searchModeName(mode: SearchMode): string {
  return SEARCH_MODES.find((option) => option.mode === mode)?.name ?? mode
}

export function resultCountLabel(count: number | null): string {
  if (count === null) return 'no count yet'
  return count === 1 ? '1 result' : `${count} results`
}
