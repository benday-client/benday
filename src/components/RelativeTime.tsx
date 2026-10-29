import { useEffect, useState } from 'react'
import { formatAbsoluteTime, formatRelativeTime } from '../lib/time'

export interface RelativeTimeProps {
  iso: string
  className?: string
}

export function RelativeTime({ iso, className }: RelativeTimeProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 60_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const classes = ['b-relative-time']
  if (className !== undefined) classes.push(className)

  return (
    <time className={classes.join(' ')} dateTime={iso} title={formatAbsoluteTime(iso)}>
      {formatRelativeTime(iso, now)}
    </time>
  )
}
