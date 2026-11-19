import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  /** What the button says while nothing is picked. */
  placeholder: string
  /** Accessible name (the button only shows the value). */
  label: string
  size?: 'xs' | 'sm'
  className?: string
}

/**
 * A single choice in the app's own style (the same look as the filters' MultiSelect), for the places where a native
 * <select> would look out of place: a small button with the value, and a list that opens under it.
 */
export function ChipSelect({ value, onChange, options, placeholder, label, size = 'xs', className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const current = options.find((o) => o.value === value)
  const pick = (v: string) => { onChange(v); setOpen(false) }

  return (
    <div ref={ref} className={clsx('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-lg border transition',
          size === 'xs' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
          current ? 'border-white/15 bg-[#0d263a] text-[#dcf1eb] hover:border-white/30' : 'border-dashed border-white/15 text-[#8a929a] hover:text-white hover:border-white/30',
        )}
      >
        <span className="font-semibold">{current?.label ?? placeholder}</span>
        <ChevronDown size={12} className={clsx('text-[#8a929a] transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div id={id} role="listbox" aria-label={label} className="absolute left-0 z-40 mt-1.5 w-48 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[#0d263a] p-1.5 shadow-2xl">
          {[{ value: '', label: placeholder }, ...options].map((o) => {
            const on = o.value === value
            return (
              <button
                key={o.value || '__none'}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => pick(o.value)}
                className={clsx('w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition', on ? 'bg-white/[0.07] text-white' : o.value ? 'text-[#c7ccd1] hover:bg-white/5' : 'text-[#8a929a] hover:bg-white/5')}
              >
                <span className="truncate font-medium">{o.label}</span>
                {on && <Check size={12} className="text-brand-300 flex-shrink-0" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
