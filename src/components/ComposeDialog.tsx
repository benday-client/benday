import { useComposeForm } from '../hooks/useComposeForm'
import type { ComposeRequest } from '../lib/ui'
import { ComposeActions, ComposeField, ComposeHint } from './ComposeField'
import { Dialog } from './ui'

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
      headerClose
      headExtra={<ComposeHint />}
      footer={<ComposeActions form={form} label={form.mode} />}
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

      <ComposeField form={form} inputClassName="b-compose__input" />
    </Dialog>
  )
}
