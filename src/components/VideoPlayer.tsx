import type Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import type { VideoEmbed } from '../lib/types'
import { DitherImage } from './DitherImage'

export interface VideoPlayerProps {
  video: VideoEmbed
  className?: string
}

type Phase = 'idle' | 'loading' | 'ready'
type PlaybackError = 'unsupported' | 'load' | null

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
  const readyRef = useRef(false)
  // attached means a source reached the element; only then can its error be
  // about the source rather than about a click that outran readiness
  const attachedRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<PlaybackError>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [activated, setActivated] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setActivated(false)
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setError(null)
    setPhase('idle')
    readyRef.current = false
    attachedRef.current = false
  }, [video.playlist])

  useEffect(() => {
    if (!activated) return
    const element = ref.current
    const playlist = video.playlist
    if (playlist === null || element === null) return

    let cancelled = false
    let hls: Hls | null = null
    setPhase('loading')
    setError(null)
    readyRef.current = false
    attachedRef.current = false

    const ready = () => {
      if (cancelled) return
      readyRef.current = true
      setPhase('ready')
    }

    const attach = async () => {
      // Only a browser without MSE plays HLS itself. canPlayType answers
      // "maybe" for HLS in Chromium too, so a non-empty answer is not proof.
      const canUseMse =
        typeof MediaSource !== 'undefined' ||
        (typeof window !== 'undefined' && 'ManagedMediaSource' in window)
      if (!canUseMse && element.canPlayType('application/vnd.apple.mpegurl') !== '') {
        element.src = playlist
        attachedRef.current = true
        return
      }

      try {
        // the player stays out of the entry bundle: a static import would ship
        // hls.js to every reader who never plays a video
        const { default: HlsPlayer } = await import('hls.js')
        if (cancelled) return

        if (!HlsPlayer.isSupported()) {
          setError('unsupported')
          setPhase('ready')
          return
        }

        hls = new HlsPlayer({ autoStartLoad: false })
        hlsRef.current = hls
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (cancelled || !data.fatal) return
          setError('load')
          setPhase('ready')
          // playback is over; the transport must read play, not pause
          setPlaying(false)
        })
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, ready)
        hls.loadSource(playlist)
        hls.attachMedia(element)
        attachedRef.current = true
        hls.startLoad()
      } catch {
        if (cancelled) return
        setError('load')
        setPhase('ready')
      }
    }

    void attach()

    return () => {
      cancelled = true
      readyRef.current = false
      attachedRef.current = false
      if (hls !== null) {
        if (hlsRef.current === hls) hlsRef.current = null
        hls.destroy()
      }
      // a late import must never attach to an element that moved on
      element.removeAttribute('src')
      element.load()
    }
  }, [activated, video.playlist, attempt])

  if (video.playlist === null) {
    return (
      <div
        className={`b-video-player b-video-player--unavailable${className ? ` ${className}` : ''}`}
      >
        <DitherImage src={video.thumbnail} alt={video.alt || 'video post'} />
        <p className="b-video-player__error">video unavailable</p>
        {video.alt.length > 0 ? <p className="b-video-player__alt">{video.alt}</p> : null}
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
          <span className="b-video-player__plate" aria-hidden="true">
            ▶
          </span>
        </button>
        {video.alt.length > 0 ? <p className="b-video-player__alt">{video.alt}</p> : null}
      </div>
    )
  }

  const loading = phase === 'loading'

  const toggle = () => {
    const element = ref.current
    if (element === null || loading || error !== null) return
    if (element.paused) {
      hlsRef.current?.startLoad()
      void element.play().catch((reason: unknown) => {
        // an autoplay refusal leaves the player paused on its own play button
        if (reason instanceof DOMException && reason.name === 'NotAllowedError') return
        if (readyRef.current) setError('load')
      })
      return
    }
    element.pause()
  }

  const seek = (value: number) => {
    const element = ref.current
    if (element === null) return
    element.currentTime = value
    setCurrent(value)
  }

  return (
    <div className={`b-video-player${className ? ` ${className}` : ''}`}>
      <div className="b-video-player__stage" aria-busy={loading ? 'true' : undefined}>
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
          onCanPlay={() => {
            if (readyRef.current) return
            readyRef.current = true
            setPhase('ready')
          }}
          onPlay={() => {
            setPlaying(true)
          }}
          onPause={(event) => {
            setPlaying(false)
            if (readyRef.current && !event.currentTarget.ended) hlsRef.current?.stopLoad()
          }}
          onEnded={() => {
            setPlaying(false)
            hlsRef.current?.stopLoad()
          }}
          onLoadedMetadata={(event) => {
            const next = event.currentTarget.duration
            setDuration(Number.isFinite(next) ? next : 0)
          }}
          onTimeUpdate={(event) => {
            setCurrent(event.currentTarget.currentTime)
          }}
          onError={() => {
            // a media error after the source is attached is a source failure
            if (!attachedRef.current) return
            setError('load')
            setPhase('ready')
            setPlaying(false)
          }}
        />

        {!playing && error === null && !loading ? (
          <button
            type="button"
            className="b-video-player__play"
            aria-label="play video"
            onClick={toggle}
          >
            <span className="b-video-player__plate" aria-hidden="true">
              ▶
            </span>
          </button>
        ) : null}
      </div>

      <div className="b-video-player__controls">
        <button
          type="button"
          className="b-video-player__button"
          aria-label={playing ? 'pause video' : 'play video'}
          aria-busy={loading ? 'true' : undefined}
          disabled={loading || error !== null}
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
          aria-busy={loading ? 'true' : undefined}
          disabled={loading || error !== null}
          onChange={(event) => {
            seek(Number(event.target.value))
          }}
        />
        <span className="b-video-player__time">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>

      {error === 'unsupported' ? (
        <p className="b-video-player__error" role="alert">
          video playback is not supported in this browser
        </p>
      ) : null}
      {error === 'load' ? (
        <p className="b-video-player__error" role="alert">
          <span>video failed to load</span>
          <button
            type="button"
            className="b-video-player__button"
            onClick={() => {
              setAttempt((count) => count + 1)
              setError(null)
              setPhase('loading')
            }}
          >
            retry video
          </button>
        </p>
      ) : null}
      {video.alt.length > 0 ? <p className="b-video-player__alt">{video.alt}</p> : null}
    </div>
  )
}
