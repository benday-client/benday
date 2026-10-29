import { RichText } from '@atproto/api'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { suggestionAt, useActorSuggestions } from '../hooks/useActorSuggestions'
import { useTagSuggestions } from '../hooks/useTagSuggestions'
import { createPost, createQuote, createReply } from '../lib/actions'
import { errorInfo } from '../lib/errors'
import { markdownText } from '../lib/markdown'
import type { ComposeMode, ComposeRequest } from '../lib/ui'
import { Button, Dialog } from './ui'

export interface ComposeDialogProps {
  open: boolean
  request: ComposeRequest | null
  onClose: () => void
}

const MAX_GRAPHEMES = 300
const EXCERPT_LENGTH = 120

const PLACEHOLDERS: Record<ComposeMode, string> = {
  post: 'what are you posting',
  reply: 'write a reply',
  quote: 'add a comment, optional',
}

function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 3)}...` : flat
}

export function ComposeDialog({ open, request, onClose }: ComposeDialogProps) {
  const queryClient = useQueryClient()
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

  useEffect(() => {
    generationRef.current += 1
    setText('')
    setPending(false)
    setError(null)
    setCursor(0)
    setSuggestOpen(false)
    setSelectedSuggestion(0)
  }, [open, request])

  const close = () => {
    generationRef.current += 1
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

      // the selected appview may not have indexed the new record yet
      void queryClient.invalidateQueries()
      onClose()
    } catch (caught) {
      if (generationRef.current !== generation) return
      setError(errorInfo(caught).detail)
    } finally {
      if (generationRef.current === generation) setPending(false)
    }
  }

  if (request === null) {
    return (
      <Dialog open={false} title="compose" onClose={close}>
        {null}
      </Dialog>
    )
  }

  const handle =
    target !== null && target.author.handle.length > 0 ? target.author.handle : 'unknown'
  const excerpt = target === null ? '' : excerptOf(target.text)

  return (
    <Dialog
      open={open}
      title={mode === 'post' ? 'compose' : mode}
      onClose={close}
      className="b-compose"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            cancel
          </Button>
          <Button type="submit" form={formId} variant="solid" disabled={disabled}>
            {mode}
          </Button>
        </>
      }
    >
      {mode !== 'post' && target !== null ? (
        <div className="b-compose__target">
          <span>{mode === 'reply' ? `replying to @${handle}` : `quoting @${handle}`}</span>
          {excerpt.length > 0 ? <span className="b-compose__target-text">{excerpt}</span> : null}
        </div>
      ) : null}

      <form id={formId} onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="b-compose__input"
          role="combobox"
          aria-label="compose post"
          aria-expanded={showSuggestions}
          aria-autocomplete="list"
          aria-controls={showSuggestions ? listboxId : undefined}
          aria-activedescendant={
            showSuggestions && activeSuggestion >= 0
              ? `${listboxId}-option-${activeSuggestion}`
              : undefined
          }
          placeholder={PLACEHOLDERS[mode]}
          value={text}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value
            const position = event.target.selectionStart ?? next.length
            setText(next)
            setCursor(position)
            setSuggestOpen(suggestionAt(next, position) !== null)
            setSelectedSuggestion(0)
          }}
          onSelect={(event) => {
            const position = event.currentTarget.selectionStart ?? 0
            setCursor(position)
            setSuggestOpen(suggestionAt(text, position) !== null)
          }}
          onKeyDown={(event) => {
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
          }}
        />

        {token !== null && showSuggestions ? (
          <div
            id={listboxId}
            className="b-compose__suggestions"
            role="listbox"
            aria-label="suggestions"
          >
            {suggestionsPending && suggestions.length === 0 ? (
              <p className="b-compose__suggestion-note">searching</p>
            ) : (
              suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeSuggestion}
                  className="b-compose__suggestion"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    applySuggestion(suggestion.value)
                  }}
                >
                  <span>{suggestion.label}</span>
                  {suggestion.detail.length > 0 ? <span>{suggestion.detail}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : null}
        <div className="b-compose__meta">
          <span className="b-compose__markdown">
            markdown: **bold**, *italic*, ~~strike~~, `code`, [link](url) · @/# suggestions
          </span>
          <span className="b-compose__count" data-over={overLimit ? 'true' : 'false'}>
            {count}/{MAX_GRAPHEMES}
          </span>
        </div>
      </form>

      {error !== null ? (
        <p className="b-compose__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
