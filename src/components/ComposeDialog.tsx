import { RichText } from '@atproto/api'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { createPost, createQuote, createReply } from '../lib/actions'
import { errorInfo } from '../lib/errors'
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
  const formId = useId()

  useEffect(() => {
    setText('')
    setPending(false)
    setError(null)
  }, [open, request])

  const mode: ComposeMode = request === null ? 'post' : request.mode
  const target = request === null ? null : request.post
  const count = new RichText({ text }).graphemeLength
  const empty = mode !== 'quote' && text.trim().length === 0
  const overLimit = count > MAX_GRAPHEMES
  const missingTarget = mode !== 'post' && target === null
  const disabled = pending || empty || overLimit || missingTarget

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
          className="b-compose__input"
          aria-label="compose post"
          placeholder={PLACEHOLDERS[mode]}
          value={text}
          disabled={pending}
          onChange={(event) => {
            setText(event.target.value)
          }}
        />
        <div className="b-compose__meta">
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
