import type { ReactElement } from 'react'
import {
  BAYER_TILE_SIZE,
  buildBayerPatternDataUri,
  buildHalftonePatternDataUri,
  HALFTONE_TILE_SIZE,
} from '../lib/dither'
import { type ImageEffect, THEME_EFFECTS } from '../lib/themes'
import type { Theme } from '../lib/types'

const THEMES = ['catppuccin-mocha', 'catppuccin-latte'] as const
const BAYER_PATTERN_URI = buildBayerPatternDataUri()
const HALFTONE_PATTERN_URI = buildHalftonePatternDataUri()

const GRAYSCALE =
  '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0'

type Ramp = readonly [number, number, number]
type DitherEffect = Exclude<ImageEffect, 'none'>

interface DitherSpec {
  from: Ramp
  to: Ramp
  seed?: number
  frequency?: number
}

interface DitherFilterProps extends DitherSpec {
  id: string
  effect: DitherEffect
}

/** Themes without a filter (effect `none`) keep a null spec: images stay honest. */
const DITHER_SPECS: Record<Theme, DitherSpec | null> = {
  'catppuccin-mocha': { from: [0.118, 0.118, 0.18], to: [0.537, 0.706, 0.98] },
  'catppuccin-latte': { from: [0.298, 0.31, 0.412], to: [0.118, 0.4, 0.961] },
}

function DitherFilter({
  id,
  from,
  to,
  effect,
  seed = 17,
  frequency = 0.9,
}: DitherFilterProps): ReactElement {
  const thresholdSource =
    effect === 'grunge'
      ? 'grungy'
      : effect === 'industrial'
        ? 'industrial'
        : effect === 'halftone'
          ? 'tooth'
          : 'gray'

  // the halftone theme swaps the dispersed Bayer tile for a clustered dot and
  // opens the compare to the whole range: the old 0.85/-0.425 pair crushed both
  // ends of the image into ink or paper
  const screen =
    effect === 'halftone'
      ? { uri: HALFTONE_PATTERN_URI, size: HALFTONE_TILE_SIZE, k3: '1', k4: '-0.5' }
      : { uri: BAYER_PATTERN_URI, size: BAYER_TILE_SIZE, k3: '0.85', k4: '-0.425' }

  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={GRAYSCALE} result="gray" />
      {effect === 'grunge' ? (
        <>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={frequency}
            numOctaves="2"
            seed={seed}
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
        </>
      ) : null}
      {effect === 'industrial' ? (
        <feComponentTransfer in="gray" result="industrial">
          <feFuncR type="linear" slope="1.8" intercept="-0.35" />
          <feFuncG type="linear" slope="1.8" intercept="-0.35" />
          <feFuncB type="linear" slope="1.8" intercept="-0.35" />
        </feComponentTransfer>
      ) : null}
      {effect === 'halftone' ? (
        <>
          {/* low-frequency tooth, not per-pixel static: uneven ink coverage on
              laid paper is broad blotches, so the screen keeps its dot shapes */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency={frequency}
            numOctaves="1"
            seed={seed}
            result="tooth-noise"
          />
          <feColorMatrix in="tooth-noise" type="saturate" values="0" result="tooth-gray" />
          <feComposite
            in="gray"
            in2="tooth-gray"
            operator="arithmetic"
            k1="0"
            k2="1"
            k3="0.08"
            k4="-0.04"
            result="tooth"
          />
        </>
      ) : null}
      <feImage
        href={screen.uri}
        x="0"
        y="0"
        width={screen.size}
        height={screen.size}
        preserveAspectRatio="none"
        result="pattern"
      />
      <feTile in="pattern" result="tile" />
      <feComposite
        in={thresholdSource}
        in2="tile"
        operator="arithmetic"
        k1="0"
        k2="1"
        k3={screen.k3}
        k4={screen.k4}
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
        {THEMES.flatMap((theme) => {
          const effect = THEME_EFFECTS[theme]
          const spec = DITHER_SPECS[theme]
          if (effect === 'none' || spec === null) return []
          return [
            <DitherFilter key={theme} id={`benday-dither-${theme}`} effect={effect} {...spec} />,
          ]
        })}
      </defs>
    </svg>
  )
}
