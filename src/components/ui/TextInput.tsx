import { type InputHTMLAttributes, type Ref, useId } from 'react'

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  hint?: string
  inputRef?: Ref<HTMLInputElement>
  className?: string
}

export function TextInput({ label, hint, inputRef, className, id, ...rest }: TextInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = hint !== undefined ? `${inputId}-hint` : undefined

  const classes = ['b-input']
  if (className !== undefined) classes.push(className)

  return (
    <div className={classes.join(' ')}>
      <label className="b-input__label mono-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="b-input__control"
        aria-describedby={hintId}
        {...rest}
      />
      {hint !== undefined ? (
        <p className="b-input__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
