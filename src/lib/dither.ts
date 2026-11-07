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

const BAYER_SIZE = 8
const CELL_SIZE = 2
const LEVELS = BAYER_SIZE * BAYER_SIZE
export const BAYER_TILE_SIZE = BAYER_SIZE * CELL_SIZE

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
