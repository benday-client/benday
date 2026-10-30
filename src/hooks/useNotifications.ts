import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useAuthStore } from '../lib/auth'
import {
  fetchNotifications,
  markNotificationsSeen,
  type NotificationModel,
} from '../lib/notifications'

const STALE_TIME = 30_000
const RETRY_DELAY = 800

export interface NotificationsState {
  notifications: NotificationModel[]
  isPending: boolean
  isFetching: boolean
  error: Error | null
  reload: () => void
}

function normalizeError(error: unknown): Error | null {
  if (error === null || error === undefined) return null
  return error instanceof Error ? error : new Error(String(error))
}

export function notificationsQueryKey(did: string | null): readonly unknown[] {
  return ['notifications', 'list', did ?? 'anonymous']
}

export function useNotifications(): NotificationsState {
  const status = useAuthStore((state) => state.status)
  const did = useAuthStore((state) => state.account?.did ?? null)
  const enabled = status === 'authenticated' && did !== null
  const markedRef = useRef<string | null>(null)

  const query = useQuery({
    queryKey: notificationsQueryKey(did),
    queryFn: fetchNotifications,
    enabled,
    staleTime: STALE_TIME,
    retry: 1,
    retryDelay: RETRY_DELAY,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })

  // Opening the view marks everything as seen, but only once the list is
  // actually on screen and never in a way that can hold up the fetch.
  useEffect(() => {
    if (!enabled || did === null) {
      markedRef.current = null
      return
    }
    if (query.data === undefined) return
    if (markedRef.current === did) return
    markedRef.current = did
    void markNotificationsSeen(query.data[0]?.indexedAt)
  }, [enabled, did, query.data])

  return {
    notifications: enabled ? (query.data ?? []) : [],
    isPending: enabled && query.isPending,
    isFetching: enabled && query.isFetching,
    error: normalizeError(query.error),
    reload: () => {
      if (!enabled) return
      void query.refetch()
    },
  }
}
