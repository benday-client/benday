import { useQueryClient } from '@tanstack/react-query'
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPost, createReply } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { clearDraft, draftKeyFor, readDraft, writeDraft } from '../lib/drafts'
import { errorInfo } from '../lib/errors'
import { graphemes } from '../lib/graphemes'
import { bindingFor, matchesBinding } from '../lib/keymap'
import { markdownText } from '../lib/markdown'
import { measurePost, postLimitError } from '../lib/postLimits'
import { invalidateNonFeedQueries } from '../lib/queries'
import type { PostModel } from '../lib/types'
import { type ComposeMode, type ComposeRequest, useUiStore } from '../lib/ui'
import {
  buildSuggestions,
  insertSuggestion,
  type SuggestionItem,
  type SuggestionToken,
  suggestionAt,
  useActorSuggestions,
} from './useActorSuggestions'
import { isImeComposing } from './useHotkeys'

const EXCERPT_LENGTH = 120
const SAVE_DELAY = 250
// the draft never claims durability it does not have
const STORAGE_WARNING = 'draft storage unavailable · keep a copy before closing'
const SENT_WARNING = 'post sent · stored draft could not be cleared'

// the composer reads its own chords from the registry so the keys it claims
// and the hints it prints can never disagree
const SEND = bindingFor('compose-send')
const SUGGEST = bindingFor('compose-suggest')
const ACCEPT = bindingFor('compose-accept')
const DISMISS = bindingFor('compose-dismiss')

const PLACEHOLDERS: Record<ComposeMode, string> = {
  post: 'write a post',
  reply: 'write a reply',
}

export function composePlaceholder(mode: ComposeMode): string {
  return PLACEHOLDERS[mode]
}

function composeExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= EXCERPT_LENGTH) return flat

  let excerpt = ''
  for (const { segment } of graphemes.segment(flat)) {
    if (excerpt.length + segment.length > EXCERPT_LENGTH - 3) break
    excerpt += segment
  }
  return `${excerpt}...`
}

export interface ComposeFormState {
  mode: ComposeMode
  target: PostModel | null
  handle: string
  excerpt: string
  text: string
  pending: boolean
  error: string | null
  textareaRef: RefObject<HTMLTextAreaElement | null>
  formId: string
  listboxId: string
  countId: string
  errorId: string
  limitErrorId: string
  describedBy: string
  invalid: boolean
  limitStatus: string
  limitError: string | null
  token: SuggestionToken | null
  suggestions: SuggestionItem[]
  suggestionsPending: boolean
  showSuggestions: boolean
  activeSuggestion: number
  count: number
  overLimit: boolean
  disabled: boolean
  sent: boolean
  storageWarning: string | null
  storageWarningId: string
  applySuggestion: (value: string) => void
  handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  handleSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void
  handleKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void
  close: () => void
}

export interface UseComposeFormOptions {
  open: boolean
  request: ComposeRequest | null
  onClose: () => void
}

/**
 * One open composition owns its draft key, latest text and the exact snapshot
 * it last wrote. The object stays behind after the UI closes so a send that
 * finishes late can only clear the draft it actually owns.
 */
interface Composition {
  key: string | null
  request: ComposeRequest | null
  text: string
  // the record this composition last wrote successfully
  saved: { revision: string; text: string } | null
  // what was on disk when it opened, kept even when a later claim fails
  readSnapshot: { revision: string | null; text: string } | null
  // false when the store could not be read at all
  readAvailable: boolean
  closed: boolean
  submitted: boolean
  timer: number | null
  // reports a write outcome to the surface that still owns this composition
  report: (ok: boolean) => void
}

function flushComposition(composition: Composition): void {
  if (composition.closed || composition.submitted) return
  if (composition.key === null) return

  const result = writeDraft(composition.key, composition.text)
  if (!result.ok) {
    composition.report(false)
    return
  }

  composition.readAvailable = true
  // a failed write preserves the older snapshot; an accepted deletion clears it
  composition.saved =
    result.revision === null ? null : { revision: result.revision, text: composition.text }
  composition.report(true)
}

function closeComposition(composition: Composition | null): void {
  if (composition === null || composition.closed) return
  if (composition.timer !== null) {
    window.clearTimeout(composition.timer)
    composition.timer = null
  }
  flushComposition(composition)
  composition.closed = true
}

function scheduleSave(composition: Composition | null): void {
  if (composition === null || composition.closed || composition.submitted) return
  if (composition.key === null) return
  if (composition.timer !== null) window.clearTimeout(composition.timer)
  composition.timer = window.setTimeout(() => {
    composition.timer = null
    flushComposition(composition)
  }, SAVE_DELAY)
}

export function useComposeForm({
  open,
  request,
  onClose,
}: UseComposeFormOptions): ComposeFormState {
  const queryClient = useQueryClient()
  const accountDid = useAuthStore((state) => state.account?.did ?? null)
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [sent, setSent] = useState(false)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const [limitStatus, setLimitStatus] = useState('')
  const wasOverLimit = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formId = useId()
  const listboxId = useId()
  const countId = useId()
  const errorId = useId()
  const limitErrorId = useId()
  const storageWarningId = useId()
  const compositionRef = useRef<Composition | null>(null)
  const draftKey =
    request === null || accountDid === null
      ? null
      : draftKeyFor(request.mode, request.post?.uri ?? null, accountDid)

  useEffect(() => {
    // whatever the previous request typed belongs to its own key, even when it
    // switches before the autosave delay elapses
    closeComposition(compositionRef.current)

    const draft = open && draftKey !== null ? readDraft(draftKey) : null
    const nextText = draft?.text ?? ''
    const composition: Composition | null = open
      ? {
          key: draftKey,
          request,
          text: nextText,
          saved: null,
          readSnapshot:
            draft?.available === true && nextText.trim().length > 0
              ? { revision: draft.revision, text: nextText }
              : null,
          readAvailable: draft === null || draft.available,
          closed: false,
          submitted: false,
          timer: null,
          report: () => undefined,
        }
      : null

    let warning: string | null = null
    if (composition !== null && draft !== null) {
      const owner = composition
      // only the composition still on screen may say anything about storage
      owner.report = (ok) => {
        if (compositionRef.current !== owner || owner.closed) return
        setStorageWarning(ok ? null : STORAGE_WARNING)
      }
      if (!draft.available) warning = STORAGE_WARNING

      // claiming a fresh revision on open keeps a late send from clearing a
      // draft that was reopened after it, even with identical text; a failed
      // claim keeps the read snapshot as the pair cleanup may clear later
      if (owner.key !== null && owner.readSnapshot !== null) {
        const claimed = writeDraft(owner.key, owner.text)
        if (claimed.ok) {
          owner.readAvailable = true
          owner.saved =
            claimed.revision === null ? null : { revision: claimed.revision, text: owner.text }
        } else {
          warning = STORAGE_WARNING
        }
      }
    }
    compositionRef.current = composition

    setText(nextText)
    setPending(false)
    setSent(false)
    setError(null)
    setStorageWarning(warning)
    setCursor(nextText.length)
    setSuggestOpen(false)
    setSelectedSuggestion(0)
    setLimitStatus('')
    wasOverLimit.current = false
  }, [open, request, draftKey])

  useEffect(() => {
    return () => {
      closeComposition(compositionRef.current)
    }
  }, [])

  const close = () => {
    closeComposition(compositionRef.current)
    setPending(false)
    onClose()
  }

  const updateText = (next: string) => {
    const composition = compositionRef.current
    if (composition !== null) composition.text = next
    setText(next)
    scheduleSave(composition)
  }

  const mode: ComposeMode = request === null ? 'post' : request.mode
  const target = request === null ? null : request.post
  const token = suggestOpen ? suggestionAt(text, cursor) : null
  const actorSuggestions = useActorSuggestions(token?.query ?? '', token !== null)
  const suggestions = buildSuggestions(token, actorSuggestions.suggestions)
  const suggestionsPending = actorSuggestions.isPending
  const showSuggestions =
    !pending && !sent && token !== null && (suggestionsPending || suggestions.length > 0)
  const activeSuggestion =
    suggestions.length === 0 ? -1 : Math.min(selectedSuggestion, suggestions.length - 1)
  const plain = markdownText(text)
  const limits = measurePost(plain)
  const count = limits.graphemes
  const limitError = postLimitError(limits)
  const empty = plain.trim().length === 0
  const overLimit = limitError !== null
  const missingTarget = mode !== 'post' && target === null
  const disabled = pending || sent || empty || overLimit || missingTarget

  // the counter prints the number on every keystroke; only crossing the limit
  // is worth a spoken status, so the live region tracks the transition alone
  useEffect(() => {
    if (wasOverLimit.current === overLimit) return
    wasOverLimit.current = overLimit
    setLimitStatus(overLimit ? (limitError ?? '') : 'within the post limit')
  }, [overLimit, limitError])

  const invalid = overLimit || error !== null
  const describedBy = [
    countId,
    limitError === null ? null : limitErrorId,
    error === null ? null : errorId,
    storageWarning === null ? null : storageWarningId,
  ]
    .filter((id): id is string => id !== null)
    .join(' ')

  const applySuggestion = (value: string) => {
    if (sent) return
    const activeToken = suggestionAt(text, cursor)
    if (activeToken === null) return

    const inserted = insertSuggestion(text, activeToken, value)
    const position = inserted.cursor
    updateText(inserted.text)
    setCursor(position)
    setSuggestOpen(false)
    setSelectedSuggestion(0)

    window.requestAnimationFrame(() => {
      const input = textareaRef.current
      if (input === null) return
      input.focus()
      input.setSelectionRange(position, position)
    })
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    // the read-only editor after a send may keep its native selection, not its
    // text changes
    if (sent) return
    const next = event.target.value
    const position = event.target.selectionStart ?? next.length
    updateText(next)
    setCursor(position)
    setSuggestOpen(suggestionAt(next, position) !== null)
    setSelectedSuggestion(0)
  }

  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const position = event.currentTarget.selectionStart ?? 0
    setCursor(position)
    setSuggestOpen(suggestionAt(text, position) !== null)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // an IME owns every key while it composes, including the one that commits
    if (isImeComposing(event.nativeEvent)) return
    if (pending) return

    const native = event.nativeEvent
    if (matchesBinding(native, SEND)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
      return
    }
    if (sent) return
    if (!showSuggestions) return

    const options = suggestions.length
    if (options > 0 && matchesBinding(native, SUGGEST)) {
      event.preventDefault()
      // step from the row the reader can see: a stale raw index from a longer
      // list would wrap from a position that is no longer highlighted
      const step = native.key === 'ArrowDown' ? 1 : -1
      setSelectedSuggestion((activeSuggestion + step + options) % options)
      return
    }
    if (options > 0 && matchesBinding(native, ACCEPT)) {
      event.preventDefault()
      const selected = suggestions[activeSuggestion]
      if (selected !== undefined) applySuggestion(selected.value)
      return
    }
    if (matchesBinding(native, DISMISS)) {
      event.preventDefault()
      setSuggestOpen(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const composition = compositionRef.current
    if (request === null || disabled || composition === null) return
    // a form submit is not the only path here; a sent composition never sends
    // a second post even when its primary action is disabled
    if (composition.submitted) return

    const submittedRequest = request
    const sentText = composition.text

    if (composition.timer !== null) {
      window.clearTimeout(composition.timer)
      composition.timer = null
    }
    flushComposition(composition)
    // the editor stays the focused, read-only surface while the send is in
    // flight, so a pointer submit does not drop the caret to the document
    textareaRef.current?.focus()
    setPending(true)
    setError(null)

    const owns = () =>
      !composition.closed &&
      compositionRef.current === composition &&
      (useUiStore.getState().compose === submittedRequest ||
        useUiStore.getState().inlineCompose === submittedRequest)

    let active = true
    try {
      if (submittedRequest.mode === 'post') {
        await createPost(sentText)
      } else if (submittedRequest.post === null) {
        setError('no target post')
        return
      } else {
        await createReply(sentText, submittedRequest.post)
      }

      // the post exists now: nothing from here may send it again, and the
      // server-derived reads are refreshed whether or not the UI survives
      composition.submitted = true
      void invalidateNonFeedQueries(queryClient)

      // clear the exact snapshot this composition owns. The text that was sent
      // is not the same thing: an older autosave may carry a different body,
      // and a failed opening claim leaves only its read snapshot behind.
      const snapshot = composition.saved ?? composition.readSnapshot
      let cleared = false
      if (composition.key === null) {
        cleared = true
      } else if (snapshot !== null) {
        cleared = clearDraft(composition.key, snapshot.revision, snapshot.text)
      } else {
        // no record was ever visible, which only proves there is none when the
        // opening read could actually reach storage
        cleared = composition.readAvailable
      }

      active = owns()
      if (!cleared) {
        if (active) {
          setSent(true)
          setStorageWarning(SENT_WARNING)
        }
        return
      }
      if (active) onClose()
    } catch (caught) {
      active = owns()
      if (active) setError(errorInfo(caught).detail)
    } finally {
      if (active) setPending(false)
    }
  }

  const handle =
    target !== null && target.author.handle.length > 0 ? target.author.handle : 'unknown'
  const excerpt = target === null ? '' : composeExcerpt(target.text)

  return {
    mode,
    target,
    handle,
    excerpt,
    text,
    pending,
    error,
    sent,
    storageWarning,
    storageWarningId,
    textareaRef,
    formId,
    listboxId,
    countId,
    errorId,
    limitErrorId,
    describedBy,
    invalid,
    limitStatus,
    limitError,
    token,
    suggestions,
    suggestionsPending,
    showSuggestions,
    activeSuggestion,
    count,
    overLimit,
    disabled,
    applySuggestion,
    handleChange,
    handleSelect,
    handleKeyDown,
    handleSubmit,
    close,
  }
}
