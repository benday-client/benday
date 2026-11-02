const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const CLOCK_SKEW = 5 * MINUTE

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const nowMs = now.getTime()
  if (Number.isNaN(date.getTime()) || Number.isNaN(nowMs)) return '—'

  const elapsed = nowMs - date.getTime()
  if (elapsed < 0) {
    return -elapsed <= CLOCK_SKEW ? 'now' : localDate(date)
  }
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`
  return localDate(date)
}

export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
