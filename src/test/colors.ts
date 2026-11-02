export interface SrgbColor {
  r: number
  g: number
  b: number
  /** 0..1, as the browser paints it */
  a: number
}

let context: CanvasRenderingContext2D | null = null

function sharedContext(): CanvasRenderingContext2D {
  if (context === null) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const created = canvas.getContext('2d', { willReadFrequently: true })
    if (created === null) throw new Error('a 2d canvas is required to resolve css colours')
    context = created
  }
  return context
}

/**
 * Resolves any CSS colour the browser supports — legacy rgb/hex, modern
 * oklch/lab, `color(srgb …)`, alpha included — to the 8-bit sRGB pixels it
 * actually paints, by filling one reused 1×1 canvas and reading it back.
 * Unsupported values throw instead of silently falling back.
 */
export function resolveSrgbColor(input: string): SrgbColor {
  if (!CSS.supports('color', input)) throw new Error(`unsupported css colour: ${input}`)
  const ctx = sharedContext()
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = input
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: (a ?? 0) / 255 }
}
