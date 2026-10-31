import { useEffect, useRef, useState } from 'react'
import { isEditableTarget, isImeComposing } from '../hooks/useHotkeys'
import { bindingFor, characterShortcutAllowed, matchesBinding } from '../lib/keymap'
import { useSettings } from '../lib/store'
import type { EmbedModel, ImageModel, VideoEmbed } from '../lib/types'
import { DitherImage } from './DitherImage'
import { Dialog } from './ui'
import { VideoPlayer } from './VideoPlayer'

const MOVE_BINDING = bindingFor('media-move')
const ENDS_BINDING = bindingFor('media-ends')
const POSITION_BINDING = bindingFor('media-position')

export type MediaItem =
  | { kind: 'image'; src: string; alt: string; image: ImageModel }
  | { kind: 'video'; video: VideoEmbed }

export function mediaItems(embed: EmbedModel | null): MediaItem[] {
  if (embed === null) return []
  if (embed.type === 'images') {
    return embed.images
      .filter((image) => image.fullsize.length > 0 || image.thumb.length > 0)
      .map((image) => ({
        kind: 'image',
        src: image.fullsize.length > 0 ? image.fullsize : image.thumb,
        alt: image.alt,
        image,
      }))
  }
  if (embed.type === 'video') return [{ kind: 'video', video: embed }]
  if (embed.type === 'recordWithMedia') return mediaItems(embed.media)
  return []
}

export interface MediaViewerProps {
  open: boolean
  items: readonly MediaItem[]
  initialIndex?: number
  onClose: () => void
}

export function MediaViewer({ open, items, initialIndex = 0, onClose }: MediaViewerProps) {
  const maxIndex = Math.max(items.length - 1, 0)
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), maxIndex))
  // the inputs that decide the index are tracked during render, so a reopened
  // or shrunk viewer commits its resource directly instead of flashing the
  // previous index for a paint
  const lastInputsRef = useRef({ open, length: items.length, initialIndex })
  const last = lastInputsRef.current

  if (last.open !== open || last.length !== items.length || last.initialIndex !== initialIndex) {
    lastInputsRef.current = { open, length: items.length, initialIndex }
    if (open && (!last.open || last.initialIndex !== initialIndex)) {
      const reset = Math.min(Math.max(initialIndex, 0), maxIndex)
      if (reset !== index) setIndex(reset)
    } else if (index > maxIndex) {
      setIndex(maxIndex)
    }
  }

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isImeComposing(event)) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleEscape, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      // an IME owns the key that commits its composition
      if (isImeComposing(event)) return
      // a native control inside the viewer keeps its own keys: the seek range
      // owns Home/End and the arrows while it holds focus
      if (isEditableTarget(event.target)) return
      // bare gallery characters obey the shortcut preference; Escape, arrows
      // and Home/End are not characters and stay available
      if (!characterShortcutAllowed(useSettings.getState().keyboardShortcuts, event)) return

      if (matchesBinding(event, ENDS_BINDING)) {
        event.preventDefault()
        setIndex(event.key === 'Home' ? 0 : Math.max(items.length - 1, 0))
        return
      }

      if (items.length > 1 && matchesBinding(event, MOVE_BINDING)) {
        event.preventDefault()
        const direction = event.key === 'ArrowLeft' || event.key === 'k' ? -1 : 1
        setIndex((current) => (current + direction + items.length) % items.length)
        return
      }

      // digits pick a 1-based position; anything past the last item is inert
      if (!matchesBinding(event, POSITION_BINDING)) return
      const target = Number(event.key) - 1
      if (target >= items.length) return
      event.preventDefault()
      setIndex(target)
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, items.length])

  if (!open) return null
  const item = items[index]
  if (item === undefined) return null

  return (
    <Dialog open={open} title="media" onClose={onClose} className="b-media-viewer" headerClose>
      <div className="b-media-viewer__stage">
        {item.kind === 'image' ? (
          <DitherImage
            src={item.src}
            alt={item.alt.length > 0 ? item.alt : 'post image'}
            className="b-media-viewer__image"
            loading="eager"
            width={item.image.width}
            height={item.image.height}
          />
        ) : (
          <VideoPlayer video={item.video} className="b-media-viewer__video" />
        )}
      </div>
      {item.kind === 'image' && item.alt.length > 0 ? (
        <p className="b-media-viewer__alt">{item.alt}</p>
      ) : null}
      {items.length > 1 ? (
        <div className="b-media-viewer__controls">
          <button
            type="button"
            className="b-video-player__button b-media-viewer__nav"
            aria-label="previous image"
            onClick={() => {
              setIndex((current) => (current - 1 + items.length) % items.length)
            }}
          >
            ‹
          </button>
          <span className="b-media-viewer__count" aria-live="polite" aria-atomic="true">
            {index + 1} / {items.length}
            {item.kind === 'image' && item.alt.length > 0 ? (
              <span className="visually-hidden"> — {item.alt}</span>
            ) : null}
          </span>
          <button
            type="button"
            className="b-video-player__button b-media-viewer__nav"
            aria-label="next image"
            onClick={() => {
              setIndex((current) => (current + 1) % items.length)
            }}
          >
            ›
          </button>
        </div>
      ) : null}
    </Dialog>
  )
}
