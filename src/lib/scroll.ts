export function scrollPostBody(root: ParentNode | null, direction: 1 | -1): boolean {
  const body = root?.querySelector<HTMLElement>('.b-post-card__body')
  if (body === null || body === undefined) return false
  const remaining = body.scrollHeight - body.clientHeight
  if (remaining <= 0) return false

  const atBoundary = direction > 0 ? remaining - body.scrollTop < 1 : body.scrollTop < 1
  if (atBoundary) return false

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  body.scrollBy({
    top: direction * Math.max(80, Math.floor(body.clientHeight * 0.8)),
    behavior: reduceMotion ? 'auto' : 'smooth',
  })
  return true
}
