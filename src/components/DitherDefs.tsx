import type { ReactElement } from 'react'
import { BAYER_TILE_SIZE, buildBayerPatternDataUri } from '../lib/dither'
import { type ImageEffect, THEME_EFFECTS, THEMES } from '../lib/themes'
import type { Theme } from '../lib/types'

const PATTERN_URI = buildBayerPatternDataUri()

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
  void: { from: [0.035, 0.045, 0.065], to: [0.52, 0.63, 1] },
  bone: { from: [0.07, 0.08, 0.1], to: [0.86, 0.84, 0.78] },
  oxide: { from: [0.047, 0.031, 0.02], to: [1, 0.69, 0.39] },
  phosphor: { from: [0.016, 0.04, 0.024], to: [0.45, 1, 0.63] },
  'catppuccin-mocha': { from: [0.118, 0.118, 0.18], to: [0.537, 0.706, 0.98] },
  'catppuccin-latte': { from: [0.298, 0.31, 0.412], to: [0.118, 0.4, 0.961] },
  dracula: { from: [0.157, 0.165, 0.212], to: [0.741, 0.576, 0.976] },
  atom: { from: [0.157, 0.173, 0.204], to: [0.38, 0.686, 0.937] },
  'github-dark': { from: [0.051, 0.067, 0.09], to: [0.345, 0.651, 1] },
  'github-light': { from: [0.122, 0.137, 0.157], to: [0.035, 0.412, 0.855] },
  cyberpunk: { from: [0.043, 0.027, 0.094], to: [0.133, 0.827, 0.933] },
  cottagecore: { from: [0.149, 0.125, 0.102], to: [0.66, 0.71, 0.54] },
  'truth-to-materials': { from: [0.08, 0.08, 0.08], to: [0.9, 0.9, 0.88] },
  bluesky: null,
  'pumpkin-ember': {
    from: [0.086, 0.043, 0.024],
    to: [1, 0.61, 0.24],
    seed: 41,
    frequency: 0.72,
  },
  'toxic-midnight': {
    from: [0.02, 0.063, 0.043],
    to: [0.43, 1, 0.56],
    seed: 7,
    frequency: 0.95,
  },
  'candy-crypt': {
    from: [0.102, 0.039, 0.118],
    to: [1, 0.48, 0.85],
    seed: 23,
    frequency: 0.61,
  },
  'dead-leaves': {
    from: [0.071, 0.059, 0.031],
    to: [0.85, 0.64, 0.25],
    seed: 59,
    frequency: 0.83,
  },
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
    effect === 'grunge' ? 'grungy' : effect === 'industrial' ? 'industrial' : 'gray'

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
      <feImage
        href={PATTERN_URI}
        x="0"
        y="0"
        width={BAYER_TILE_SIZE}
        height={BAYER_TILE_SIZE}
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
