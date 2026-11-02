import { describe, expect, it } from 'vitest'
import { formatAbsoluteTime, formatRelativeTime } from './time'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const now = new Date(2026, 0, 15, 12, 0, 0)

function ago(milliseconds: number): string {
  return new Date(now.getTime() - milliseconds).toISOString()
}

function ahead(milliseconds: number): string {
  return new Date(now.getTime() + milliseconds).toISOString()
}

describe('formatRelativeTime', () => {
  it('returns a dash for invalid dates', () => {
    expect(formatRelativeTime('not a date', now)).toBe('—')
    expect(formatRelativeTime('')).toBe('—')
    expect(formatRelativeTime(ago(0), new Date('invalid'))).toBe('—')
  })

  it('treats the last minute as now', () => {
    expect(formatRelativeTime(ago(0), now)).toBe('now')
    expect(formatRelativeTime(ago(1_000), now)).toBe('now')
    expect(formatRelativeTime(ago(59_999), now)).toBe('now')
  })

  it('crosses the minute boundary at 60 seconds', () => {
    expect(formatRelativeTime(ago(MINUTE), now)).toBe('1m')
    expect(formatRelativeTime(ago(59 * MINUTE + 59_000), now)).toBe('59m')
  })

  it('crosses the hour boundary at 60 minutes', () => {
    expect(formatRelativeTime(ago(HOUR), now)).toBe('1h')
    expect(formatRelativeTime(ago(23 * HOUR + 59 * MINUTE), now)).toBe('23h')
  })

  it('crosses the day boundary at 24 hours', () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe('1d')
    expect(formatRelativeTime(ago(6 * DAY + 23 * HOUR), now)).toBe('6d')
  })

  it('falls back to a local date at 7 days', () => {
    expect(formatRelativeTime(ago(7 * DAY), now)).toBe('2026-01-08')
    expect(formatRelativeTime(ago(30 * DAY), now)).toBe('2025-12-16')
  })

  it('tolerates small future clock skew', () => {
    expect(formatRelativeTime(ahead(1_000), now)).toBe('now')
    expect(formatRelativeTime(ahead(5 * MINUTE), now)).toBe('now')
  })

  it('shows a local date for futures beyond the skew window', () => {
    expect(formatRelativeTime(ahead(5 * MINUTE + 1_000), now)).toBe('2026-01-15')
    expect(formatRelativeTime(ahead(2 * DAY), now)).toBe('2026-01-17')
  })
})

describe('formatAbsoluteTime', () => {
  it('formats local date and time with zero padding', () => {
    expect(formatAbsoluteTime(new Date(2026, 4, 3, 7, 5, 9).toISOString())).toBe('2026-05-03 07:05')
    expect(formatAbsoluteTime(new Date(2026, 11, 31, 0, 0).toISOString())).toBe('2026-12-31 00:00')
  })

  it('returns a dash for invalid input', () => {
    expect(formatAbsoluteTime('not a date')).toBe('—')
  })
})
