import { useEffect, useState } from 'react'
import type { EmbedModel, ImageModel, MediaEmbed, VideoEmbed } from '../lib/types'
import { DitherImage } from './DitherImage'
import { Dialog } from './ui'
import { VideoPlayer } from './VideoPlayer'

export type MediaItem =
  | { kind: 'image'; src: string; alt: string; image: ImageModel }
  | { kind: 'video'; video: VideoEmbed }

function itemsFromMedia(media: MediaEmbed): MediaItem[] {
  if (media.type === 'images') {
    return media.images
      .filter((image) => image.fullsize.length > 0 || image.thumb.length > 0)
      .map((image) => ({
        kind: 'image',
        src: image.fullsize.length > 0 ? image.fullsize : image.thumb,
        alt: image.alt,
        image,
      }))
  }
  if (media.type === 'video') return [{ kind: 'video', video: media }]
  return []
}

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
  if (embed.type === 'recordWithMedia') return itemsFromMedia(embed.media)
  return []
}

export interface MediaViewerProps {
  open: boolean
  items: readonly MediaItem[]
  initialIndex?: number
  onClose: () => void
}

export function MediaViewer({ open, items, initialIndex = 0, onClose }: MediaViewerProps) {
  const [index, setIndex] = useState(initialIndex)

  useEffect(() => {
    if (open) setIndex(Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0)))
  }, [open, initialIndex, items.length])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleEscape, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || items.length < 2) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
        return
      }
      event.preventDefault()
      setIndex((current) => {
        const direction = event.key === 'ArrowLeft' ? -1 : 1
        return (current + direction + items.length) % items.length
      })
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
            className="b-video-player__button"
            onClick={() => {
              setIndex((current) => (current - 1 + items.length) % items.length)
            }}
          >
            prev
          </button>
          <span className="b-media-viewer__count">
            {index + 1} / {items.length}
          </span>
          <button
            type="button"
            className="b-video-player__button"
            onClick={() => {
              setIndex((current) => (current + 1) % items.length)
            }}
          >
            next
          </button>
        </div>
      ) : null}
    </Dialog>
  )
}
