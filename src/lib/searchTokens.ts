/**
 * Case-insensitive all-token substring match used by the settings and help
 * filters. Every whitespace-separated token of the query must occur somewhere
 * in the haystack; token order and adjacency do not matter. An empty query
 * matches everything. There is no fuzzy or subsequence matching: a user who
 * types `high contrast` is asking for both words, not for near misses.
 */
export function matchesSearchTokens(haystack: string, query: string): boolean {
  const hay = haystack.toLowerCase()
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return true
  return tokens.every((token) => hay.includes(token))
}
