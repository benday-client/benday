/**
 * Pages without an overflowing post body (the thread card now sizes to its
 * content) still answer the page keys: scroll the nearest scrollable ancestor
 * of the thread, then the document.
 */
export function scrollThreadPage(direction: 1 | -1): boolean {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior: ScrollBehavior = reduceMotion ? 'auto' : 'smooth'
  const anchor = document.querySelector('.b-thread')
  let node = anchor instanceof HTMLElement ? anchor.parentElement : null
  while (node !== null && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      const remaining = node.scrollHeight - node.clientHeight
      const atBoundary = direction > 0 ? remaining - node.scrollTop < 1 : node.scrollTop < 1
      if (!atBoundary) {
        node.scrollBy({
          top: direction * Math.max(80, Math.floor(node.clientHeight * 0.8)),
          behavior,
        })
        return true
      }
    }
    node = node.parentElement
  }

  const scroller = document.scrollingElement
  if (scroller === null) return false
  const remaining = scroller.scrollHeight - scroller.clientHeight
  if (remaining <= 0) return false
  const atBoundary = direction > 0 ? remaining - scroller.scrollTop < 1 : scroller.scrollTop < 1
  if (atBoundary) return false
  window.scrollBy({
    top: direction * Math.max(80, Math.floor(window.innerHeight * 0.8)),
    behavior,
  })
  return true
}

export function scrollCardBody(root: ParentNode | null, direction: 1 | -1): boolean {
  const body = root?.querySelector<HTMLElement>('.b-post-card__body, .b-profile__body')
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
