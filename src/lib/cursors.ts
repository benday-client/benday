interface CursorPalette {
  ink: string
  accent: string
  paper: string
}

function colorOf(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
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
    ink: colorOf(styles, '--ink', '#e7e4da'),
    accent: colorOf(styles, '--blue', '#7f9cff'),
    paper: colorOf(styles, '--paper', '#0d1015'),
  }

  const root = document.documentElement
  root.style.setProperty('--cursor-default', `${cursorUrl(arrow(palette))} 3 2, auto`)
  root.style.setProperty('--cursor-pointer', `${cursorUrl(crosshair(palette))} 10 10, pointer`)
  root.style.setProperty('--cursor-text', `${cursorUrl(ibeam(palette))} 10 10, text`)
}
