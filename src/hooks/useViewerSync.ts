import { useEffect } from 'react'
import { useActionStore } from '../lib/actionStore'
import { useAuthStore } from '../lib/auth'
import type { PostModel } from '../lib/types'

/**
 * Seed like/repost viewer state for the loaded cards. The uris are keyed by a
 * newline-joined string so the effect does not rerun for every render of a
 * freshly flattened feed array.
 */
export function useViewerSync(posts: readonly PostModel[]): void {
  const status = useAuthStore((state) => state.status)
  const key = posts.map((post) => post.uri).join('\n')

  useEffect(() => {
    if (status !== 'authenticated' || key.length === 0) return
    void useActionStore.getState().syncViewer(key.split('\n'))
  }, [status, key])
}
