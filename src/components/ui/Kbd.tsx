import type { ReactNode } from 'react'

export interface KbdProps {
  children: ReactNode
}

export function Kbd({ children }: KbdProps) {
  return <kbd className="b-kbd">{children}</kbd>
}
