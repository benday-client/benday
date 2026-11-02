import type { PostModel } from './types'

function profileWebUrl(handle: string): string {
  return `https://bsky.app/profile/${encodeURIComponent(handle)}`
}

export function postWebUrl(post: Pick<PostModel, 'uri' | 'author'>): string {
  const handle = post.author.handle
  const path = post.uri.split(/[?#]/)[0] ?? ''
  const rkey = path.split('/').at(-1) ?? ''
  if (rkey.length === 0) return profileWebUrl(handle)
  return `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`
}
