import { AtpAgent } from '@atproto/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorInfo } from '../lib/errors'
import type { AppViewTarget } from '../lib/types'

export interface AppViewProbeState {
  status: 'idle' | 'checking' | 'ok' | 'error'
  latencyMs: number | null
  detail: string
  probe: () => void
}

interface ProbeSnapshot {
  status: AppViewProbeState['status']
  latencyMs: number | null
  detail: string
}

const IDLE_SNAPSHOT: ProbeSnapshot = { status: 'idle', latencyMs: null, detail: '' }
const PROBE_TIMEOUT = 8000

export function useAppViewProbe(target: AppViewTarget, enabled = true): AppViewProbeState {
  const host = target.host
  const [snapshot, setSnapshot] = useState<ProbeSnapshot>(IDLE_SNAPSHOT)
  const generation = useRef(0)

  const check = useCallback(() => {
    generation.current += 1
    const current = generation.current
    setSnapshot({ status: 'checking', latencyMs: null, detail: '' })
    const started = performance.now()

    const run = async (): Promise<void> => {
      try {
        const agent = new AtpAgent({ service: host })
        await agent.app.bsky.actor.getProfile(
          { actor: 'bsky.app' },
          { signal: AbortSignal.timeout(PROBE_TIMEOUT) },
        )
        if (generation.current !== current) return
        setSnapshot({
          status: 'ok',
          latencyMs: Math.round(performance.now() - started),
          detail: '',
        })
      } catch (error) {
        if (generation.current !== current) return
        setSnapshot({ status: 'error', latencyMs: null, detail: errorInfo(error).detail })
      }
    }

    void run()
  }, [host])

  useEffect(() => {
    if (enabled) check()
    return () => {
      generation.current += 1
    }
  }, [enabled, check])

  return { ...snapshot, probe: check }
}
