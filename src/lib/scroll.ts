export function scrollPostBody(root: ParentNode | null, direction: 1 | -1): boolean {
  const body = root?.querySelector<HTMLElement>('.b-post-card__body')
  if (body === null || body === undefined) return false
  if (body.scrollHeight <= body.clientHeight) return false

  body.scrollBy({
    top: direction * Math.max(80, Math.floor(body.clientHeight * 0.8)),
    behavior: 'smooth',
  })
  return true
}
