import { type SelectHTMLAttributes, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from './Modal'
import { useIsMobile } from '@/hooks/useIsMobile'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

const MAX_LIST = 320
const MARGIN = 8

/**
 * A dropdown that always fits on screen: the browser's own list can't be limited, and with many options
 * it spills past the edges. This one opens a scrollable list under (or over) the field on wide screens and
 * a bottom sheet on phones. A hidden native <select> still holds the value, so react-hook-form's
 * `register`, `value`/`onChange` and `ref` work exactly as before.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, ...props }, ref) => {
    const native = useRef<HTMLSelectElement | null>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const list = useRef<HTMLUListElement>(null)
    const isMobile = useIsMobile()
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(0)
    const [current, setCurrent] = useState('')
    const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean } | null>(null)

    const setRefs = useCallback((el: HTMLSelectElement | null) => {
      native.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    }, [ref])

    // What the field shows: the controlled value, or what the hidden select holds (react-hook-form writes it there)
    useLayoutEffect(() => {
      const v = props.value !== undefined ? String(props.value) : native.current?.value ?? options[0]?.value ?? ''
      if (v !== current) setCurrent(v)
    })

    const selected = options.find((o) => o.value === current)

    const place = useCallback(() => {
      const r = trigger.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - MARGIN
      const above = r.top - MARGIN
      const up = below < 200 && above > below
      const maxH = Math.max(140, Math.min(MAX_LIST, (up ? above : below) - 4))
      setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: r.width, maxH, up })
    }, [])

    const pick = useCallback((value: string) => {
      const el = native.current
      if (el && el.value !== value) {
        // set it the way the browser would, so every onChange (react-hook-form included) sees the change
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, value)
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setCurrent(value)
      setOpen(false)
      trigger.current?.focus()
    }, [])

    function openList() {
      if (props.disabled) return
      setActive(Math.max(0, options.findIndex((o) => o.value === current)))
      if (!isMobile) place()
      setOpen(true)
    }

    useEffect(() => {
      if (!open || isMobile) return
      const onDown = (e: MouseEvent | TouchEvent) => {
        const t = e.target as Node
        if (list.current?.contains(t) || trigger.current?.contains(t)) return
        setOpen(false)
      }
      const onScroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false) }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('touchstart', onDown)
      window.addEventListener('resize', place)
      window.addEventListener('scroll', onScroll, true)
      return () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('touchstart', onDown)
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', onScroll, true)
      }
    }, [open, isMobile, place])

    // keep the highlighted option in view
    useEffect(() => {
      if (!open) return
      list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
    }, [open, active, pos])

    function onKeyDown(e: React.KeyboardEvent) {
      if (!open) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList() }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
      else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) pick(options[active].value) }
      else if (e.key === 'Tab') setOpen(false)
    }

    const items = options.map((o, i) => (
      <li
        key={o.value}
        data-i={i}
        role="option"
        aria-selected={o.value === current}
        onMouseEnter={() => setActive(i)}
        onClick={() => pick(o.value)}
        className={clsx(
          'flex items-center justify-between gap-3 px-3 py-2.5 sm:py-2 text-sm cursor-pointer rounded-lg',
          i === active ? 'bg-brand-500/20 text-white' : 'text-[#dcf1eb]',
          o.value === current && 'font-semibold',
        )}
      >
        <span className="min-w-0">{o.label}</span>
        {o.value === current && <Check size={14} className="flex-shrink-0 text-brand-300" aria-hidden="true" />}
      </li>
    ))

    return (
      <div className="flex flex-col gap-1">
        {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
        <div className="relative">
          <select ref={setRefs} className="sr-only" tabIndex={-1} aria-hidden="true" {...props}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            ref={trigger}
            type="button"
            disabled={props.disabled}
            onClick={() => (open ? setOpen(false) : openList())}
            onKeyDown={onKeyDown}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={label}
            className={clsx(
              'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-left outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 bg-white',
              'flex items-center justify-between gap-2 disabled:opacity-60',
              error && 'border-red-400',
              className,
            )}
            style={{ backgroundColor: '#0d263a', borderColor: error ? undefined : 'rgba(52,160,164,0.25)', color: '#f0fae8' }}
          >
            <span className="min-w-0 truncate">{selected?.label ?? ''}</span>
            <ChevronDown size={16} className={clsx('flex-shrink-0 text-[#8a929a] transition-transform', open && 'rotate-180')} aria-hidden="true" />
          </button>

          {/* Wide screens: a list that never leaves the screen */}
          {open && !isMobile && pos && createPortal(
            <ul
              ref={list}
              role="listbox"
              className="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl border border-brand-500/25 bg-[#0a1f2f] p-1 shadow-[0_20px_50px_rgba(5,16,24,0.9)] scale-in"
              style={{ left: pos.left, width: pos.width, maxHeight: pos.maxH, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            >
              {items}
            </ul>,
            document.body,
          )}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Phones: the options rise as a bottom sheet like every other dialog */}
        {open && isMobile && (
          <Modal open onClose={() => setOpen(false)} title={label ?? 'Elige una opción'}>
            <ul ref={list} role="listbox" className="-mx-1 space-y-0.5">{items}</ul>
          </Modal>
        )}
      </div>
    )
  },
)
Select.displayName = 'Select'
