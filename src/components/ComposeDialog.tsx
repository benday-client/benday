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
      title="compose"
      onClose={form.close}
      className="b-compose"
      headerClose
      headExtra={<ComposeHint />}
      footer={<ComposeActions form={form} label="post" />}
    >
      <ComposeField form={form} inputClassName="b-compose__input" />
    </Dialog>
  )
}
