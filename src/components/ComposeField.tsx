import { useEffect, useRef } from 'react'
import { type ComposeFormState, composePlaceholder, MAX_GRAPHEMES } from '../hooks/useComposeForm'
import { bindingFor, displayKeys } from '../lib/keymap'
import { Button } from './ui'

const SEND_HINT = displayKeys(bindingFor('compose-send')).join(' ')

/** The single send hint, read from the registry key that runs it. */
export function ComposeHint() {
  return <span className="b-compose__hint">{SEND_HINT} send</span>
}

export interface ComposeHeadProps {
  label: string
  onClose: () => void
}

/**
 * The chrome both composers share. The dock sits inside a thread card, so it
 * cannot be a dialog, but it wears the dialog head classes: label, shortcut
 * hint and the close cross read as the same box in either placement.
 */
export function ComposeHead({ label, onClose }: ComposeHeadProps) {
  return (
    <header className="b-dialog__head">
      <h2 className="b-dialog__title">{label}</h2>
      <ComposeHint />
      <button
        type="button"
        className="b-dialog__close"
        aria-label={`close ${label}`}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
    </header>
  )
}

export interface ComposeActionsProps {
  form: ComposeFormState
  label: string
}

export interface ComposeTargetProps {
  form: Pick<ComposeFormState, 'mode' | 'target' | 'handle' | 'excerpt'>
}

/**
 * The target line both composers show above the field: which post is being
 * answered or quoted, and the excerpt that identifies it. A post composer has
 * no target and renders nothing.
 */
export function ComposeTarget({ form }: ComposeTargetProps) {
  if (form.mode === 'post' || form.target === null) return null

  return (
    <div className="b-compose__target">
      <span>
        {form.mode === 'reply' ? `replying to @${form.handle}` : `quoting @${form.handle}`}
      </span>
      {form.excerpt.length > 0 ? (
        <span className="b-compose__target-text">{form.excerpt}</span>
      ) : null}
    </div>
  )
}

/** Counter plus the send/cancel pair; the dialog renders it inside its foot. */
export function ComposeActions({ form, label }: ComposeActionsProps) {
  return (
    <div className="b-compose__actions">
      <span
        id={form.countId}
        className="b-compose__count"
        data-over={form.overLimit ? 'true' : 'false'}
      >
        {form.count}/{MAX_GRAPHEMES}
      </span>
      <Button variant="ghost" onClick={form.close}>
        {form.sent ? 'close' : 'cancel'}
      </Button>
      <Button type="submit" form={form.formId} variant="solid" disabled={form.disabled}>
        {form.sent ? 'sent' : label}
      </Button>
    </div>
  )
}

export interface ComposeFieldProps {
  form: ComposeFormState
  inputClassName: string
}

export function ComposeField({ form, inputClassName }: ComposeFieldProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const hasOptions = form.suggestions.length > 0
  // the popup only exists while it is actually painted, so the textarea never
  // names a listbox that the pending state or an empty query removed
  const listOpen = form.showSuggestions && hasOptions

  // the suggestion list scrolls itself so a tall wrapped option never drags
  // the dock or the dialog body with it
  useEffect(() => {
    const list = listRef.current
    if (list === null || form.activeSuggestion < 0) return
    const option = list.querySelectorAll('[role="option"]')[form.activeSuggestion]
    if (!(option instanceof HTMLElement)) return
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < list.scrollTop) {
      list.scrollTop = top
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight
    }
  }, [form.activeSuggestion, form.suggestions.length])

  return (
    <>
      <form id={form.formId} onSubmit={form.handleSubmit}>
        <textarea
          ref={form.textareaRef}
          className={inputClassName}
          aria-label={`compose ${form.mode}`}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listOpen ? form.listboxId : undefined}
          aria-activedescendant={
            listOpen && form.activeSuggestion >= 0
              ? `${form.listboxId}-option-${form.activeSuggestion}`
              : undefined
          }
          aria-describedby={form.describedBy}
          aria-invalid={form.invalid ? true : undefined}
          readOnly={form.pending || form.sent}
          placeholder={composePlaceholder(form.mode)}
          value={form.text}
          onChange={form.handleChange}
          onSelect={form.handleSelect}
          onKeyDown={form.handleKeyDown}
        />

        <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {form.limitStatus}
        </span>

        {form.showSuggestions ? (
          hasOptions ? (
            <div
              ref={listRef}
              id={form.listboxId}
              className="b-compose__suggestions"
              role="listbox"
              aria-label="suggestions"
            >
              {form.suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  id={`${form.listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
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
              ))}
            </div>
          ) : (
            <p className="b-compose__suggestion-note" role="status">
              searching
            </p>
          )
        ) : null}

        <div className="b-compose__meta">
          <span className="b-compose__markdown">
            markdown: **bold**, *italic*, ~~strike~~, `code`, [link](url) · @/# suggestions
          </span>
        </div>
      </form>

      {form.storageWarning === null ? null : (
        <p id={form.storageWarningId} className="b-compose__storage" role="status">
          {form.storageWarning}
        </p>
      )}

      {form.error !== null ? (
        <p id={form.errorId} className="b-compose__error" role="alert">
          {form.error}
        </p>
      ) : null}
    </>
  )
}
