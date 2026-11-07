import { describe, expect, it, vi } from 'vitest'
import {
  bindingFor,
  bindingsForScope,
  characterShortcutAllowed,
  characterShortcuts,
  chordSignature,
  chordsOf,
  globalHotkeys,
  type KeyScope,
  matchesChord,
  SCOPES,
} from './keymap'

const SCOPES_UNDER_TEST: readonly KeyScope[] = SCOPES.map((meta) => meta.scope)

describe('keyboard registry', () => {
  it('gives every chord to exactly one action inside a scope', () => {
    for (const scope of SCOPES_UNDER_TEST) {
      const ownersByChord = new Map<string, string[]>()
      for (const binding of bindingsForScope(scope)) {
        for (const chord of chordsOf(binding)) {
          const signature = chordSignature(chord)
          const owners = ownersByChord.get(signature) ?? []
          owners.push(binding.id)
          ownersByChord.set(signature, owners)
        }
      }
      const duplicates = [...ownersByChord].filter(([, owners]) => owners.length > 1)
      expect(duplicates, `duplicate chords in scope ${scope}`).toEqual([])
    }
  })

  it('labels every global action for the help dialog', () => {
    const globals = bindingsForScope('global')
    expect(globals.length).toBeGreaterThan(0)
    for (const binding of globals) {
      expect(binding.label.trim(), `${binding.id} label`).not.toBe('')
      expect(binding.keys.length, `${binding.id} display keys`).toBeGreaterThan(0)
      expect(binding.chords.length, `${binding.id} chords`).toBeGreaterThan(0)
    }
  })

  it('exposes every single printable key as a character shortcut', () => {
    expect(characterShortcuts.length).toBeGreaterThan(0)
    for (const key of characterShortcuts) {
      expect(key, `${key} is a single printable key`).toMatch(/^[\x20-\x7e]$/)
    }
    // the opt-out is complete: no anchor or shifted character is exempt
    for (const key of ['c', 's', '?', '/', ',', 'R', 'G', '+']) {
      expect(characterShortcuts, `${key} is switchable`).toContain(key)
    }
  })

  it('leaves the thread on left only, never escape', () => {
    const leave = bindingFor('thread-leave')
    expect(leave.keys).toEqual(['←'])
    expect(chordsOf(leave).map((chord) => chord.key)).toEqual(['ArrowLeft'])
    // escape keeps its single global back owner instead of a thread alias
    expect(chordsOf(leave).some((chord) => chord.key === 'Escape')).toBe(false)
  })

  it('matches produced characters no matter which shift typed them', () => {
    // `G`, `R` and `+` arrive as their produced character with shift still set;
    // constraining shift on those chords would make them unmatchable
    const cases = [
      ['deck-ends', 'G', true],
      ['refresh', 'R', true],
      ['card-more', '+', true],
      ['deck-scroll', 'PageDown', true],
      ['deck-scroll', 'ArrowUp', true],
      ['deck-move', 'ArrowUp', false],
    ] as const

    for (const [id, key, expected] of cases) {
      const chord = chordsOf(bindingFor(id)).find((candidate) => candidate.key === key)
      expect(chord, `${id} declares ${key}`).toBeDefined()
      if (chord === undefined) continue
      expect(
        matchesChord({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: true }, chord),
        `${id} ${key} with shift held`,
      ).toBe(expected)
    }
  })

  it('hands useHotkeys only the global bindings that have handlers', () => {
    const search = vi.fn()
    const hotkeys = globalHotkeys({ search })

    // search expands to its chord and its s alias, and actions without a
    // handler — palette, back, tab cycling — are owned by their own listeners
    expect(hotkeys.map((hotkey) => hotkey.key)).toEqual(['/', 's'])
    expect(hotkeys.every((hotkey) => hotkey.handler === search)).toBe(true)
    expect(hotkeys.some((hotkey) => hotkey.key === 'Escape')).toBe(false)
  })
})

describe('character shortcut opt-out', () => {
  const bare = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false })
  const withModifier = (key: string, modifier: 'ctrlKey' | 'metaKey' | 'altKey') => ({
    key,
    ctrlKey: modifier === 'ctrlKey',
    metaKey: modifier === 'metaKey',
    altKey: modifier === 'altKey',
  })

  it('allows every shortcut while the setting is on', () => {
    for (const key of ['f', 'j', 's', 'G', '1', 'ArrowUp', 'Enter']) {
      expect(characterShortcutAllowed(true, bare(key)), key).toBe(true)
    }
  })

  it('rejects bare character shortcuts while the setting is off', () => {
    const letters = ['f', 'b', 'r', 'y', 'v', 'm', 'o', 'x', 'j', 'k', 's', 'c']
    for (const key of [...letters, 'G', 'R']) {
      expect(characterShortcuts, `${key} is a registered character shortcut`).toContain(key)
      expect(characterShortcutAllowed(false, bare(key)), key).toBe(false)
    }
  })

  it('keeps modifier chords working while character shortcuts are off', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      for (const key of ['f', 'j', 'c', 'ArrowUp', 'Enter']) {
        expect(
          characterShortcutAllowed(false, withModifier(key, modifier)),
          `${modifier}+${key}`,
        ).toBe(true)
      }
    }
  })

  it('leaves non-character keys alone', () => {
    const keys = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Enter',
      'Escape',
      'Tab',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      'Backspace',
    ]
    for (const key of keys) {
      expect(characterShortcuts, `${key} is not a character shortcut`).not.toContain(key)
      expect(characterShortcutAllowed(false, bare(key)), key).toBe(true)
    }
  })

  it('opts out of the search and help anchors too', () => {
    for (const key of ['/', '?', ',']) {
      expect(characterShortcuts, `${key} is a registered shortcut`).toContain(key)
      expect(characterShortcutAllowed(false, bare(key)), key).toBe(false)
      expect(characterShortcutAllowed(true, bare(key)), key).toBe(true)
      expect(characterShortcutAllowed(false, withModifier(key, 'ctrlKey')), key).toBe(true)
    }
  })

  it('treats positional digits as character shortcuts too', () => {
    // deck and thread positions 1-9 are bare single-character shortcuts, so the
    // opt-out covers them rather than leaving them active
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(characterShortcuts, `${key} is registered`).toContain(key)
      expect(characterShortcutAllowed(false, bare(key)), key).toBe(false)
      expect(characterShortcutAllowed(true, bare(key)), key).toBe(true)
    }
  })

  it('drops the retired deck letters and the zero alias', () => {
    for (const key of ['h', 'l', '0']) expect(characterShortcuts).not.toContain(key)
    // j and k survive in the thread scope only
    for (const key of ['j', 'k']) expect(characterShortcuts).toContain(key)
  })

  it('answers from the event instead of the document', () => {
    // a synthetic event outside the DOM has to be enough; no global lookup
    const created = new KeyboardEvent('keydown', { key: 'f', bubbles: true })
    expect(characterShortcutAllowed(false, created)).toBe(false)
    expect(
      characterShortcutAllowed(false, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })),
    ).toBe(true)
  })
})
