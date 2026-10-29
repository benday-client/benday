import { useState } from 'react'

export interface DitherImageProps {
  src: string | null
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  fallback?: string
}

export function DitherImage({ src, alt, className, loading, fallback }: DitherImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src === null || failedSrc === src) {
    return (
      <span className="dither-image dither-image--fallback" role="img" aria-label={alt}>
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
      src={imageSrc}
      alt={alt}
      loading={loading ?? 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(imageSrc)}
    />
  )
}
