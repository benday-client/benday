import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { suggestionAt, useActorSuggestions } from '../hooks/useActorSuggestions'
import { usePinnedFeeds } from '../hooks/usePinnedFeeds'
import { useTagSuggestions } from '../hooks/useTagSuggestions'
import { APPVIEW_PRESETS, toAppViewTarget } from '../lib/appviews'
import { useAuthStore } from '../lib/auth'
import { parseCommand } from '../lib/command'
import { useSettings } from '../lib/store'
import { availableThemeGroups, THEME_LABELS } from '../lib/themes'
import { useUiStore } from '../lib/ui'
import { Dialog, Kbd } from './ui'

const HISTORY_KEY = 'benday:jump-history'
const HISTORY_LIMIT = 5

interface JumpEntry {
  href: string
  label: string
  meta: string
}

function readHistory(): JumpEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (entry): entry is JumpEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as Record<string, unknown>)['href'] === 'string' &&
          typeof (entry as Record<string, unknown>)['label'] === 'string',
      )
      .slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function writeHistory(entries: JumpEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
  } catch {
    // history is an enhancement; storage failures are harmless
  }
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onOpenAppView: () => void
  onOpenHelp: () => void
  onOpenSettings: () => void
}

interface PaletteCommand {
  id: string
  label: string
  meta: string
  keywords: string
  run: () => void
}

export function CommandPalette({
  open,
  onClose,
  onOpenAppView,
  onOpenHelp,
  onOpenSettings,
}: CommandPaletteProps) {
  const [, navigate] = useLocation()
  const authStatus = useAuthStore((state) => state.status)
  const account = useAuthStore((state) => state.account)
  const pinned = usePinnedFeeds()
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)
  const setTheme = useSettings((state) => state.setTheme)
  const setAppView = useSettings((state) => state.setAppView)

  const [input, setInput] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState(0)
  const [history, setHistory] = useState<JumpEntry[]>(readHistory)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const token = open ? suggestionAt(input, cursor) : null
  const actorSuggestions = useActorSuggestions(
    token?.kind === 'mention' ? token.query : '',
    token?.kind === 'mention',
  )
  const tagSuggestions = useTagSuggestions(
    token?.kind === 'tag' ? token.query : '',
    token?.kind === 'tag',
  )

  const suggestions =
    token?.kind === 'tag'
      ? (tagSuggestions.tags.length > 0
          ? tagSuggestions.tags
          : token.query.length > 0
            ? [token.query]
            : []
        ).map((tag) => ({
          key: `tag:${tag}`,
          value: tag,
          label: `#${tag}`,
          detail: 'tag',
          kind: 'tag' as const,
        }))
      : token?.kind === 'mention' && token.query.length > 0
        ? actorSuggestions.suggestions.length > 0
          ? actorSuggestions.suggestions.map((actor) => ({
              key: actor.did,
              value: actor.handle,
              label: `@${actor.handle}`,
              detail: actor.displayName,
              kind: 'mention' as const,
            }))
          : [
              {
                key: 'literal-handle',
                value: token.query,
                label: `@${token.query}`,
                detail: 'handle',
                kind: 'mention' as const,
              },
            ]
        : []

  const suggestionsPending =
    token?.kind === 'tag' ? tagSuggestions.isPending : actorSuggestions.isPending

  useEffect(() => {
    if (!open) return
    setInput('')
    setCursor(0)
    setSelected(0)
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open])

  const remember = (href: string, label: string) => {
    setHistory((current) => {
      const next = [
        { href, label, meta: 'recent' },
        ...current.filter((entry) => entry.href !== href),
      ].slice(0, HISTORY_LIMIT)
      writeHistory(next)
      return next
    })
  }

  const go = (href: string, label = href) => {
    remember(href, label)
    navigate(href)
    onClose()
  }

  const authCommands: PaletteCommand[] =
    authStatus === 'authenticated'
      ? [
          {
            id: 'compose',
            label: 'compose a post',
            meta: 'c',
            keywords: 'write post new',
            run: () => {
              openCompose({ mode: 'post', post: null })
            },
          },
          {
            id: 'account',
            label: account ? `@${account.handle}` : 'account',
            meta: 'login',
            keywords: 'account sign out profile',
            run: () => {
              openDialog('account')
            },
          },
        ]
      : authStatus === 'anonymous'
        ? [
            {
              id: 'login',
              label: 'sign in',
              meta: 'login',
              keywords: 'app password auth account',
              run: () => {
                openDialog('login')
              },
            },
          ]
        : []

  const pinnedCommands: PaletteCommand[] = pinned.feeds.map((feed) => ({
    id: `pinned-feed:${feed.uri}`,
    label: feed.name,
    meta: 'pinned',
    keywords: `feed ${feed.description}`,
    run: () => {
      go(`/feed?uri=${encodeURIComponent(feed.uri)}`, feed.name)
    },
  }))

  const meCommand: PaletteCommand = {
    id: 'me',
    label: account ? `@${account.handle}` : '@me',
    meta: 'me',
    keywords: '@me my profile self account',
    run: () => {
      if (account !== null) {
        go(`/profile/${encodeURIComponent(account.handle)}`, `@${account.handle}`)
        return
      }
      onClose()
      openDialog('login')
    },
  }

  const commands: PaletteCommand[] = [
    ...authCommands,
    ...pinnedCommands,
    meCommand,
    {
      id: 'feeds',
      label: 'feeds',
      meta: '/feed',
      keywords: 'home discover timeline feed',
      run: () => {
        go('/feed', 'feeds')
      },
    },
    {
      id: 'search',
      label: 'search the network',
      meta: '/search',
      keywords: 'find query',
      run: () => {
        go('/search', 'search the network')
      },
    },
    {
      id: 'settings',
      label: 'settings',
      meta: ',',
      keywords: 'appearance theme appview labelers account preferences',
      run: () => {
        onClose()
        onOpenSettings()
      },
    },
    {
      id: 'appview-settings',
      label: 'appview settings',
      meta: 'a',
      keywords: 'host server instance appview',
      run: () => {
        onClose()
        onOpenAppView()
      },
    },
    {
      id: 'help',
      label: 'keyboard help',
      meta: '?',
      keywords: 'keys shortcuts',
      run: onOpenHelp,
    },
  ]

  const themeCommands: PaletteCommand[] = availableThemeGroups(new Date())
    .flatMap((group) => group.themes)
    .map((theme) => ({
      id: `theme:${theme}`,
      label: `theme ${THEME_LABELS[theme]}`,
      meta: 'theme',
      keywords: `${theme} ${THEME_LABELS[theme]} appearance color`,
      run: () => {
        setTheme(theme)
        onClose()
      },
    }))

  const appviewCommands: PaletteCommand[] = APPVIEW_PRESETS.map((preset) => ({
    id: `appview:${preset.id}`,
    label: `appview ${preset.label}`,
    meta: 'appview',
    keywords: `${preset.id} ${preset.label} ${preset.host} ${preset.note} host server`,
    run: () => {
      setAppView(toAppViewTarget(preset))
      onClose()
    },
  }))

  const recentCommands: PaletteCommand[] =
    input.trim().length === 0
      ? history.map((entry) => ({
          id: `recent:${entry.href}`,
          label: entry.label,
          meta: 'recent',
          keywords: 'history jump back',
          run: () => {
            go(entry.href, entry.label)
          },
        }))
      : []

  const autocompleteCommands: PaletteCommand[] = suggestions.map((suggestion) => ({
    id: `jump-suggestion:${suggestion.kind}:${suggestion.value}`,
    label: suggestion.label,
    meta: suggestion.detail,
    keywords: '',
    run: () => {
      const parsed = parseCommand(
        suggestion.kind === 'tag' ? `#${suggestion.value}` : `@${suggestion.value}`,
      )
      if (parsed !== null) {
        remember(parsed.href, parsed.label)
        navigate(parsed.href)
      }
      onClose()
    },
  }))

  const autocompleteActive =
    token !== null && (suggestionsPending || autocompleteCommands.length > 0)
  const needle = input.trim().toLowerCase()
  const commandsForTyping = [...themeCommands, ...appviewCommands, ...commands]
  const filtered = autocompleteActive
    ? autocompleteCommands
    : needle.length === 0
      ? [...recentCommands, ...commands]
      : commandsForTyping.filter((command) =>
          `${command.label} ${command.keywords}`.toLowerCase().includes(needle),
        )

  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const row = list.children[selected]
    if (!(row instanceof HTMLElement)) return
    if (typeof row.scrollIntoView !== 'function') return
    row.scrollIntoView({ block: 'nearest' })
  }, [selected, filtered.length])

  const onChange = (value: string) => {
    setInput(value)
    setCursor(value.length)
    setSelected(0)
  }

  const runSelected = () => {
    const normalizedInput = input.trim().toLowerCase()
    if (normalizedInput === '@me') {
      meCommand.run()
      return
    }

    if (autocompleteActive) {
      const command = filtered[selected] ?? filtered[0]
      if (command !== undefined) {
        command.run()
        return
      }
    }

    const trimmed = input.trim()
    const explicitTarget =
      trimmed.startsWith('@') || trimmed.startsWith('at://') || trimmed.startsWith('#')

    if (trimmed.length > 0 && explicitTarget) {
      const parsed = parseCommand(trimmed)
      if (parsed !== null) {
        remember(parsed.href, parsed.label)
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
        remember(parsed.href, parsed.label)
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
    <Dialog open={open} title="command" onClose={onClose} className="b-palette">
      <div className="b-palette__form">
        <span className="b-palette__prompt" aria-hidden="true">
          :
        </span>
        <input
          ref={inputRef}
          className="b-palette__input"
          type="text"
          value={input}
          aria-label="command or jump"
          placeholder="command · theme <name> · @handle · #tag · at://"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onSelect={(event) => {
            setCursor(event.currentTarget.selectionStart ?? 0)
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="b-palette__empty">
          {suggestionsPending
            ? 'searching handles and tags'
            : 'no matching command · enter searches the network'}
        </p>
      ) : (
        <ul ref={listRef} className="b-palette__list" aria-label="commands">
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
