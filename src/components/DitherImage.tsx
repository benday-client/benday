import { useState } from 'react'
import { useSettings } from '../lib/store'
import { THEME_EFFECTS } from '../lib/themes'

export interface DitherImageProps {
  src: string | null
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  fallback?: string
}

export function DitherImage({ src, alt, className, loading, fallback }: DitherImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const theme = useSettings((state) => state.theme)
  const imageEffects = useSettings((state) => state.imageEffects)
  const effect = imageEffects ? THEME_EFFECTS[theme] : 'none'

  if (src === null || failedSrc === src) {
    return (
      <span
        className="dither-image dither-image--fallback"
        data-effect={effect}
        role="img"
        aria-label={alt}
      >
        {fallback ?? '◱'}
      </span>
    )
  }

  const imageSrc = src
  const classes = ['dither-image']
  if (className !== undefined) classes.push(className)

  return (
    <img
      className={classes.join(' ')}
      data-effect={effect}
      src={imageSrc}
      alt={alt}
      loading={loading ?? 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(imageSrc)}
    />
  )
}
