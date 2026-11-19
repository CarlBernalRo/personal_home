import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

export interface MultiOption {
  value: string
  label: string
  /** A coloured dot before the label. */
  color?: string
  /** An icon before the label (wins over the dot). */
  icon?: ReactNode
  /** A number shown at the end (e.g. how many records it has). */
  count?: number
}

interface Props {
  /** What is being filtered ("Tipo", "Cuentas"…). */
  label: string
  options: MultiOption[]
  /** The picked values; empty means all. */
  value: string[]
  onChange: (value: string[]) => void
  /** What the button says with nothing picked. */
  allLabel?: string
  className?: string
}

/**
 * A compact filter: one button that says what is picked ("Todos", "Fijos", "3 tipos") and opens a list of
 * checkboxes. Nothing picked means everything, so the list never ends up "empty".
 */
export function MultiSelect({ label, options, value, onChange, allLabel = 'Todos', className }: Props) {
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

  const picked = options.filter((o) => value.includes(o.value))
  const summary = picked.length === 0 ? allLabel : picked.length === 1 ? picked[0].label : `${picked.length} seleccionados`
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        className={clsx(
          'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition',
          picked.length > 0 ? 'border-brand-400/60 bg-brand-500/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#c7ccd1] hover:text-white hover:border-white/25',
        )}
      >
        <span className="text-[10px] uppercase tracking-wider text-[#8a929a]">{label}</span>
        {picked.length === 1 && (picked[0].icon ?? (picked[0].color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: picked[0].color }} aria-hidden="true" />))}
        <span className="font-semibold max-w-[10rem] truncate">{summary}</span>
        <ChevronDown size={13} className={clsx('text-[#8a929a] transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div id={id} role="listbox" aria-multiselectable="true" aria-label={label} className="absolute left-0 z-40 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-[#0d263a] p-1.5 shadow-2xl">
          {options.map((o) => {
            const on = value.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className={clsx('w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition', on ? 'bg-white/[0.07] text-white' : 'text-[#c7ccd1] hover:bg-white/5')}
              >
                <span className={clsx('flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border', on ? 'border-brand-400 bg-brand-500 text-white' : 'border-white/25')} aria-hidden="true">
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                {o.icon ?? (o.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: o.color }} aria-hidden="true" />)}
                <span className="flex-1 truncate font-medium">{o.label}</span>
                {o.count !== undefined && <span className="font-mono text-[10px] text-[#8a929a]">{o.count}</span>}
              </button>
            )
          })}
          <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] px-2.5 pt-1.5 pb-0.5">
            <button type="button" onClick={() => onChange([])} disabled={value.length === 0} className="text-[11px] font-semibold text-brand-300 hover:text-brand-200 disabled:opacity-40">
              Ver {allLabel.toLowerCase()}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-[#c7ccd1] hover:text-white">Listo</button>
          </div>
        </div>
      )}
    </div>
  )
}
