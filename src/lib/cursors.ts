interface CursorPalette {
  ink: string
  accent: string
  paper: string
}

const FALLBACK: CursorPalette = {
  ink: '#e7e4da',
  accent: '#7f9cff',
  paper: '#0d1015',
}

const PROBE_STYLE =
  'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none'

/**
 * A token value may be a literal color or a function that only a real element
 * can resolve (`light-dark()`, `var()` chains). Cursor assets are SVG strings,
 * so anything unresolved would be embedded verbatim and render as nothing:
 * resolve those through one throwaway child that inherits the root
 * color-scheme, and fall back when the result is not a color.
 */
function resolveColor(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim()
  if (value.length === 0) return fallback
  if (!value.includes('light-dark(') && !value.includes('var(')) return value

  const holder = document.createElement('span')
  holder.setAttribute('aria-hidden', 'true')
  holder.setAttribute('style', `${PROBE_STYLE};color:rgb(1,2,3)`)
  const probe = document.createElement('span')
  probe.setAttribute('style', `color:var(${name})`)
  holder.appendChild(probe)
  document.body.appendChild(holder)
  try {
    const resolved = getComputedStyle(probe).color
    // An unresolved token computes as `unset`, which inherits the holder's
    // sentinel instead of producing a color of its own.
    if (resolved === '' || resolved === 'rgb(1, 2, 3)') return fallback
    return resolved
  } finally {
    holder.remove()
  }
}

function cursorUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function arrow(palette: CursorPalette): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" shape-rendering="crispEdges"><path d="M3 2 L3 16 L7 12 L10 19 L13 18 L10 11 L16 11 Z" fill="${palette.accent}" stroke="${palette.ink}" stroke-width="1.5" stroke-linejoin="miter"/></svg>`
}

function crosshair(palette: CursorPalette): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" shape-rendering="crispEdges"><path d="M10 2v5M10 13v5M2 10h5M13 10h5" stroke="${palette.accent}" stroke-width="2"/><rect x="8" y="8" width="4" height="4" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="1"/></svg>`
}

function ibeam(palette: CursorPalette): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" shape-rendering="crispEdges"><path d="M6 3h8M10 3v14M6 17h8" stroke="${palette.accent}" stroke-width="2"/><path d="M10 5v10" stroke="${palette.ink}" stroke-width="1"/></svg>`
}

export function installCursors(): void {
  const styles = getComputedStyle(document.documentElement)
  const palette: CursorPalette = {
    ink: resolveColor(styles, '--ink', FALLBACK.ink),
    accent: resolveColor(styles, '--blue', FALLBACK.accent),
    paper: resolveColor(styles, '--paper', FALLBACK.paper),
  }

  const root = document.documentElement
  root.style.setProperty('--cursor-default', `${cursorUrl(arrow(palette))} 3 2, auto`)
  root.style.setProperty('--cursor-pointer', `${cursorUrl(crosshair(palette))} 10 10, pointer`)
  root.style.setProperty('--cursor-text', `${cursorUrl(ibeam(palette))} 10 10, text`)
}
