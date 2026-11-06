/**
 * The single keyboard registry. Owners keep their own handlers and guards; this
 * module only declares which action owns which key, in which scope. The help
 * dialog, the future hold-to-reveal overlay and the character-shortcut opt-out
 * all read from here so they cannot drift apart.
 *
 * No DOM access happens here: every helper takes a plain event shape.
 */

export type KeyScope =
  | 'global'
  | 'deck'
  | 'card'
  | 'thread'
  | 'compose'
  | 'palette'
  | 'dialog'
  | 'media'

/**
 * `primary` is the platform tab modifier: meta on macOS, ctrl everywhere else.
 * `ctrlOrMeta` accepts either one, for chords that are the same on both.
 * Shift is only constrained when it is present, because `event.key` already
 * carries the produced character (`?`, `+`, `G`).
 */
export interface KeyChord {
  key: string
  display?: string
  ctrlOrMeta?: boolean
  primary?: boolean
  shift?: boolean
  alt?: boolean
}

export interface KeyAlias {
  display: string
  chord: KeyChord
}

export interface KeyBinding {
  id: string
  scope: KeyScope
  /** Display labels for the help dialog and key badges. */
  keys: readonly string[]
  /** Match data. Handlers compare against these, never against `keys`. */
  chords: readonly KeyChord[]
  label: string
  aliases?: readonly KeyAlias[]
}

export interface ScopeMeta {
  scope: KeyScope
  title: string
  note: string
}

export type PrimaryModifier = 'meta' | 'ctrl'

export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** A global action bound to a handler, in the shape `useHotkeys` consumes. */
export interface HotkeyBinding {
  key: string
  ctrlOrMeta?: boolean
  handler: () => void
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function digitChords(): KeyChord[] {
  return DIGITS.map((key) => ({ key, shift: false }))
}

function letterChords(letters: readonly string[]): KeyChord[] {
  return letters.map((key) => ({ key, shift: false }))
}

export const SCOPES: readonly ScopeMeta[] = [
  {
    scope: 'global',
    title: 'anywhere',
    note: 'global keys; an open dialog or composer gets the key first',
  },
  { scope: 'deck', title: 'deck', note: 'moving between cards and scrolling the surface' },
  { scope: 'card', title: 'post actions', note: 'on the focused card' },
  { scope: 'thread', title: 'thread', note: 'the replies under a post' },
  { scope: 'compose', title: 'composer', note: 'writing a post' },
  { scope: 'palette', title: 'command palette', note: 'while the palette is open' },
  { scope: 'dialog', title: 'dialogs', note: 'inside settings and other dialogs' },
  { scope: 'media', title: 'media viewer', note: 'while an image viewer is open' },
]

const KEY_BINDINGS: readonly KeyBinding[] = [
  // global
  {
    id: 'palette',
    scope: 'global',
    keys: ['ctrl/cmd k'],
    chords: [{ key: 'k', ctrlOrMeta: true, shift: false }],
    label: 'open or close the command palette',
  },
  {
    id: 'search',
    scope: 'global',
    keys: ['/'],
    chords: [{ key: '/', shift: false }],
    label: 'go to search',
    aliases: [{ display: 's', chord: { key: 's', shift: false } }],
  },
  {
    id: 'compose',
    scope: 'global',
    keys: ['c'],
    chords: letterChords(['c']),
    label: 'open the composer',
  },
  {
    id: 'settings',
    scope: 'global',
    keys: [','],
    chords: [{ key: ',', shift: false }],
    label: 'open settings',
  },
  {
    id: 'help',
    scope: 'global',
    keys: ['?'],
    chords: [{ key: '?' }],
    label: 'open this help',
  },
  {
    id: 'tabs',
    scope: 'global',
    keys: ['ctrl/cmd ←', 'ctrl/cmd →'],
    chords: [
      { key: 'ArrowLeft', primary: true, shift: false },
      { key: 'ArrowRight', primary: true, shift: false },
    ],
    label: 'switch between the feed and notifications tabs',
  },
  {
    id: 'back',
    scope: 'global',
    keys: ['esc'],
    chords: [{ key: 'Escape', shift: false }],
    label: 'close a dialog or go back',
  },

  // deck
  {
    id: 'deck-move',
    scope: 'deck',
    keys: ['←', '→', '↑', '↓', 'j', 'k', 'h', 'l'],
    chords: [
      { key: 'ArrowLeft', shift: false },
      { key: 'ArrowRight', shift: false },
      { key: 'ArrowUp', shift: false },
      { key: 'ArrowDown', shift: false },
      ...letterChords(['j', 'k', 'h', 'l']),
    ],
    label:
      'arrows follow the deck: left/right move a wide deck, up/down a narrow one; the back arrow leaves at the first card',
  },
  {
    id: 'deck-ends',
    scope: 'deck',
    keys: ['Home', 'End'],
    chords: [
      { key: 'Home', shift: false },
      { key: 'End', shift: false },
    ],
    label: 'jump to the first or last card',
    aliases: [
      { display: 'g', chord: { key: 'g', shift: false } },
      { display: 'G', chord: { key: 'G' } },
    ],
  },
  {
    id: 'deck-position',
    scope: 'deck',
    keys: ['1-9'],
    chords: digitChords(),
    label: 'focus a card by position',
  },
  {
    id: 'deck-open',
    scope: 'deck',
    keys: ['enter'],
    chords: [{ key: 'Enter', shift: false }],
    label: 'open the focused card; ↓ also opens on a wide deck and → on a narrow one',
  },
  {
    id: 'deck-scroll',
    scope: 'deck',
    keys: ['pgup', 'pgdn', 'shift ↑', 'shift ↓'],
    chords: [
      { key: 'PageUp' },
      { key: 'PageDown' },
      { key: 'ArrowUp', shift: true },
      { key: 'ArrowDown', shift: true },
    ],
    label: 'scroll the deck body',
  },
  {
    id: 'refresh',
    scope: 'deck',
    keys: ['R'],
    chords: [{ key: 'R' }],
    label: 'refresh the feed; press again to confirm',
  },

  // card
  {
    id: 'card-like',
    scope: 'card',
    keys: ['f'],
    chords: letterChords(['f']),
    label: 'like or unlike',
  },
  {
    id: 'card-repost',
    scope: 'card',
    keys: ['b'],
    chords: letterChords(['b']),
    label: 'repost or unrepost',
  },
  { id: 'card-reply', scope: 'card', keys: ['r'], chords: letterChords(['r']), label: 'reply' },
  { id: 'card-quote', scope: 'card', keys: ['q'], chords: letterChords(['q']), label: 'quote' },
  {
    id: 'card-copy',
    scope: 'card',
    keys: ['y'],
    chords: letterChords(['y']),
    label: 'copy a bsky.app link to the post',
  },
  {
    id: 'card-video',
    scope: 'card',
    keys: ['v'],
    chords: letterChords(['v']),
    label: 'play the focused post video inline',
  },
  {
    id: 'card-media',
    scope: 'card',
    keys: ['m'],
    chords: letterChords(['m']),
    label: 'open media when present',
  },
  {
    id: 'card-quoted',
    scope: 'card',
    keys: ['o'],
    chords: letterChords(['o']),
    label: 'open the quoted post when present',
    aliases: [{ display: '0', chord: { key: '0', shift: false } }],
  },
  {
    id: 'card-reveal',
    scope: 'card',
    keys: ['x'],
    chords: letterChords(['x']),
    label: 'reveal labelled media while focused',
  },
  {
    id: 'card-delete',
    scope: 'card',
    keys: ['d d', 'd enter'],
    chords: letterChords(['d']),
    label: 'delete your own post; press d again or enter to confirm',
  },
  {
    id: 'card-more',
    scope: 'card',
    keys: ['+'],
    chords: [{ key: '+' }],
    label: 'show more posts like this',
  },
  {
    id: 'card-fewer',
    scope: 'card',
    keys: ['-'],
    chords: [{ key: '-', shift: false }],
    label: 'show fewer posts like this',
  },

  // thread
  {
    id: 'thread-move',
    scope: 'thread',
    keys: ['j'],
    chords: letterChords(['j']),
    label: 'move to the next reply in reading order',
  },
  {
    id: 'thread-child',
    scope: 'thread',
    keys: ['↓'],
    chords: [{ key: 'ArrowDown', shift: false }],
    label: 'move down to the next visible reply, child first',
  },
  {
    id: 'thread-previous',
    scope: 'thread',
    keys: ['k'],
    chords: letterChords(['k']),
    label: 'move to the previous reply or back to the opened post',
  },
  {
    id: 'thread-up',
    scope: 'thread',
    keys: ['↑'],
    chords: [{ key: 'ArrowUp', shift: false }],
    label: 'move to the parent reply; at the opened post open its parent thread',
  },
  {
    id: 'thread-ends',
    scope: 'thread',
    keys: ['Home', 'End'],
    chords: [
      { key: 'Home', shift: false },
      { key: 'End', shift: false },
    ],
    label: 'jump to the first or last reply',
  },
  {
    id: 'thread-position',
    scope: 'thread',
    keys: ['1-9'],
    chords: digitChords(),
    label: 'focus a reply by position',
  },
  {
    id: 'thread-open',
    scope: 'thread',
    keys: ['enter'],
    chords: [{ key: 'Enter', shift: false }],
    label: 'open the focused reply as its own thread',
  },
  {
    id: 'thread-parent',
    scope: 'thread',
    keys: ['p'],
    chords: letterChords(['p']),
    label: 'open the parent post',
  },
  {
    id: 'thread-leave',
    scope: 'thread',
    keys: ['←'],
    chords: [{ key: 'ArrowLeft', shift: false }],
    label: 'leave the thread and go back',
  },
  {
    id: 'thread-scroll',
    scope: 'thread',
    keys: ['pgup', 'pgdn', 'shift ↑', 'shift ↓'],
    chords: [
      { key: 'PageUp' },
      { key: 'PageDown' },
      { key: 'ArrowUp', shift: true },
      { key: 'ArrowDown', shift: true },
    ],
    label: 'scroll the thread',
  },

  // compose
  {
    id: 'compose-send',
    scope: 'compose',
    keys: ['ctrl/cmd enter'],
    chords: [{ key: 'Enter', ctrlOrMeta: true, shift: false }],
    label: 'send from the composer',
  },
  {
    id: 'compose-suggest',
    scope: 'compose',
    keys: ['↑', '↓'],
    chords: [
      { key: 'ArrowUp', shift: false },
      { key: 'ArrowDown', shift: false },
    ],
    label: 'move through the suggestions',
  },
  {
    id: 'compose-accept',
    scope: 'compose',
    keys: ['enter', 'tab'],
    chords: [
      { key: 'Enter', shift: false },
      { key: 'Tab', shift: false },
    ],
    label: 'apply the selected suggestion',
  },
  {
    id: 'compose-dismiss',
    scope: 'compose',
    keys: ['esc'],
    chords: [{ key: 'Escape', shift: false }],
    label: 'dismiss the suggestions, then close the composer',
  },

  // palette
  {
    id: 'palette-move',
    scope: 'palette',
    keys: ['↑', '↓', 'ctrl p', 'ctrl n', 'pgup', 'pgdn', 'Home', 'End'],
    chords: [
      { key: 'ArrowUp', shift: false },
      { key: 'ArrowDown', shift: false },
      { key: 'p', ctrlOrMeta: true, shift: false },
      { key: 'n', ctrlOrMeta: true, shift: false },
      { key: 'PageUp' },
      { key: 'PageDown' },
      { key: 'Home', shift: false },
      { key: 'End', shift: false },
    ],
    label: 'move through the results',
  },
  {
    id: 'palette-run',
    scope: 'palette',
    keys: ['enter'],
    chords: [{ key: 'Enter', shift: false }],
    label: 'run the selected command',
  },
  {
    id: 'palette-close',
    scope: 'palette',
    keys: ['esc'],
    chords: [{ key: 'Escape', shift: false }],
    label: 'close the palette',
  },

  // dialog
  {
    id: 'dialog-search',
    scope: 'dialog',
    keys: ['/'],
    chords: [{ key: '/', shift: false }],
    label: 'focus the search field of this dialog',
  },
  {
    id: 'dialog-close',
    scope: 'dialog',
    keys: [','],
    chords: [{ key: ',', shift: false }],
    label: 'close settings',
  },

  // media viewer
  {
    id: 'media-close',
    scope: 'media',
    keys: ['esc'],
    chords: [{ key: 'Escape', shift: false }],
    label: 'close the viewer',
  },
  {
    id: 'media-move',
    scope: 'media',
    keys: ['←', '→', 'j', 'k'],
    chords: [
      { key: 'ArrowLeft', shift: false },
      { key: 'ArrowRight', shift: false },
      ...letterChords(['j', 'k']),
    ],
    label: 'show the previous or next image',
  },
  {
    id: 'media-ends',
    scope: 'media',
    keys: ['Home', 'End'],
    chords: [
      { key: 'Home', shift: false },
      { key: 'End', shift: false },
    ],
    label: 'jump to the first or last image',
  },
  {
    id: 'media-position',
    scope: 'media',
    keys: ['1-9'],
    chords: digitChords(),
    label: 'show an image by position',
  },
]

export function bindingsForScope(scope: KeyScope): readonly KeyBinding[] {
  return KEY_BINDINGS.filter((binding) => binding.scope === scope)
}

export function bindingFor(id: string): KeyBinding {
  const binding = KEY_BINDINGS.find((candidate) => candidate.id === id)
  if (binding === undefined) throw new Error(`unknown key binding: ${id}`)
  return binding
}

/** Every chord a binding matches on: its own chords plus its aliases. */
export function chordsOf(binding: KeyBinding): readonly KeyChord[] {
  return binding.aliases === undefined
    ? binding.chords
    : [...binding.chords, ...binding.aliases.map((alias) => alias.chord)]
}

/** Everything the help dialog and key badges print for a binding. */
export function displayKeys(binding: KeyBinding): readonly string[] {
  return binding.aliases === undefined
    ? binding.keys
    : [...binding.keys, ...binding.aliases.map((alias) => alias.display)]
}

export function matchesChord(
  event: KeyEventLike,
  chord: KeyChord,
  primary: PrimaryModifier = 'ctrl',
): boolean {
  if (event.key !== chord.key) return false
  if (chord.primary === true) {
    if (primary === 'meta') {
      if (!event.metaKey || event.ctrlKey) return false
    } else if (!event.ctrlKey || event.metaKey) {
      return false
    }
  } else if (chord.ctrlOrMeta === true) {
    if (!event.ctrlKey && !event.metaKey) return false
  } else if (event.ctrlKey || event.metaKey) {
    return false
  }
  if ((chord.alt ?? false) !== event.altKey) return false
  if (chord.shift !== undefined && chord.shift !== event.shiftKey) return false
  return true
}

export function matchesBinding(
  event: KeyEventLike,
  binding: KeyBinding,
  primary: PrimaryModifier = 'ctrl',
): boolean {
  return chordsOf(binding).some((chord) => matchesChord(event, chord, primary))
}

/** Stable identity for a chord, used by the registry invariants. */
export function chordSignature(chord: KeyChord): string {
  return [
    chord.key,
    chord.ctrlOrMeta === true ? 'ctrlOrMeta' : '',
    chord.primary === true ? 'primary' : '',
    chord.shift === true ? 'shift' : chord.shift === false ? 'noShift' : '',
    chord.alt === true ? 'alt' : '',
  ].join('|')
}

/**
 * The global bindings `useHotkeys` consumes, paired with their handlers.
 * Actions without a handler (the palette toggle, tab cycling) are owned by
 * dedicated listeners in App and skipped here.
 */
export function globalHotkeys(
  handlers: Readonly<Record<string, (() => void) | undefined>>,
): HotkeyBinding[] {
  const hotkeys: HotkeyBinding[] = []
  for (const binding of bindingsForScope('global')) {
    const handler = handlers[binding.id]
    if (handler === undefined) continue
    for (const chord of chordsOf(binding)) {
      if (chord.primary === true) continue
      hotkeys.push(
        chord.ctrlOrMeta === true
          ? { key: chord.key, ctrlOrMeta: true, handler }
          : { key: chord.key, handler },
      )
    }
  }
  return hotkeys
}

const PRINTABLE = /^[\x20-\x7e]$/

function isCharacterChord(chord: KeyChord): boolean {
  if (!PRINTABLE.test(chord.key)) return false
  if (chord.ctrlOrMeta === true || chord.primary === true || chord.alt === true) return false
  return true
}

const characterChords = KEY_BINDINGS.flatMap((binding) =>
  chordsOf(binding).filter(isCharacterChord),
)

/**
 * Single printable keys that the setting can switch off (WCAG 2.1.4). Every
 * bare printable chord is listed, including the `?` `/` `R` `,` anchors: the
 * opt-out is complete, and only modifier chords and non-character navigation
 * keys stay available while it is off.
 */
export const characterShortcuts: readonly string[] = [
  ...new Set(characterChords.map((chord) => chord.key)),
]

const CHARACTER_SHORTCUT_SET: ReadonlySet<string> = new Set(characterShortcuts)

/** The part of a keyboard event the character-shortcut guard reads. */
export type CharacterShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>

/**
 * Whether a keydown may act as a shortcut given the keyboard-shortcuts setting.
 *
 * Modifier chords stay available when bare character shortcuts are off: they
 * carry ctrl, meta or alt, so they are not the WCAG 2.1.4 single-character
 * case. With shortcuts disabled, a key that has no modifier and does belong to
 * `characterShortcuts` is rejected. Non-character keys (arrows, Enter, Escape,
 * Tab, function keys) are never affected. Shift is deliberately not consulted:
 * `G` and `R` are their own character shortcuts.
 *
 * Pure decision: handlers own the event, this only answers yes or no.
 */
export function characterShortcutAllowed(enabled: boolean, event: CharacterShortcutEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return true
  if (enabled) return true
  return !CHARACTER_SHORTCUT_SET.has(event.key)
}
