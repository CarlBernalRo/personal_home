import { type InputHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'
import { MoneyInput } from './MoneyInput'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  allowNegative?: boolean
  /** An amount in pesos: shown with thousands separators; the form still receives the plain number. */
  money?: boolean
}

export function preventNegativeNumberKey(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === '-' || e.key === 'e' || e.key === 'E') {
    e.preventDefault()
  }
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, allowNegative = false, money = false, min, onKeyDown, onPaste, onInput, ...props }, ref) => {
    const isNumber = props.type === 'number'
    const disallowNeg = isNumber && !allowNegative && (min === undefined || Number(min) >= 0)

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disallowNeg) {
        preventNegativeNumberKey(e)
      }
      onKeyDown?.(e)
    }

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (disallowNeg) {
        const text = e.clipboardData.getData('text')
        if (text.includes('-')) {
          e.preventDefault()
          const sanitized = text.replace(/-/g, '')
          document.execCommand?.('insertText', false, sanitized)
        }
      }
      onPaste?.(e)
    }

    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
      if (disallowNeg) {
        const target = e.currentTarget
        if (target.value.startsWith('-')) {
          target.value = target.value.replace(/^-+/, '')
        }
      }
      onInput?.(e)
    }

    const classes = clsx(
      'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100',
      error && 'border-red-400 focus:border-red-400 focus:ring-red-100',
      className,
    )
    const { type: _type, ...moneyProps } = props

    return (
      <div className="flex flex-col gap-1">
        {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
        {money ? (
          <MoneyInput ref={ref} allowNegative={allowNegative} className={classes} {...moneyProps} />
        ) : (
          <input
            ref={ref}
            min={disallowNeg ? (min ?? 0) : min}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onInput={handleInput}
            className={classes}
            {...props}
          />
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'
