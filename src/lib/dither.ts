/**
 * Ordered-dither primitives.
 *
 * The pattern is a 16x16 SVG tile made of sixteen 4x4 cells. Each cell is
 * filled with the inverted Bayer threshold for its position, so an SVG
 * feComposite arithmetic step can compare a grayscale image against the tile
 * without canvas or an image proxy.
 */

export const BAYER_MATRIX = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const

const BAYER_VALUES: readonly number[] = BAYER_MATRIX.flat()

const BAYER_SIZE = 4
const CELL_SIZE = 4
const TILE_SIZE = 16

/** Threshold for a wrapped 4x4 Bayer coordinate, in the open interval (0, 1). */
export function bayerThreshold(x: number, y: number): number {
  const column = ((x % BAYER_SIZE) + BAYER_SIZE) % BAYER_SIZE
  const row = ((y % BAYER_SIZE) + BAYER_SIZE) % BAYER_SIZE
  const value = BAYER_VALUES[row * BAYER_SIZE + column] ?? 0
  return (value + 0.5) / TILE_SIZE
}

function cellFill(thresholdIndex: number): string {
  const level = ((1 - (thresholdIndex + 0.5) / TILE_SIZE) * 100).toFixed(3).replace(/\.?0+$/, '')
  return `rgb(${level}%, ${level}%, ${level}%)`
}

/** Deterministic 16x16 pattern tile: black ground plus sixteen 4x4 cells. */
export function buildBayerPatternSvg(): string {
  const cells: string[] = []

  for (let row = 0; row < BAYER_SIZE; row += 1) {
    for (let column = 0; column < BAYER_SIZE; column += 1) {
      const value = BAYER_MATRIX[row]?.[column] ?? 0
      const x = column * CELL_SIZE
      const y = row * CELL_SIZE
      cells.push(
        `<rect x="${x}" y="${y}" width="${CELL_SIZE}"` +
          ` height="${CELL_SIZE}" fill="${cellFill(value)}"/>`,
      )
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}"` +
    ` viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}" shape-rendering="crispEdges">` +
    `<path d="M0 0h${TILE_SIZE}v${TILE_SIZE}H0z" fill="#000"/>` +
    `${cells.join('')}</svg>`
  )
}

/** Inline data URI for the pattern tile, safe to reference from an SVG filter. */
export function buildBayerPatternDataUri(): string {
  return `data:image/svg+xml;base64,${btoa(buildBayerPatternSvg())}`
}
