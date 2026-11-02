/**
 * A parsed or persisted JSON object. Arrays are excluded: every boundary that
 * guards with this predicate stores keyed records, so an array is never a valid
 * value there. Field validation stays with each caller.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
