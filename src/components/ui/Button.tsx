import type { ButtonHTMLAttributes } from 'react'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'solid' | 'outline' | 'ghost'
  className?: string
}

export function Button({ variant = 'outline', type = 'button', className, ...rest }: ButtonProps) {
  const classes = ['b-button', `b-button--${variant}`]
  if (className !== undefined) classes.push(className)

  return <button type={type} className={classes.join(' ')} {...rest} />
}
