import { RichText } from '@atproto/api'
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
import { createPost, createQuote, createReply } from '../lib/actions'
import { useAuthStore } from '../lib/auth'
import { clearDraft, draftKeyFor, readDraft, writeDraft } from '../lib/drafts'
import { errorInfo } from '../lib/errors'
import { graphemes } from '../lib/graphemes'
import { bindingFor, matchesBinding } from '../lib/keymap'
import { markdownText } from '../lib/markdown'
import { invalidateNonFeedQueries } from '../lib/queries'
import type { PostModel } from '../lib/types'
import { type ComposeMode, type ComposeRequest, useUiStore } from '../lib/ui'
import {
  insertSuggestion,
  type SuggestionToken,
  suggestionAt,
  useActorSuggestions,
} from './useActorSuggestions'
import { isImeComposing } from './useHotkeys'
import { useTagSuggestions } from './useTagSuggestions'

export const MAX_GRAPHEMES = 300
const EXCERPT_LENGTH = 120
const SAVE_DELAY = 250

// the composer reads its own chords from the registry so the keys it claims
// and the hints it prints can never disagree
const SEND = bindingFor('compose-send')
const SUGGEST = bindingFor('compose-suggest')
const ACCEPT = bindingFor('compose-accept')
const DISMISS = bindingFor('compose-dismiss')

const PLACEHOLDERS: Record<ComposeMode, string> = {
  post: 'write a post',
  reply: 'write a reply',
  quote: 'add a comment, optional',
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

export interface ComposeSuggestion {
  key: string
  value: string
  label: string
  detail: string
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
  describedBy: string
  invalid: boolean
  limitStatus: string
  token: SuggestionToken | null
  suggestions: ComposeSuggestion[]
  suggestionsPending: boolean
  showSuggestions: boolean
  activeSuggestion: number
  count: number
  overLimit: boolean
  disabled: boolean
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
 * One open composition owns its draft key, latest text and revision. The
 * object stays behind after the UI closes so a send that finishes late can
 * only clear the exact draft it wrote.
 */
interface Composition {
  key: string | null
  request: ComposeRequest | null
  text: string
  revision: string | null
  closed: boolean
  submitted: boolean
  timer: number | null
}

function flushComposition(composition: Composition): void {
  if (composition.closed || composition.submitted) return
  if (composition.key === null) return
  composition.revision = writeDraft(composition.key, composition.text)
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
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const [limitStatus, setLimitStatus] = useState('')
  const wasOverLimit = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formId = useId()
  const listboxId = useId()
  const countId = useId()
  const errorId = useId()
  const compositionRef = useRef<Composition | null>(null)
  const draftKey =
    request === null ? null : draftKeyFor(request.mode, request.post?.uri ?? null, accountDid)

  useEffect(() => {
    // whatever the previous request typed belongs to its own key, even when it
    // switches before the autosave delay elapses
    closeComposition(compositionRef.current)

    const nextText = open && draftKey !== null ? readDraft(draftKey) : ''
    const composition: Composition | null = open
      ? {
          key: draftKey,
          request,
          text: nextText,
          revision: null,
          closed: false,
          submitted: false,
          timer: null,
        }
      : null

    // claiming a fresh revision on open keeps a late send from clearing a
    // draft that was reopened after it, even with identical text
    if (composition !== null && composition.key !== null && nextText.trim().length > 0) {
      composition.revision = writeDraft(composition.key, nextText)
    }
    compositionRef.current = composition

    setText(nextText)
    setPending(false)
    setError(null)
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
        }))
      : token?.kind === 'mention' && token.query.length > 0
        ? actorSuggestions.suggestions.length > 0
          ? actorSuggestions.suggestions.map((actor) => ({
              key: actor.did,
              value: actor.handle,
              label: `@${actor.handle}`,
              detail: actor.displayName,
            }))
          : [
              {
                key: 'literal-handle',
                value: token.query,
                label: `@${token.query}`,
                detail: 'handle',
              },
            ]
        : []

  const suggestionsPending =
    token?.kind === 'tag' ? tagSuggestions.isPending : actorSuggestions.isPending
  const showSuggestions =
    !pending && token !== null && (suggestionsPending || suggestions.length > 0)
  const activeSuggestion =
    suggestions.length === 0 ? -1 : Math.min(selectedSuggestion, suggestions.length - 1)
  const plain = markdownText(text)
  const count = new RichText({ text: plain }).graphemeLength
  const empty = mode !== 'quote' && plain.trim().length === 0
  const overLimit = count > MAX_GRAPHEMES
  const missingTarget = mode !== 'post' && target === null
  const disabled = pending || empty || overLimit || missingTarget

  // the counter prints the number on every keystroke; only crossing the limit
  // is worth a spoken status, so the live region tracks the transition alone
  useEffect(() => {
    if (wasOverLimit.current === overLimit) return
    wasOverLimit.current = overLimit
    setLimitStatus(
      overLimit
        ? `over the ${MAX_GRAPHEMES} grapheme limit`
        : `within the ${MAX_GRAPHEMES} grapheme limit`,
    )
  }, [overLimit])

  const invalid = overLimit || error !== null
  const describedBy = error === null ? countId : `${countId} ${errorId}`

  const applySuggestion = (value: string) => {
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
    if (!showSuggestions) return

    const options = suggestions.length
    if (options > 0 && matchesBinding(native, SUGGEST)) {
      event.preventDefault()
      const step = native.key === 'ArrowDown' ? 1 : -1
      setSelectedSuggestion((index) => (index + step + options) % options)
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
      } else if (submittedRequest.mode === 'reply') {
        await createReply(sentText, submittedRequest.post)
      } else {
        await createQuote(sentText, submittedRequest.post)
      }

      composition.submitted = true
      if (composition.key !== null) {
        // only the exact revision this composition wrote may be cleared
        clearDraft(composition.key, composition.revision ?? '', sentText)
      }
      void invalidateNonFeedQueries(queryClient)

      active = owns()
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
    textareaRef,
    formId,
    listboxId,
    countId,
    errorId,
    describedBy,
    invalid,
    limitStatus,
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
