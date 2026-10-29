export type ParsedCommand = { type: 'navigate'; href: string; label: string } | null

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  if (trimmed.startsWith('@') && trimmed.length > 1) {
    const handle = trimmed.slice(1).trim()
    if (handle.length > 0) {
      return {
        type: 'navigate',
        href: `/profile/${encodeURIComponent(handle)}`,
        label: `profile @${handle}`,
      }
    }
  }

  if (trimmed.startsWith('at://')) {
    if (trimmed.includes('/app.bsky.feed.generator/')) {
      return {
        type: 'navigate',
        href: `/feed?uri=${encodeURIComponent(trimmed)}`,
        label: 'feed',
      }
    }

    return {
      type: 'navigate',
      href: `/thread?uri=${encodeURIComponent(trimmed)}`,
      label: 'thread',
    }
  }

  const text = trimmed.startsWith('#') && trimmed.length > 1 ? trimmed.slice(1) : trimmed

  return {
    type: 'navigate',
    href: `/search?q=${encodeURIComponent(text)}`,
    label: `search “${text}”`,
  }
}
