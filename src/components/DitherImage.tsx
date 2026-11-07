import { useState } from 'react'

export interface DitherImageProps {
  src: string | null
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  fallback?: string
  /** declared dimensions reserve layout space before the image lands */
  width?: number | null
  height?: number | null
}

function imageSize(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value)
}

export function DitherImage({
  src,
  alt,
  className,
  loading,
  fallback,
  width,
  height,
}: DitherImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  // the caller class sizes the failed frame too: a full-size viewer image keeps
  // its viewport cap instead of collapsing to the glyph line
  const classes = ['dither-image']
  if (className !== undefined) classes.push(className)
  const declaredWidth = imageSize(width)
  const declaredHeight = imageSize(height)

  if (src === null || failedSrc === src) {
    // a decorative fallback has no name to announce
    const label =
      alt.length > 0 ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true as const }
    // a declared frame is reserved by ratio and width; the ratio alone would
    // still shrink-to-fit the glyph under the auto-width single-image rules
    const reserve =
      declaredWidth !== undefined && declaredHeight !== undefined
        ? {
            aspectRatio: `${declaredWidth} / ${declaredHeight}`,
            width: declaredWidth,
            maxWidth: '100%',
          }
        : {}
    return (
      <span className={[...classes, 'dither-image--fallback'].join(' ')} style={reserve} {...label}>
        {fallback ?? '◱'}
      </span>
    )
  }

  const imageSrc = src

  return (
    <img
      className={classes.join(' ')}
      src={imageSrc}
      alt={alt}
      {...(declaredWidth !== undefined ? { width: declaredWidth } : {})}
      {...(declaredHeight !== undefined ? { height: declaredHeight } : {})}
      loading={loading ?? 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(imageSrc)}
    />
  )
}
