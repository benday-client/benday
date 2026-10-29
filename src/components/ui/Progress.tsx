export interface ProgressProps {
  label?: string
  value?: number
  indeterminate?: boolean
}

export function Progress({ label, value, indeterminate = false }: ProgressProps) {
  const normalized =
    value !== undefined && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined
  const isIndeterminate = indeterminate || normalized === undefined

  return (
    <div className="b-progress" data-state={isIndeterminate ? 'indeterminate' : 'determinate'}>
      {label !== undefined ? <span className="b-progress__label mono-label">{label}</span> : null}
      <div
        className="b-progress__track"
        role="progressbar"
        aria-label={label ?? 'progress'}
        aria-valuemin={isIndeterminate ? undefined : 0}
        aria-valuemax={isIndeterminate ? undefined : 100}
        aria-valuenow={isIndeterminate ? undefined : normalized}
      >
        <span
          className="b-progress__fill"
          style={isIndeterminate ? undefined : { width: `${normalized}%` }}
        />
      </div>
    </div>
  )
}
