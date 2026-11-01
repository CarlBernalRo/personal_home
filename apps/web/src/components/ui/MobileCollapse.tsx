import { type ReactNode, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  title: string
  /** One line under the title while it is closed, so the essentials stay visible. */
  hint?: string
  children: ReactNode
  defaultOpen?: boolean
  /** Keeps it open while true (something that needs attention, like a pay day to confirm). */
  openWhen?: boolean
  className?: string
}

/**
 * Saves room on phones: below `lg` the content hides behind a header the user taps open; from `lg` up
 * it is always visible and the header disappears, so wide screens look exactly as before.
 */
export function MobileCollapse({ title, hint, children, defaultOpen = false, openWhen = false, className }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const shown = open || openWhen
  return (
    <div className={clsx('min-w-0', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={shown}
        className="lg:hidden w-full flex items-center justify-between gap-3 notch-sm border border-white/10 bg-[#0d263a] px-3.5 py-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block font-pixel text-[9px] uppercase tracking-widest text-brand-400">{title}</span>
          {!shown && hint && <span className="block text-xs text-[#9aa4ac] truncate mt-0.5">{hint}</span>}
        </span>
        <ChevronDown size={16} className={clsx('flex-shrink-0 text-[#8a929a] transition-transform', shown && 'rotate-180')} aria-hidden="true" />
      </button>
      <div className={clsx('space-y-5', shown ? 'mt-3 block' : 'hidden', 'lg:mt-0 lg:block')}>{children}</div>
    </div>
  )
}
