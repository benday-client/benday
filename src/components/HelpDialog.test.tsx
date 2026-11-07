import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindingsForScope, displayKeys } from '../lib/keymap'
import { matchesSearchTokens } from '../lib/searchTokens'
import { useSettings } from '../lib/store'
import { HelpDialog } from './HelpDialog'

describe('HelpDialog', () => {
  beforeEach(() => {
    useSettings.setState({ keyboardShortcuts: true })
  })

  it('documents every registry global action', () => {
    render(<HelpDialog open onClose={vi.fn()} />)

    for (const binding of bindingsForScope('global')) {
      expect(screen.getByText(binding.label), `${binding.id} label`).toBeInTheDocument()
      for (const key of displayKeys(binding)) {
        expect(screen.getAllByText(key).length, `${binding.id} key ${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('documents no quote-creation shortcut', () => {
    const { container } = render(<HelpDialog open onClose={vi.fn()} />)

    const rows = Array.from(container.querySelectorAll<HTMLElement>('.b-help__row'))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const what = row.querySelector('.b-help__what')?.textContent ?? ''
      const keys = Array.from(row.querySelectorAll('.b-help__keys kbd')).map(
        (key) => key.textContent,
      )
      // "quoted" belongs to the retained o row; only a standalone quote action is gone
      expect(what, `row for ${keys.join('/')}`).not.toMatch(/\bquote\b/i)
      expect(keys).not.toContain('q')
    }

    const quotedRow = rows.find(
      (row) =>
        row.querySelector('.b-help__what')?.textContent === 'open the quoted post when present',
    )
    expect(quotedRow).toBeDefined()
    expect(
      Array.from(quotedRow?.querySelectorAll('.b-help__keys kbd') ?? []).map(
        (key) => key.textContent,
      ),
    ).toEqual(['o'])
  })

  it('filters the generated rows as the query changes', () => {
    render(<HelpDialog open onClose={vi.fn()} />)
    expect(screen.getByText('like or unlike')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('search keybindings'), {
      target: { value: 'unrepost' },
    })

    expect(screen.getByText('repost or unrepost')).toBeInTheDocument()
    expect(screen.queryByText('like or unlike')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('search keybindings'), {
      target: { value: 'nothing matches this' },
    })
    expect(screen.getByText('no matching keybinding')).toBeInTheDocument()
  })

  it('matches every query token in any order across a section and its rows', () => {
    render(<HelpDialog open onClose={vi.fn()} />)

    // two words, reversed relative to the label: both must occur
    fireEvent.change(screen.getByLabelText('search keybindings'), {
      target: { value: 'unrepost repost' },
    })
    expect(screen.getByText('repost or unrepost')).toBeInTheDocument()
    expect(screen.queryByText('like or unlike')).not.toBeInTheDocument()

    // one token comes from the scope title, the other from the row
    fireEvent.change(screen.getByLabelText('search keybindings'), {
      target: { value: 'anywhere settings' },
    })
    expect(screen.getByText('open settings')).toBeInTheDocument()
    expect(screen.queryByText('open this help')).not.toBeInTheDocument()

    // a token that is a prefix of nothing in the row still excludes it: no fuzzy
    fireEvent.change(screen.getByLabelText('search keybindings'), {
      target: { value: 'unrepost setts' },
    })
    expect(screen.getByText('no matching keybinding')).toBeInTheDocument()
  })

  it('keeps the hold-? intro outside the filtered rows', () => {
    render(<HelpDialog open onClose={vi.fn()} />)
    const intro = 'hold ? to reveal the keys over the controls it can run.'
    const note = (): HTMLElement => {
      const found = document.querySelector<HTMLElement>('.b-help__hold-note')
      if (found === null) throw new Error('hold note missing')
      return found
    }
    expect(note().textContent).toBe(intro)

    fireEvent.change(screen.getByLabelText('search keybindings'), {
      target: { value: 'unrepost' },
    })
    expect(note().textContent).toBe(intro)

    fireEvent.change(screen.getByLabelText('search keybindings'), {
      target: { value: 'nothing matches this' },
    })
    expect(note().textContent).toBe(intro)
  })

  it('takes bare slash for the search field only while character shortcuts are on', () => {
    const enabled = render(<HelpDialog open onClose={vi.fn()} />)
    const input = screen.getByLabelText('search keybindings')
    // the dialog opens on the search field, so start from nowhere
    input.blur()

    const consumed = fireEvent.keyDown(window, { key: '/' })
    // preventDefault was called, so the slash does not land in another field
    expect(consumed).toBe(false)
    expect(input).toHaveFocus()
    enabled.unmount()

    useSettings.setState({ keyboardShortcuts: false })
    render(<HelpDialog open onClose={vi.fn()} />)
    const blockedInput = screen.getByLabelText('search keybindings')
    blockedInput.blur()

    const claimed = fireEvent.keyDown(window, { key: '/' })
    expect(claimed).toBe(true)
    expect(blockedInput).not.toHaveFocus()
  })
})

describe('matchesSearchTokens', () => {
  it('requires every token in any order, case-insensitively', () => {
    expect(matchesSearchTokens('high contrast maximum', 'high contrast')).toBe(true)
    expect(matchesSearchTokens('high contrast maximum', 'contrast high')).toBe(true)
    expect(matchesSearchTokens('High Mode Maximum Preview', 'high preview')).toBe(true)
    expect(matchesSearchTokens('high contrast maximum', 'high absent')).toBe(false)
  })

  it('treats an empty or whitespace-only query as matching everything', () => {
    expect(matchesSearchTokens('high contrast maximum', '')).toBe(true)
    expect(matchesSearchTokens('high contrast maximum', '   ')).toBe(true)
    expect(matchesSearchTokens('', '')).toBe(true)
  })

  it('does not match fuzzy or subsequence queries', () => {
    expect(matchesSearchTokens('high contrast maximum', 'hcm')).toBe(false)
    expect(matchesSearchTokens('open settings', 'settngs')).toBe(false)
  })
})
