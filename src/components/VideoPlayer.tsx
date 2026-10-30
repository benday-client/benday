import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import type { VideoEmbed } from '../lib/types'
import { DitherImage } from './DitherImage'

export interface VideoPlayerProps {
  video: VideoEmbed
  className?: string
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function VideoPlayer({ video, className }: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState(false)
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    setActivated(false)
  }, [video.playlist])

  useEffect(() => {
    if (!activated) return
    const element = ref.current
    if (video.playlist === null || element === null) return
    if (!Hls.isSupported()) {
      if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = video.playlist
      return
    }
    const hls = new Hls({ autoStartLoad: false })
    hls.loadSource(video.playlist)
    hls.attachMedia(element)
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError(true)
    })
    hlsRef.current = hls
    hls.startLoad()
    return () => {
      hlsRef.current = null
      hls.destroy()
    }
  }, [activated, video.playlist])

  if (video.playlist === null) {
    return (
      <div
        className={`b-video-player b-video-player--unavailable${className ? ` ${className}` : ''}`}
      >
        <DitherImage src={video.thumbnail} alt={video.alt || 'video post'} />
        <p className="b-video-player__error">video unavailable</p>
      </div>
    )
  }

  if (!activated) {
    return (
      <div className={`b-video-player b-video-player--poster${className ? ` ${className}` : ''}`}>
        <button
          type="button"
          className="b-video-player__poster"
          aria-label="play video"
          onClick={() => {
            setActivated(true)
          }}
        >
          <DitherImage src={video.thumbnail} alt={video.alt || 'video post'} />
          <span className="b-video-player__poster-mark" aria-hidden="true">
            ▶ play
          </span>
        </button>
        {video.alt.length > 0 ? <p className="b-video-player__alt">{video.alt}</p> : null}
      </div>
    )
  }

  const toggle = () => {
    const element = ref.current
    if (element === null) return
    if (element.paused) {
      hlsRef.current?.startLoad()
      void element.play().catch(() => {
        setError(true)
      })
    } else {
      element.pause()
    }
  }

  const seek = (value: number) => {
    const element = ref.current
    if (element === null) return
    element.currentTime = value
    setCurrent(value)
  }

  return (
    <div className={`b-video-player${className ? ` ${className}` : ''}`}>
      {/* biome-ignore lint/a11y/useMediaCaption: appview video embeds expose no caption track */}
      <video
        ref={ref}
        aria-label={video.alt || 'video'}
        className="b-video-player__video"
        poster={video.thumbnail ?? undefined}
        playsInline
        autoPlay
        preload="metadata"
        onClick={toggle}
        onPlay={() => {
          setPlaying(true)
        }}
        onPause={() => {
          setPlaying(false)
        }}
        onEnded={() => {
          setPlaying(false)
        }}
        onLoadedMetadata={(event) => {
          const next = event.currentTarget.duration
          setDuration(Number.isFinite(next) ? next : 0)
        }}
        onTimeUpdate={(event) => {
          setCurrent(event.currentTarget.currentTime)
        }}
        onError={() => {
          setError(true)
          setPlaying(false)
        }}
      />

      {!playing && !error ? (
        <button
          type="button"
          className="b-video-player__play"
          aria-label="play video"
          onClick={toggle}
        >
          <span aria-hidden="true">▶</span>
        </button>
      ) : null}

      <div className="b-video-player__controls">
        <button
          type="button"
          className="b-video-player__button"
          aria-label={playing ? 'pause video' : 'play video'}
          onClick={toggle}
        >
          {playing ? 'pause' : 'play'}
        </button>
        <input
          className="b-video-player__seek"
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={Math.min(current, duration > 0 ? duration : current)}
          aria-label="seek video"
          onChange={(event) => {
            seek(Number(event.target.value))
          }}
        />
        <span className="b-video-player__time">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>

      {error ? (
        <p className="b-video-player__error" role="alert">
          video cannot play in this browser
        </p>
      ) : null}
      {video.alt.length > 0 ? <p className="b-video-player__alt">{video.alt}</p> : null}
    </div>
  )
}
