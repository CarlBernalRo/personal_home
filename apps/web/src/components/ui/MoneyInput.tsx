import { type InputHTMLAttributes, forwardRef, useCallback, useLayoutEffect, useRef } from 'react'

export interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  allowNegative?: boolean
}

const GROUPED = /^-?\d{1,3}(\.\d{3})+$/

/** Digits only (plus a leading minus when allowed), no leading zeros: "0012" → "12". */
function clean(text: string, allowNegative: boolean): string {
  const negative = allowNegative && text.trim().startsWith('-')
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digits ? (negative ? '-' : '') + digits : negative ? '-' : ''
}

/** "1234567" → "1.234.567" */
export function groupThousands(raw: string): string {
  return raw.replace(/^(-?)(\d+)/, (_, sign: string, digits: string) => sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.'))
}

/** A value that may arrive as a number, as "1234.5" (form default) or as "1.234.567" (what we show). */
function toRaw(value: unknown, allowNegative: boolean): string {
  if (value === null || value === undefined || value === '') return ''
  const text = String(value)
  if (GROUPED.test(text)) return clean(text, allowNegative)
  const n = Number(text)
  return Number.isFinite(n) ? clean(String(Math.round(n)), allowNegative) : clean(text, allowNegative)
}

/**
 * A text field for amounts that shows thousands separators while typing. Whoever listens to
 * `onChange`/`onBlur` (react-hook-form included) receives the digits without separators: the
 * field swaps its value for the plain number just while the handler runs.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ allowNegative = false, value, defaultValue, onChange, onBlur, ...rest }, ref) => {
    const inner = useRef<HTMLInputElement | null>(null)
    const controlled = value !== undefined
    const setRefs = useCallback((el: HTMLInputElement | null) => {
      inner.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    }, [ref])

    // Uncontrolled (react-hook-form writes plain numbers into the element on reset/setValue): show them grouped
    useLayoutEffect(() => {
      const el = inner.current
      if (!el || controlled) return
      const shown = groupThousands(toRaw(el.value, allowNegative))
      if (el.value !== shown) el.value = shown
    })

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.currentTarget
      const caret = el.selectionStart ?? el.value.length
      const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length
      const raw = clean(el.value, allowNegative)
      el.value = raw
      onChange?.(e)
      const shown = groupThousands(raw)
      el.value = shown
      let pos = 0
      let seen = 0
      while (pos < shown.length && seen < digitsBefore) {
        if (/\d/.test(shown[pos])) seen++
        pos++
      }
      try { el.setSelectionRange(pos, pos) } catch { /* not focusable yet */ }
    }

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const el = e.currentTarget
      const raw = clean(el.value, allowNegative)
      el.value = raw
      onBlur?.(e)
      el.value = groupThousands(raw)
    }

    return (
      <input
        {...rest}
        ref={setRefs}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={controlled ? groupThousands(toRaw(value, allowNegative)) : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    )
  },
)
MoneyInput.displayName = 'MoneyInput'
