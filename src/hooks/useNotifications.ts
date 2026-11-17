import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useAuthStore } from '../lib/auth'
import { normalizeError } from '../lib/errors'
import {
  fetchNotifications,
  markNotificationsSeen,
  type NotificationModel,
  type NotificationPage,
} from '../lib/notifications'

const STALE_TIME = 30_000
const RETRY_DELAY = 800

const EMPTY_PAGE: NotificationPage = { notifications: [], newestIndexedAt: null }

export interface NotificationsState {
  notifications: NotificationModel[]
  hasData: boolean
  isPending: boolean
  isFetching: boolean
  error: Error | null
  reload: () => void
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
    queryFn: () =>
      did === null ? Promise.resolve<NotificationPage>(EMPTY_PAGE) : fetchNotifications(did),
    enabled,
    staleTime: STALE_TIME,
    retry: 1,
    retryDelay: RETRY_DELAY,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })

  // Opening the view marks everything as seen, but only once the list is
  // actually on screen and never in a way that can hold up the fetch. The
  // cursor comes from the unfiltered page, so a hidden newest notification is
  // acknowledged too; only a genuinely empty wire page has nothing to send.
  useEffect(() => {
    if (!enabled || did === null) {
      markedRef.current = null
      return
    }
    if (query.data === undefined) return
    const seenAt = query.data.newestIndexedAt
    if (seenAt === null) return
    if (markedRef.current === did) return
    markedRef.current = did
    void markNotificationsSeen(did, seenAt)
  }, [enabled, did, query.data])

  const page = enabled ? query.data : undefined

  return {
    notifications: page?.notifications ?? [],
    hasData: page !== undefined,
    isPending: enabled && query.isPending,
    isFetching: enabled && query.isFetching,
    error: normalizeError(query.error),
    reload: () => {
      if (!enabled) return
      void query.refetch()
    },
  }
}
