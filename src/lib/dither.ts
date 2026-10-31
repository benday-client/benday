/**
 * Ordered-dither primitives.
 *
 * The pattern is a 16x16 SVG tile made of sixty-four 2x2 cells. Each cell is
 * filled with the inverted Bayer threshold for its position, so an SVG
 * feComposite arithmetic step can compare a grayscale image against the tile
 * without canvas or an image proxy.
 */

export const BAYER_MATRIX = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
] as const

const BAYER_VALUES: readonly number[] = BAYER_MATRIX.flat()

const BAYER_SIZE = 8
const CELL_SIZE = 2
const LEVELS = BAYER_SIZE * BAYER_SIZE
export const BAYER_TILE_SIZE = BAYER_SIZE * CELL_SIZE

/** Threshold for a wrapped 8x8 Bayer coordinate, in the open interval (0, 1). */
export function bayerThreshold(x: number, y: number): number {
  const column = ((x % BAYER_SIZE) + BAYER_SIZE) % BAYER_SIZE
  const row = ((y % BAYER_SIZE) + BAYER_SIZE) % BAYER_SIZE
  const value = BAYER_VALUES[row * BAYER_SIZE + column] ?? 0
  return (value + 0.5) / LEVELS
}

/**
 * Tile fill for a threshold in the open interval (0, 1). The filter inverts
 * this fill and compares the image against it, so a cell whose threshold is
 * `t` turns to the light end of the ramp once the image value reaches `t`.
 */
function thresholdFill(threshold: number): string {
  const level = ((1 - threshold) * 100).toFixed(3).replace(/\.?0+$/, '')
  return `rgb(${level}%, ${level}%, ${level}%)`
}

/** Deterministic 16x16 pattern tile: black ground plus sixty-four 2x2 cells. */
export function buildBayerPatternSvg(): string {
  const cells: string[] = []

  for (let row = 0; row < BAYER_SIZE; row += 1) {
    for (let column = 0; column < BAYER_SIZE; column += 1) {
      const value = BAYER_MATRIX[row]?.[column] ?? 0
      const x = column * CELL_SIZE
      const y = row * CELL_SIZE
      cells.push(
        `<rect x="${x}" y="${y}" width="${CELL_SIZE}"` +
          ` height="${CELL_SIZE}" fill="${thresholdFill((value + 0.5) / LEVELS)}"/>`,
      )
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAYER_TILE_SIZE}"` +
    ` height="${BAYER_TILE_SIZE}" viewBox="0 0 ${BAYER_TILE_SIZE} ${BAYER_TILE_SIZE}"` +
    ` shape-rendering="crispEdges">` +
    `<path d="M0 0h${BAYER_TILE_SIZE}v${BAYER_TILE_SIZE}H0z" fill="#000"/>` +
    `${cells.join('')}</svg>`
  )
}

/** Inline data URI for the pattern tile, safe to reference from an SVG filter. */
export function buildBayerPatternDataUri(): string {
  return `data:image/svg+xml;base64,${btoa(buildBayerPatternSvg())}`
}

/* clustered-dot (am) screen ------------------------------------------- */

const HALFTONE_SIZE = 16
const HALFTONE_CENTRES = [
  [4, 4],
  [12, 12],
] as const
export const HALFTONE_TILE_SIZE = HALFTONE_SIZE

/**
 * Thresholds for the wrapped 16x16 clustered-dot tile. Cells are ordered by
 * distance to the nearest dot centre and bucketed into sixty-four levels: the
 * nearest band is ink first, so a dot grows outward from its centre as the
 * image darkens, and coverage stays proportional to tone. The two centres sit
 * eight pixels apart on the diagonal, so the tiled screen is a 45 degree
 * lattice instead of a square door.
 */
const HALFTONE_LEVELS = 64

function buildHalftoneThresholds(): number[] {
  const cells: { index: number; distance: number }[] = []

  for (let y = 0; y < HALFTONE_SIZE; y += 1) {
    for (let x = 0; x < HALFTONE_SIZE; x += 1) {
      let distance = Number.POSITIVE_INFINITY
      for (const [centreX, centreY] of HALFTONE_CENTRES) {
        const dx = Math.abs(x + 0.5 - centreX)
        const dy = Math.abs(y + 0.5 - centreY)
        distance = Math.min(
          distance,
          Math.hypot(Math.min(dx, HALFTONE_SIZE - dx), Math.min(dy, HALFTONE_SIZE - dy)),
        )
      }
      cells.push({ index: y * HALFTONE_SIZE + x, distance })
    }
  }

  // distance first, index second: equal radii keep a stable order, so the
  // pattern is deterministic and every dot grows symmetrically enough at 1px
  cells.sort((a, b) => a.distance - b.distance || a.index - b.index)

  const thresholds = new Array<number>(cells.length).fill(0)
  cells.forEach((cell, rank) => {
    const level = Math.floor((rank * HALFTONE_LEVELS) / cells.length)
    thresholds[cell.index] = 1 - (level + 0.5) / HALFTONE_LEVELS
  })
  return thresholds
}

const HALFTONE_THRESHOLDS = buildHalftoneThresholds()

/** Clustered-dot threshold for a wrapped halftone cell, in the open unit interval. */
export function halftoneThreshold(x: number, y: number): number {
  const column = ((x % HALFTONE_SIZE) + HALFTONE_SIZE) % HALFTONE_SIZE
  const row = ((y % HALFTONE_SIZE) + HALFTONE_SIZE) % HALFTONE_SIZE
  return HALFTONE_THRESHOLDS[row * HALFTONE_SIZE + column] ?? 0
}

/** Deterministic 16x16 clustered-dot tile: one-pixel cells, dots at the centres. */
export function buildHalftonePatternSvg(): string {
  const shapes = new Map<string, string[]>()

  for (let y = 0; y < HALFTONE_SIZE; y += 1) {
    for (let x = 0; x < HALFTONE_SIZE; x += 1) {
      const fill = thresholdFill(halftoneThreshold(x, y))
      const paths = shapes.get(fill)
      if (paths === undefined) shapes.set(fill, [`M${x} ${y}h1v1h-1z`])
      else paths.push(`M${x} ${y}h1v1h-1z`)
    }
  }

  const cells = [...shapes].map(([fill, paths]) => `<path fill="${fill}" d="${paths.join('')}"/>`)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${HALFTONE_TILE_SIZE}"` +
    ` height="${HALFTONE_TILE_SIZE}" viewBox="0 0 ${HALFTONE_TILE_SIZE} ${HALFTONE_TILE_SIZE}"` +
    ` shape-rendering="crispEdges">` +
    `${cells.join('')}</svg>`
  )
}

/** Inline data URI for the clustered-dot tile, safe to reference from an SVG filter. */
export function buildHalftonePatternDataUri(): string {
  return `data:image/svg+xml;base64,${btoa(buildHalftonePatternSvg())}`
}
