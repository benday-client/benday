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

// a serialization an SVG presentation attribute can carry unchanged
const SVG_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i

/**
 * Paints one pixel and reads it back. A computed modern colour (`oklch(…)`,
 * `color(srgb …)`) is not a string an SVG attribute can use, so the browser's
 * own conversion produces the sRGB channels, alpha included.
 */
function canvasColor(
  computed: string,
  painter: () => CanvasRenderingContext2D | null,
): string | null {
  const context = painter()
  if (context === null) return null
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = computed
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  if (r === undefined || g === undefined || b === undefined || a === undefined) return null
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
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
  // one holder in the real theme context; each read gets a fresh child because
  // Chromium can hand back the previous computed colour when the same element's
  // inline color is rewritten within one task
  const holder = document.createElement('span')
  holder.setAttribute('aria-hidden', 'true')
  holder.setAttribute('style', `${PROBE_STYLE};color:rgb(1,2,3)`)
  document.body.appendChild(holder)

  // at most one canvas per installation, and only when a colour actually needs
  // the browser's conversion; a jsdom run without canvas keeps the fallbacks
  let painter: CanvasRenderingContext2D | null | undefined
  const context = (): CanvasRenderingContext2D | null => {
    if (painter !== undefined) return painter
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      painter = canvas.getContext('2d', { willReadFrequently: true })
    } catch {
      painter = null
    }
    return painter
  }

  const svgColor = (computed: string, fallback: string): string => {
    const value = computed.trim()
    if (value.length === 0) return fallback
    if (SVG_COLOR.test(value)) return value
    return canvasColor(value, context) ?? fallback
  }

  // every token is read through the same probe: a var() chain, light-dark() or
  // a literal all resolve in the real theme context, then become one concrete
  // colour an SVG attribute can carry
  const readToken = (name: string, fallback: string): string => {
    const probe = document.createElement('span')
    probe.setAttribute('style', `color:var(${name})`)
    holder.appendChild(probe)
    try {
      const computed = getComputedStyle(probe).color
      // an unresolved token inherits the holder's sentinel instead of a colour
      if (computed === '' || computed === 'rgb(1, 2, 3)') return fallback
      return svgColor(computed, fallback)
    } finally {
      probe.remove()
    }
  }

  try {
    const palette: CursorPalette = {
      ink: readToken('--ink', FALLBACK.ink),
      accent: readToken('--blue', FALLBACK.accent),
      paper: readToken('--paper', FALLBACK.paper),
    }

    const root = document.documentElement
    root.style.setProperty('--cursor-default', `${cursorUrl(arrow(palette))} 3 2, auto`)
    root.style.setProperty('--cursor-pointer', `${cursorUrl(crosshair(palette))} 10 10, pointer`)
    root.style.setProperty('--cursor-text', `${cursorUrl(ibeam(palette))} 10 10, text`)
  } finally {
    holder.remove()
  }
}
