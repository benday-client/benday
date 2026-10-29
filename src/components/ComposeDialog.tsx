import { RichText } from '@atproto/api'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { mentionAt, useActorSuggestions } from '../hooks/useActorSuggestions'
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
  const [mentionOpen, setMentionOpen] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formId = useId()

  useEffect(() => {
    setText('')
    setPending(false)
    setError(null)
    setCursor(0)
    setMentionOpen(false)
    setSelectedSuggestion(0)
  }, [open, request])

  const mode: ComposeMode = request === null ? 'post' : request.mode
  const target = request === null ? null : request.post
  const mention = mentionOpen ? mentionAt(text, cursor) : null
  const actorSuggestions = useActorSuggestions(mention?.query ?? '', mention !== null)
  const showSuggestions =
    mention !== null && (actorSuggestions.isPending || actorSuggestions.suggestions.length > 0)
  const plain = markdownText(text)
  const count = new RichText({ text: plain }).graphemeLength
  const empty = mode !== 'quote' && plain.trim().length === 0
  const overLimit = count > MAX_GRAPHEMES
  const missingTarget = mode !== 'post' && target === null
  const disabled = pending || empty || overLimit || missingTarget

  const applySuggestion = (handle: string) => {
    const token = mentionAt(text, cursor)
    if (token === null) return

    const inserted = `@${handle} `
    const next = `${text.slice(0, token.start)}${inserted}${text.slice(token.end)}`
    const position = token.start + inserted.length
    setText(next)
    setCursor(position)
    setMentionOpen(false)
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

      // the selected appview may not have indexed the new record yet
      void queryClient.invalidateQueries()
      onClose()
    } catch (caught) {
      setError(errorInfo(caught).detail)
    } finally {
      setPending(false)
    }
  }

  if (request === null) {
    return (
      <Dialog open={false} title="compose" onClose={onClose}>
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
      onClose={onClose}
      className="b-compose"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
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
          aria-label="compose post"
          placeholder={PLACEHOLDERS[mode]}
          value={text}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value
            const position = event.target.selectionStart ?? next.length
            setText(next)
            setCursor(position)
            setMentionOpen(mentionAt(next, position) !== null)
            setSelectedSuggestion(0)
          }}
          onSelect={(event) => {
            const position = event.currentTarget.selectionStart ?? 0
            setCursor(position)
            setMentionOpen(mentionAt(text, position) !== null)
          }}
          onKeyDown={(event) => {
            if (!showSuggestions) return

            const count = actorSuggestions.suggestions.length
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
              const selected = actorSuggestions.suggestions[selectedSuggestion]
              if (selected !== undefined) applySuggestion(selected.handle)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMentionOpen(false)
            }
          }}
        />

        {mention !== null && showSuggestions ? (
          <div className="b-compose__suggestions" role="listbox" aria-label="mention suggestions">
            {actorSuggestions.isPending ? (
              <p className="b-compose__suggestion-note">searching handles</p>
            ) : (
              actorSuggestions.suggestions.map((actor, index) => (
                <button
                  key={actor.did}
                  type="button"
                  role="option"
                  aria-selected={index === selectedSuggestion}
                  className="b-compose__suggestion"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    applySuggestion(actor.handle)
                  }}
                >
                  <span>@{actor.handle}</span>
                  {actor.displayName.length > 0 ? <span>{actor.displayName}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : null}
        <div className="b-compose__meta">
          <span className="b-compose__markdown">
            markdown: **bold**, *italic*, ~~strike~~, `code`, [link](url)
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
