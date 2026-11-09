import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoEmbed } from '../lib/types'
import { VideoPlayer } from './VideoPlayer'

const hls = vi.hoisted(() => {
  const handlers = new Map<string, (event: string, data: { fatal: boolean }) => void>()
  class FakeHls {
    static isSupported = () => true
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' }
    on = vi.fn((event: string, handler: (event: string, data: { fatal: boolean }) => void) => {
      handlers.set(event, handler)
    })
    loadSource = vi.fn()
    attachMedia = vi.fn()
    startLoad = vi.fn()
    stopLoad = vi.fn()
    destroy = vi.fn()
  }
  return { handlers, FakeHls }
})

vi.mock('hls.js', () => ({ default: hls.FakeHls }))

const video: VideoEmbed = {
  type: 'video',
  thumbnail: null,
  alt: 'test clip',
  playlist: 'https://example.test/clip.m3u8',
}

describe('VideoPlayer fatal playback', () => {
  beforeEach(() => {
    hls.handlers.clear()
  })

  it('offers a retry and a play transport after a fatal hls error', async () => {
    render(<VideoPlayer video={video} />)
    fireEvent.click(screen.getByRole('button', { name: 'play video' }))

    await waitFor(() => {
      expect(hls.handlers.get('hlsError')).toBeDefined()
    })

    const element = document.querySelector('video')
    if (element === null) throw new Error('video element missing')
    fireEvent.play(element)
    expect(screen.getByRole('button', { name: 'pause video' })).toBeInTheDocument()

    act(() => {
      hls.handlers.get('hlsError')?.('hlsError', { fatal: true })
    })

    expect(screen.getByRole('alert')).toHaveTextContent('video failed to load')
    const transport = screen.getByRole('button', { name: 'play video' })
    expect(transport).toBeDisabled()
    expect(transport).toHaveTextContent('play')
    expect(screen.queryByRole('button', { name: 'pause video' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'retry video' })).toBeInTheDocument()
  })
})

describe('VideoPlayer interrupted play', () => {
  beforeEach(() => {
    hls.handlers.clear()
  })

  it('keeps the transport usable when a play request is interrupted', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('interrupted', 'AbortError'))
    try {
      render(<VideoPlayer video={video} />)
      fireEvent.click(screen.getByRole('button', { name: 'play video' }))
      await waitFor(() => {
        expect(hls.handlers.get('hlsManifestParsed')).toBeDefined()
      })
      act(() => {
        hls.handlers.get('hlsManifestParsed')?.('hlsManifestParsed', { fatal: false })
      })

      const transport = screen.getAllByRole('button', { name: 'play video' }).at(-1)
      if (transport === undefined) throw new Error('missing play transport')
      fireEvent.click(transport)
      await act(async () => {
        await Promise.resolve()
      })

      // an interrupted request is not a source failure
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('button', { name: 'retry video' })).toBeNull()
      expect(screen.getAllByRole('button', { name: 'play video' }).at(-1)).toBeEnabled()
    } finally {
      play.mockRestore()
    }
  })
})

describe('VideoPlayer plate and unavailable states', () => {
  beforeEach(() => {
    hls.handlers.clear()
  })

  it('reuses one plate element for the poster and the paused transport', async () => {
    const { container } = render(<VideoPlayer video={video} />)

    const posterPlate = container.querySelector('.b-video-player__poster .b-video-player__plate')
    expect(posterPlate).not.toBeNull()
    expect(posterPlate?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'play video' }))
    await waitFor(() => {
      expect(hls.handlers.get('hlsManifestParsed')).toBeDefined()
    })
    act(() => {
      hls.handlers.get('hlsManifestParsed')?.('hlsManifestParsed', { fatal: false })
    })

    // the paused stage shows exactly one plate, the same node the poster used
    const pausedPlate = container.querySelector('.b-video-player__stage .b-video-player__plate')
    expect(pausedPlate).not.toBeNull()
    expect(pausedPlate?.className).toBe(posterPlate?.className)
    expect(pausedPlate?.textContent).toBe('▶')
    expect(container.querySelectorAll('.b-video-player__plate').length).toBe(1)
  })

  it('shows the error and the alt for an unavailable video without a transport', () => {
    const long = 'x'.repeat(220)
    const { container } = render(
      <VideoPlayer
        video={{ type: 'video', thumbnail: null, alt: `${long}\nsecond line`, playlist: null }}
      />,
    )

    const player = container.querySelector('.b-video-player')
    expect(player?.classList.contains('b-video-player--unavailable')).toBe(true)
    expect(screen.getByText('video unavailable')).toBeInTheDocument()
    expect(container.querySelector('.b-video-player__alt')?.textContent).toBe(
      `${long}\nsecond line`,
    )
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('.b-video-player__seek')).toBeNull()
    expect(container.querySelector('.b-video-player__plate')).toBeNull()
  })
})
