import { RichText } from '@atproto/api'
import { useQueryClient } from '@tanstack/react-query'
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { markdownText } from '../lib/markdown'
import { invalidateNonFeedQueries } from '../lib/queries'
import type { ComposeMode, ComposeRequest } from '../lib/ui'
import { suggestionAt, useActorSuggestions } from './useActorSuggestions'
import { useTagSuggestions } from './useTagSuggestions'

export const MAX_GRAPHEMES = 300
const EXCERPT_LENGTH = 120

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
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 3)}...` : flat
}

export interface UseComposeFormOptions {
  open: boolean
  request: ComposeRequest | null
  onClose: () => void
}

export function useComposeForm({ open, request, onClose }: UseComposeFormOptions) {
  const queryClient = useQueryClient()
  const accountDid = useAuthStore((state) => state.account?.did ?? null)
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formId = useId()
  const listboxId = useId()
  const generationRef = useRef(0)
  const submittedRef = useRef(false)
  const draftKey =
    request === null ? null : draftKeyFor(request.mode, request.post?.uri ?? null, accountDid)

  useEffect(() => {
    generationRef.current += 1
    submittedRef.current = false
    const saved = draftKey === null ? '' : readDraft(draftKey)
    setText(saved)
    setPending(false)
    setError(null)
    setCursor(0)
    setSuggestOpen(false)
    setSelectedSuggestion(0)
    setCursor(saved.length)
  }, [open, request, draftKey])

  useEffect(() => {
    if (!open || draftKey === null) return
    const timer = window.setTimeout(() => {
      if (!submittedRef.current) writeDraft(draftKey, text)
    }, 250)
    return () => {
      window.clearTimeout(timer)
    }
  }, [open, draftKey, text])

  const close = () => {
    generationRef.current += 1
    if (draftKey !== null && !submittedRef.current) writeDraft(draftKey, text)
    setPending(false)
    onClose()
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
  const showSuggestions = token !== null && (suggestionsPending || suggestions.length > 0)
  const activeSuggestion =
    suggestions.length === 0 ? -1 : Math.min(selectedSuggestion, suggestions.length - 1)
  const plain = markdownText(text)
  const count = new RichText({ text: plain }).graphemeLength
  const empty = mode !== 'quote' && plain.trim().length === 0
  const overLimit = count > MAX_GRAPHEMES
  const missingTarget = mode !== 'post' && target === null
  const disabled = pending || empty || overLimit || missingTarget

  const applySuggestion = (value: string) => {
    const activeToken = suggestionAt(text, cursor)
    if (activeToken === null) return

    const inserted = `${activeToken.kind === 'tag' ? '#' : '@'}${value} `
    const token = activeToken
    const next = `${text.slice(0, token.start)}${inserted}${text.slice(token.end)}`
    const position = token.start + inserted.length
    setText(next)
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
    setText(next)
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
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
      return
    }
    if (!showSuggestions) return

    const count = suggestions.length
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault()
      setSelectedSuggestion((index) => (index + 1) % count)
      return
    }
    if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault()
      setSelectedSuggestion((index) => (index - 1 + count) % count)
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && count > 0) {
      event.preventDefault()
      const selected = suggestions[activeSuggestion]
      if (selected !== undefined) applySuggestion(selected.value)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setSuggestOpen(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (request === null || disabled) return

    const targetPost = request.post
    const generation = generationRef.current
    setPending(true)
    setError(null)

    try {
      if (request.mode === 'post') {
        await createPost(text)
      } else if (targetPost !== null) {
        if (request.mode === 'reply') {
          await createReply(text, targetPost)
        } else {
          await createQuote(text, targetPost)
        }
      } else {
        setError('no target post')
        setPending(false)
        return
      }

      if (generationRef.current !== generation) return

      submittedRef.current = true
      if (draftKey !== null) clearDraft(draftKey)

      // the selected appview may not have indexed the new record yet
      void invalidateNonFeedQueries(queryClient)
      onClose()
    } catch (caught) {
      if (generationRef.current !== generation) return
      setError(errorInfo(caught).detail)
    } finally {
      if (generationRef.current === generation) setPending(false)
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
