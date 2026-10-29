import type { ReactElement } from 'react'
import { BAYER_TILE_SIZE, buildBayerPatternDataUri } from '../lib/dither'
import { type ImageEffect, THEME_EFFECTS } from '../lib/themes'

const PATTERN_URI = buildBayerPatternDataUri()

const GRAYSCALE =
  '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0'

type Ramp = readonly [number, number, number]

interface DitherFilterProps {
  id: string
  from: Ramp
  to: Ramp
  effect: ImageEffect
}

function DitherFilter({ id, from, to, effect }: DitherFilterProps): ReactElement {
  const thresholdSource = effect === 'grunge' ? 'grungy' : 'gray'

  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={GRAYSCALE} result="gray" />
      {effect === 'grunge' ? (
        <>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="17"
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
        <DitherFilter
          id="benday-dither-void"
          from={[0.035, 0.045, 0.065]}
          to={[0.52, 0.63, 1]}
          effect={THEME_EFFECTS.void}
        />
        <DitherFilter
          id="benday-dither-bone"
          from={[0.07, 0.08, 0.1]}
          to={[0.86, 0.84, 0.78]}
          effect={THEME_EFFECTS.bone}
        />
        <DitherFilter
          id="benday-dither-oxide"
          from={[0.047, 0.031, 0.02]}
          to={[1, 0.69, 0.39]}
          effect={THEME_EFFECTS.oxide}
        />
        <DitherFilter
          id="benday-dither-phosphor"
          from={[0.016, 0.04, 0.024]}
          to={[0.45, 1, 0.63]}
          effect={THEME_EFFECTS.phosphor}
        />
        <DitherFilter
          id="benday-dither-catppuccin-mocha"
          from={[0.118, 0.118, 0.18]}
          to={[0.537, 0.706, 0.98]}
          effect={THEME_EFFECTS['catppuccin-mocha']}
        />
        <DitherFilter
          id="benday-dither-catppuccin-latte"
          from={[0.298, 0.31, 0.412]}
          to={[0.118, 0.4, 0.961]}
          effect={THEME_EFFECTS['catppuccin-latte']}
        />
        <DitherFilter
          id="benday-dither-dracula"
          from={[0.157, 0.165, 0.212]}
          to={[0.741, 0.576, 0.976]}
          effect={THEME_EFFECTS.dracula}
        />
        <DitherFilter
          id="benday-dither-atom"
          from={[0.157, 0.173, 0.204]}
          to={[0.38, 0.686, 0.937]}
          effect={THEME_EFFECTS.atom}
        />
        <DitherFilter
          id="benday-dither-github-dark"
          from={[0.051, 0.067, 0.09]}
          to={[0.345, 0.651, 1]}
          effect={THEME_EFFECTS['github-dark']}
        />
        <DitherFilter
          id="benday-dither-github-light"
          from={[0.122, 0.137, 0.157]}
          to={[0.035, 0.412, 0.855]}
          effect={THEME_EFFECTS['github-light']}
        />
        <DitherFilter
          id="benday-dither-cyberpunk"
          from={[0.043, 0.027, 0.094]}
          to={[0.133, 0.827, 0.933]}
          effect={THEME_EFFECTS.cyberpunk}
        />
        <DitherFilter
          id="benday-dither-cottagecore"
          from={[0.149, 0.125, 0.102]}
          to={[0.66, 0.71, 0.54]}
          effect={THEME_EFFECTS.cottagecore}
        />
      </defs>
    </svg>
  )
}
