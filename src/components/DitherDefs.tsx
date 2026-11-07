import type { ReactElement } from 'react'
import { BAYER_TILE_SIZE, buildBayerPatternDataUri } from '../lib/dither'
import type { Theme } from '../lib/types'

const THEMES = ['catppuccin-mocha', 'catppuccin-latte'] as const
const BAYER_PATTERN_URI = buildBayerPatternDataUri()

const GRAYSCALE =
  '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0'

type Ramp = readonly [number, number, number]

interface DitherSpec {
  from: Ramp
  to: Ramp
}

const DITHER_SPECS: Record<Theme, DitherSpec> = {
  'catppuccin-mocha': { from: [0.118, 0.118, 0.18], to: [0.537, 0.706, 0.98] },
  'catppuccin-latte': { from: [0.298, 0.31, 0.412], to: [0.118, 0.4, 0.961] },
}

// the one dither: a grungy Bayer screen painted from each palette's duotone
const GRUNGE_SEED = 17
const GRUNGE_FREQUENCY = 0.9

function DitherFilter({ id, from, to }: DitherSpec & { id: string }): ReactElement {
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={GRAYSCALE} result="gray" />
      <feTurbulence
        type="fractalNoise"
        baseFrequency={GRUNGE_FREQUENCY}
        numOctaves="2"
        seed={GRUNGE_SEED}
        result="noise"
      />
      <feColorMatrix in="noise" type="saturate" values="0" result="noise-gray" />
      <feComposite
        in="gray"
        in2="noise-gray"
        operator="arithmetic"
        k1="0"
        k2="1"
        k3="0.2"
        k4="-0.1"
        result="grungy"
      />
      <feImage
        href={BAYER_PATTERN_URI}
        x="0"
        y="0"
        width={BAYER_TILE_SIZE}
        height={BAYER_TILE_SIZE}
        preserveAspectRatio="none"
        result="pattern"
      />
      <feTile in="pattern" result="tile" />
      <feComposite
        in="grungy"
        in2="tile"
        operator="arithmetic"
        k1="0"
        k2="1"
        k3="0.85"
        k4="-0.425"
        result="mixed"
      />
      <feComponentTransfer in="mixed" result="binary">
        <feFuncR type="discrete" tableValues="0 1" />
        <feFuncG type="discrete" tableValues="0 1" />
        <feFuncB type="discrete" tableValues="0 1" />
      </feComponentTransfer>
      <feComponentTransfer in="binary">
        <feFuncR type="table" tableValues={`${from[0]} ${to[0]}`} />
        <feFuncG type="table" tableValues={`${from[1]} ${to[1]}`} />
        <feFuncB type="table" tableValues={`${from[2]} ${to[2]}`} />
      </feComponentTransfer>
    </filter>
  )
}

export function DitherDefs(): ReactElement {
  return (
    <svg width="0" height="0" aria-hidden="true" className="dither-defs">
      <defs>
        {THEMES.map((theme) => (
          <DitherFilter key={theme} id={`benday-dither-${theme}`} {...DITHER_SPECS[theme]} />
        ))}
      </defs>
    </svg>
  )
}
