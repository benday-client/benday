import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { parseCommand } from '../lib/command'
import { useSettings } from '../lib/store'
import { Dialog, Kbd } from './ui'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onOpenAppView: () => void
  onOpenHelp: () => void
}

interface PaletteCommand {
  id: string
  label: string
  meta: string
  keywords: string
  run: () => void
}

export function CommandPalette({ open, onClose, onOpenAppView, onOpenHelp }: CommandPaletteProps) {
  const [, navigate] = useLocation()
  const toggleTheme = useSettings((state) => state.toggleTheme)
  const setFlow = useSettings((state) => state.setFlow)
  const flow = useSettings((state) => state.flow)

  const [input, setInput] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setInput('')
    setSelected(0)
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open])

  const go = (href: string) => {
    navigate(href)
    onClose()
  }

  const cycleFlow = () => {
    const next = flow === 'auto' ? 'horizontal' : flow === 'horizontal' ? 'vertical' : 'auto'
    setFlow(next)
    onClose()
  }

  const commands: PaletteCommand[] = [
    {
      id: 'discover',
      label: 'discover',
      meta: '/',
      keywords: 'home timeline feed',
      run: () => {
        go('/')
      },
    },
    {
      id: 'search',
      label: 'search the network',
      meta: '/search',
      keywords: 'find query',
      run: () => {
        go('/search')
      },
    },
    {
      id: 'appview',
      label: 'switch appview',
      meta: 'a',
      keywords: 'host server instance',
      run: onOpenAppView,
    },
    {
      id: 'theme',
      label: 'toggle theme',
      meta: 't',
      keywords: 'void bone color',
      run: () => {
        toggleTheme()
        onClose()
      },
    },
    {
      id: 'flow',
      label: 'cycle flow',
      meta: 'f',
      keywords: 'horizontal vertical auto layout',
      run: cycleFlow,
    },
    {
      id: 'help',
      label: 'keyboard help',
      meta: '?',
      keywords: 'keys shortcuts',
      run: onOpenHelp,
    },
  ]

  const needle = input.trim().toLowerCase()
  const filtered =
    needle.length === 0
      ? commands
      : commands.filter((command) =>
          `${command.label} ${command.keywords}`.toLowerCase().includes(needle),
        )

  const onChange = (value: string) => {
    setInput(value)
    setSelected(0)
  }

  const runSelected = () => {
    const trimmed = input.trim()
    const explicitTarget =
      trimmed.startsWith('@') || trimmed.startsWith('at://') || trimmed.startsWith('#')

    if (trimmed.length > 0 && explicitTarget) {
      const parsed = parseCommand(trimmed)
      if (parsed !== null) {
        navigate(parsed.href)
        onClose()
        return
      }
    }

    const command = filtered[selected] ?? filtered[0]
    if (command !== undefined) {
      command.run()
      return
    }

    if (trimmed.length > 0) {
      const parsed = parseCommand(trimmed)
      if (parsed !== null) {
        navigate(parsed.href)
        onClose()
      }
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filtered.length === 0) return
      setSelected((current) => (current + 1) % filtered.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filtered.length === 0) return
      setSelected((current) => (current - 1 + filtered.length) % filtered.length)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      runSelected()
    }
  }

  return (
    <Dialog open={open} title="jump" onClose={onClose} className="b-palette">
      <div className="b-palette__form">
        <span className="b-palette__prompt" aria-hidden="true">
          :
        </span>
        <input
          ref={inputRef}
          className="b-palette__input"
          type="text"
          value={input}
          aria-label="jump to"
          placeholder="command, @handle, #tag, at://"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="b-palette__empty">no matching command · enter searches the network</p>
      ) : (
        <ul className="b-palette__list" aria-label="commands">
          {filtered.map((command, index) => {
            const isSelected = index === selected
            return (
              <li key={command.id} className="b-palette__row">
                <button
                  type="button"
                  className="b-palette__command"
                  data-selected={isSelected ? 'true' : 'false'}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => {
                    setSelected(index)
                    command.run()
                  }}
                  onMouseEnter={() => {
                    setSelected(index)
                  }}
                >
                  <span className="b-palette__marker" aria-hidden="true">
                    {isSelected ? '>' : '\u00a0'}
                  </span>
                  <span className="b-palette__label">{command.label}</span>
                  <span className="b-palette__meta">{command.meta}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="b-palette__hint">
        <span>
          <span className="b-palette__hint-glyph">@</span> profile
        </span>
        <span className="b-palette__hint-dot" aria-hidden="true">
          ·
        </span>
        <span>
          <span className="b-palette__hint-glyph">at://</span> thread/feed
        </span>
        <span className="b-palette__hint-dot" aria-hidden="true">
          ·
        </span>
        <span>
          <span className="b-palette__hint-glyph">#</span> search
        </span>
        <span className="b-palette__hint-esc">
          <Kbd>esc</Kbd> close
        </span>
      </footer>
    </Dialog>
  )
}
