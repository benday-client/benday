import { composePlaceholder, MAX_GRAPHEMES, useComposeForm } from '../hooks/useComposeForm'
import type { ComposeRequest } from '../lib/ui'
import { Button, Dialog } from './ui'

export interface ComposeDialogProps {
  open: boolean
  request: ComposeRequest | null
  onClose: () => void
}

export function ComposeDialog({ open, request, onClose }: ComposeDialogProps) {
  const form = useComposeForm({ open, request, onClose })

  if (request === null) {
    return (
      <Dialog open={false} title="compose" onClose={form.close}>
        {null}
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      title={form.mode === 'post' ? 'compose' : form.mode}
      onClose={form.close}
      className="b-compose"
      footer={
        <>
          <Button variant="ghost" onClick={form.close}>
            cancel
          </Button>
          <Button type="submit" form={form.formId} variant="solid" disabled={form.disabled}>
            {form.mode}
          </Button>
        </>
      }
    >
      {form.mode !== 'post' && form.target !== null ? (
        <div className="b-compose__target">
          <span>
            {form.mode === 'reply' ? `replying to @${form.handle}` : `quoting @${form.handle}`}
          </span>
          {form.excerpt.length > 0 ? (
            <span className="b-compose__target-text">{form.excerpt}</span>
          ) : null}
        </div>
      ) : null}

      <form id={form.formId} onSubmit={form.handleSubmit}>
        <textarea
          ref={form.textareaRef}
          className="b-compose__input"
          role="combobox"
          aria-label="compose post"
          aria-expanded={form.showSuggestions}
          aria-autocomplete="list"
          aria-controls={form.showSuggestions ? form.listboxId : undefined}
          aria-activedescendant={
            form.showSuggestions && form.activeSuggestion >= 0
              ? `${form.listboxId}-option-${form.activeSuggestion}`
              : undefined
          }
          placeholder={composePlaceholder(form.mode)}
          value={form.text}
          disabled={form.pending}
          onChange={form.handleChange}
          onSelect={form.handleSelect}
          onKeyDown={form.handleKeyDown}
        />

        {form.token !== null && form.showSuggestions ? (
          <div
            id={form.listboxId}
            className="b-compose__suggestions"
            role="listbox"
            aria-label="suggestions"
          >
            {form.suggestionsPending && form.suggestions.length === 0 ? (
              <p className="b-compose__suggestion-note">searching</p>
            ) : (
              form.suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  id={`${form.listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === form.activeSuggestion}
                  className="b-compose__suggestion"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    form.applySuggestion(suggestion.value)
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
          <span className="b-compose__count" data-over={form.overLimit ? 'true' : 'false'}>
            {form.count}/{MAX_GRAPHEMES}
          </span>
        </div>
      </form>

      {form.error !== null ? (
        <p className="b-compose__error" role="alert">
          {form.error}
        </p>
      ) : null}
    </Dialog>
  )
}
