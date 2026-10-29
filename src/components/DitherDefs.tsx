import type { ReactElement } from 'react'
import { buildBayerPatternDataUri } from '../lib/dither'

const PATTERN_URI = buildBayerPatternDataUri()

const GRAYSCALE =
  '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0'

type Ramp = readonly [number, number, number]

interface DitherFilterProps {
  id: string
  from: Ramp
  to: Ramp
}

function DitherFilter({ id, from, to }: DitherFilterProps): ReactElement {
  return (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={GRAYSCALE} result="gray" />
      <feImage
        href={PATTERN_URI}
        x="0"
        y="0"
        width="16"
        height="16"
        preserveAspectRatio="none"
        result="pattern"
      />
      <feTile in="pattern" result="tile" />
      <feComposite
        in="gray"
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
        <DitherFilter id="benday-dither-void" from={[0.035, 0.045, 0.065]} to={[0.52, 0.63, 1]} />
        <DitherFilter id="benday-dither-bone" from={[0.07, 0.08, 0.1]} to={[0.86, 0.84, 0.78]} />
      </defs>
    </svg>
  )
}
