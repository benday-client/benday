import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useLocation } from 'wouter'
import {
  buildSuggestions,
  type SuggestionItem,
  suggestionAt,
  useActorSuggestions,
} from '../hooks/useActorSuggestions'
import { usePinnedFeeds } from '../hooks/usePinnedFeeds'
import { useAuthStore } from '../lib/auth'
import { parseCommand } from '../lib/command'
import { bindingFor, matchesBinding } from '../lib/keymap'
import { isRecord } from '../lib/records'
import { useUiStore } from '../lib/ui'
import { Dialog } from './ui'

const HISTORY_KEY = 'benday:jump-history'
const HISTORY_LIMIT = 5
// breathing room between the selected row and the list edge
const SCROLL_MARGIN = 4
// rows moved by page keys when the list reports no metrics (layout-less runs)
const FALLBACK_PAGE_ROWS = 5

const TOGGLE_BINDING = bindingFor('palette')
const MOVE_BINDING = bindingFor('palette-move')
const RUN_BINDING = bindingFor('palette-run')

interface JumpEntry {
  href: string
  label: string
}

/**
 * A stored destination is only usable when it resolves inside this document:
 * same origin and the same protocol it was stored under. The normalised
 * path+query+hash is returned, so a protocol-relative or backslash authority
 * cannot masquerade as a local path and a blob: url is never a route.
 */
function safeJumpHref(rawHref: string): string | null {
  let url: URL
  try {
    url = new URL(rawHref, window.location.origin)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  if (url.protocol !== window.location.protocol) return null
  return `${url.pathname}${url.search}${url.hash}`
}

function readHistory(): JumpEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    // construct a clean entry instead of handing the stored object back under
    // an unsound predicate: legacy extra fields never reach the palette
    const entries: JumpEntry[] = []
    for (const entry of parsed) {
      if (entries.length >= HISTORY_LIMIT) break
      if (!isRecord(entry)) continue
      const href = entry['href']
      const label = entry['label']
      if (typeof href !== 'string' || typeof label !== 'string') continue
      const safe = safeJumpHref(href)
      if (safe === null) continue
      entries.push({ href: safe, label })
    }
    return entries
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

export function CommandPalette({ open, onClose, onOpenHelp, onOpenSettings }: CommandPaletteProps) {
  const [, navigate] = useLocation()
  const account = useAuthStore((state) => state.account)
  const pinned = usePinnedFeeds()
  const openDialog = useUiStore((state) => state.openDialog)
  const openCompose = useUiStore((state) => state.openCompose)

  const [input, setInput] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState(0)
  const [history, setHistory] = useState<JumpEntry[]>(readHistory)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  // last hover coordinates: an event carrying the same position did not come
  // from the pointer moving, only from the list scrolling underneath it
  const pointerRef = useRef({ x: Number.NaN, y: Number.NaN })
  const selectedIdRef = useRef<string | null>(null)
  const justOpenedRef = useRef(false)
  const token = open ? suggestionAt(input, cursor) : null
  const actorSuggestions = useActorSuggestions(token?.query ?? '', token !== null)
  const suggestions = buildSuggestions(token, actorSuggestions.suggestions)

  const suggestionsPending = actorSuggestions.isPending

  useEffect(() => {
    if (!open) return
    justOpenedRef.current = true
    setInput('')
    setCursor(0)
    setSelected(0)
    selectedIdRef.current = null
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [open])

  const remember = (href: string, label: string) => {
    setHistory((current) => {
      const next = [{ href, label }, ...current.filter((entry) => entry.href !== href)].slice(
        0,
        HISTORY_LIMIT,
      )
      writeHistory(next)
      return next
    })
  }

  const go = (href: string, label = href) => {
    remember(href, label)
    navigate(href)
    onClose()
  }

  const authCommands: PaletteCommand[] = [
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
      meta: 'account',
      keywords: 'account sign out profile',
      run: () => {
        openDialog('account')
      },
    },
  ]

  const pinnedCommands: PaletteCommand[] =
    pinned.error !== null
      ? [
          {
            id: 'pinned-unavailable',
            label: 'could not load pinned feeds',
            meta: 'retry',
            keywords: 'feed pinned error retry',
            run: () => {
              pinned.reload()
              onClose()
            },
          },
        ]
      : pinned.feeds.map((feed) => ({
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
      if (account === null) {
        onClose()
        return
      }
      go(`/profile/${encodeURIComponent(account.handle)}`, `@${account.handle}`)
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
      keywords: 'home timeline feed',
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
      keywords: 'appearance theme account preferences',
      run: () => {
        onClose()
        onOpenSettings()
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

  // an exact `@me` query is answered by the real account command, not by a
  // literal handle that would resolve to a made-up /profile/me
  const exactMeMention = token !== null && token.query.trim().toLowerCase() === 'me'
  const mentionSuggestions: SuggestionItem[] = exactMeMention
    ? suggestions.filter((suggestion) => suggestion.value.toLowerCase() !== 'me')
    : suggestions
  const autocompleteCommands: PaletteCommand[] = [
    ...(exactMeMention ? [meCommand] : []),
    ...mentionSuggestions.map((suggestion) => ({
      id: `jump-suggestion:mention:${suggestion.value}`,
      label: suggestion.label,
      meta: suggestion.detail,
      keywords: '',
      run: () => {
        const parsed = parseCommand(`@${suggestion.value}`)
        if (parsed !== null) {
          remember(parsed.href, parsed.label)
          navigate(parsed.href)
        }
        onClose()
      },
    })),
  ]

  const autocompleteActive =
    token !== null && (suggestionsPending || autocompleteCommands.length > 0)
  const needle = input.trim().toLowerCase()
  const commandsForTyping = commands
  const filtered = autocompleteActive
    ? autocompleteCommands
    : needle.length === 0
      ? [...recentCommands, ...commands]
      : commandsForTyping.filter((command) =>
          `${command.label} ${command.keywords}`.toLowerCase().includes(needle),
        )

  const selectedIndex = filtered.length === 0 ? 0 : Math.min(selected, filtered.length - 1)
  const selectedId = filtered[selectedIndex]?.id ?? null
  const optionId = (index: number) => `${listboxId}-option-${index}`
  // a closed palette owns no popup; an open one owns it only while rows exist
  const listboxOpen = open && filtered.length > 0
  const activeOptionId = listboxOpen && selectedId !== null ? optionId(selectedIndex) : undefined

  useEffect(() => {
    if (justOpenedRef.current) {
      justOpenedRef.current = false
      selectedIdRef.current = null
      return
    }

    if (filtered.length === 0) {
      if (selected !== 0) setSelected(0)
      selectedIdRef.current = null
      return
    }

    const previousId = selectedIdRef.current
    if (previousId !== null) {
      const index = filtered.findIndex((command) => command.id === previousId)
      if (index !== -1) {
        if (index !== selected) setSelected(index)
        return
      }
    }

    const clamped = Math.min(selected, filtered.length - 1)
    if (clamped !== selected) setSelected(clamped)
    selectedIdRef.current = filtered[clamped]?.id ?? null
  }, [filtered, selected])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null || selectedId === null) return
    const row = list.children[selectedIndex]
    if (!(row instanceof HTMLElement)) return
    // layout-less environments (jsdom) report no metrics, so there is nothing
    // to keep in view
    if (list.clientHeight === 0) return

    const box = list.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    if (rect.height === 0) return

    // only the list scrolls here: scrollIntoView would also move the centred
    // dialog and every scrollable ancestor above it
    const above = box.top + SCROLL_MARGIN - rect.top
    const below = rect.bottom - (box.top + list.clientHeight - SCROLL_MARGIN)
    if (above > 0) {
      list.scrollTop -= above
    } else if (below > 0) {
      list.scrollTop += below
    }
  }, [selectedIndex, selectedId, filtered.length])

  const selectIndex = (index: number) => {
    setSelected(index)
    selectedIdRef.current = filtered[index]?.id ?? null
  }

  // arrowing scrolls rows under a parked pointer, and the browser re-dispatches
  // hover events for whatever row arrived there; only a real pointer move may
  // take the selection away from the keyboard
  const hoverSelect = (index: number, event: ReactMouseEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current
    const moved = pointer.x !== event.clientX || pointer.y !== event.clientY
    pointer.x = event.clientX
    pointer.y = event.clientY
    if (moved) selectIndex(index)
  }

  const moveSelection = (step: number) => {
    if (filtered.length === 0) return
    const current = Math.min(selected, filtered.length - 1)
    const next = (current + step + filtered.length) % filtered.length
    selectIndex(next)
  }

  // page keys move by the rows that actually fit in the results box; layout-less
  // runs fall back to a fixed page. Unlike arrowing, they clamp at either end
  // instead of wrapping.
  const movePage = (direction: number) => {
    if (filtered.length === 0) return
    const list = listRef.current
    const row = list?.children[0]
    const rowHeight = row instanceof HTMLElement ? row.getBoundingClientRect().height : 0
    const page =
      list !== null && rowHeight > 0 && list.clientHeight > 0
        ? Math.max(1, Math.floor(list.clientHeight / rowHeight))
        : FALLBACK_PAGE_ROWS
    const current = Math.min(selected, filtered.length - 1)
    selectIndex(Math.min(Math.max(current + direction * page, 0), filtered.length - 1))
  }

  const moveToEdge = (last: boolean) => {
    if (filtered.length === 0) return
    selectIndex(last ? filtered.length - 1 : 0)
  }

  const onChange = (value: string) => {
    setInput(value)
    setCursor(value.length)
    setSelected(0)
    selectedIdRef.current = null
  }

  // whatever row is visibly highlighted wins, exactly like clicking it; the
  // parser only reads the query when nothing is listed
  const runSelected = () => {
    const command = filtered[selectedIndex]
    if (command !== undefined) {
      command.run()
      return
    }

    const trimmed = input.trim()
    if (trimmed.length === 0) return
    const parsed = parseCommand(trimmed)
    if (parsed === null) return
    remember(parsed.href, parsed.label)
    navigate(parsed.href)
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // an IME owns the key that commits its composition; the global palette
    // toggle may already have closed this dialog in its capture listener
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return

    // ctrl/cmd k from inside the field toggles the palette shut
    if (matchesBinding(event, TOGGLE_BINDING)) {
      event.preventDefault()
      onClose()
      return
    }

    // the registry owns the chord list, so the field cannot drift from the
    // help dialog or the badge overlay
    if (matchesBinding(event, MOVE_BINDING)) {
      if (filtered.length === 0) {
        // nothing to walk: Home/End and the arrows still edit the query, so
        // their native caret behaviour survives instead of being swallowed
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === 'Home' ||
          event.key === 'End'
        ) {
          return
        }
      }
      event.preventDefault()
      if (event.key === 'ArrowDown' || event.key === 'n') {
        moveSelection(1)
      } else if (event.key === 'ArrowUp' || event.key === 'p') {
        moveSelection(-1)
      } else if (event.key === 'PageDown') {
        movePage(1)
      } else if (event.key === 'PageUp') {
        movePage(-1)
      } else {
        moveToEdge(event.key === 'End')
      }
      return
    }

    if (matchesBinding(event, RUN_BINDING)) {
      event.preventDefault()
      runSelected()
    }
  }

  return (
    <Dialog open={open} title="command" onClose={onClose} className="b-palette" headerClose>
      <div className="b-palette__form">
        <span className="b-palette__prompt" aria-hidden="true">
          :
        </span>
        <input
          ref={inputRef}
          className="b-palette__input"
          type="text"
          role="combobox"
          value={input}
          aria-label="command or jump"
          aria-autocomplete="list"
          aria-expanded={open ? listboxOpen : undefined}
          aria-controls={listboxOpen ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          placeholder="command · @handle · at://"
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

      <div className="b-palette__results">
        {filtered.length === 0 ? (
          <p className="b-palette__empty">
            {suggestionsPending
              ? 'searching accounts'
              : 'no matching command · enter searches the network'}
          </p>
        ) : (
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="b-palette__list"
            aria-label="commands"
          >
            {filtered.map((command, index) => {
              const isSelected = index === selectedIndex
              return (
                <div key={command.id} role="presentation" className="b-palette__row">
                  <button
                    type="button"
                    id={optionId(index)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    className="b-palette__command"
                    data-selected={isSelected ? 'true' : 'false'}
                    onClick={() => {
                      selectIndex(index)
                      command.run()
                    }}
                    onMouseMove={(event) => {
                      hoverSelect(index, event)
                    }}
                  >
                    <span className="b-palette__marker" aria-hidden="true">
                      {isSelected ? '>' : '\u00a0'}
                    </span>
                    <span className="b-palette__label">{command.label}</span>
                    <span className="b-palette__meta">{command.meta}</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <footer className="b-palette__hint">
        <span>
          <span className="b-palette__hint-glyph">@</span> profile
        </span>
        <span className="b-palette__hint-dot" aria-hidden="true">
          ·
        </span>
        <span>
          <span className="b-palette__hint-glyph">at://</span> thread
        </span>
        <span className="b-palette__hint-dot" aria-hidden="true">
          ·
        </span>
        <span>
          <span className="b-palette__hint-glyph">#</span> search
        </span>
      </footer>
    </Dialog>
  )
}
