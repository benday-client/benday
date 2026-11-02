import { useComposeForm } from '../hooks/useComposeForm'
import type { ComposeRequest } from '../lib/ui'
import { ComposeActions, ComposeField, ComposeHint, ComposeTarget } from './ComposeField'
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
      <ComposeTarget form={form} />

      <ComposeField form={form} inputClassName="b-compose__input" />
    </Dialog>
  )
}
