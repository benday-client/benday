import { useEffect } from 'react'
import { useComposeForm } from '../hooks/useComposeForm'
import { isImeComposing } from '../hooks/useHotkeys'
import type { ComposeRequest } from '../lib/ui'
import { ComposeActions, ComposeField, ComposeHead } from './ComposeField'

export interface InlineComposerProps {
  request: ComposeRequest
  onClose: () => void
}

export function InlineComposer({ request, onClose }: InlineComposerProps) {
  const form = useComposeForm({ open: true, request, onClose })

  useEffect(() => {
    form.textareaRef.current?.focus()
  }, [form.textareaRef])

  if (form.target === null) return null

  const action = request.mode === 'quote' ? 'quote' : 'reply'
  const placement = request.mode === 'quote' ? 'above' : 'below'

  return (
    <section
      className="b-compose-dock"
      data-mode={action}
      data-placement={placement}
      aria-label={`${action} composer`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        // an IME owns the key that commits its composition
        if (isImeComposing(event.nativeEvent)) return
        event.preventDefault()
        event.stopPropagation()
        form.close()
      }}
    >
      <ComposeHead label={action} onClose={form.close} />

      <div className="b-compose__target">
        <span>
          {action === 'reply' ? `replying to @${form.handle}` : `quoting @${form.handle}`}
        </span>
        {form.excerpt.length > 0 ? (
          <span className="b-compose__target-text">{form.excerpt}</span>
        ) : null}
      </div>

      <ComposeField form={form} inputClassName="b-compose__input b-compose-dock__input" />

      <ComposeActions form={form} label={action} />
    </section>
  )
}
