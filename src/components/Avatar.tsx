import { firstGrapheme } from '../lib/graphemes'
import { DitherImage } from './DitherImage'

export interface AvatarProps {
  src: string | null
  alt: string
  /** The name the initial is taken from; empty falls back to `emptyGlyph`. */
  name: string
  emptyGlyph?: string
  /** Handles keep their own case; display names read as initials. */
  preserveCase?: boolean
}

/**
 * An avatar with a dithered initial fallback. Presentation only: the caller
 * owns the wrapper element, the accessible alt text and where the name comes
 * from. DitherImage keeps owning load failure and alt semantics.
 */
export function Avatar({ src, alt, name, emptyGlyph = '?', preserveCase = false }: AvatarProps) {
  const initial = firstGrapheme(name.trimStart())
  // uppercase can expand one cluster into many (ß → SS); keep a single glyph
  const fallback =
    initial.length === 0
      ? emptyGlyph
      : preserveCase
        ? initial
        : firstGrapheme(initial.toUpperCase())

  return <DitherImage src={src} alt={alt} fallback={fallback} />
}
