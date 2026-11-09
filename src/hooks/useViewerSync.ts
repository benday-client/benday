import { useEffect, useRef } from 'react'
import { useActionStore } from '../lib/actionStore'
import { useAuthStore } from '../lib/auth'
import type { PostModel } from '../lib/types'

/**
 * Seed like/repost viewer state for the loaded cards and retire optimistic
 * counts the newest snapshot has superseded. The uris are keyed by a
 * newline-joined string so the effect does not rerun for every render of a
 * freshly flattened feed array.
 */
export function useViewerSync(posts: readonly PostModel[]): void {
  const status = useAuthStore((state) => state.status)
  const key = posts.map((post) => post.uri).join('\n')
  // retirement follows the canonical counts, so this string keys the effect
  // off count changes instead of every freshly flattened feed array
  const countsKey = posts
    .map((post) => `${post.uri}:${post.likeCount}:${post.repostCount}`)
    .join('\n')
  const latest = useRef(posts)
  latest.current = posts

  useEffect(() => {
    if (status !== 'authenticated' || key.length === 0) return
    void useActionStore.getState().syncViewer(key.split('\n'))
  }, [status, key])

  useEffect(() => {
    if (status !== 'authenticated' || countsKey.length === 0) return
    useActionStore.getState().retireCounts(latest.current)
  }, [status, countsKey])
}
