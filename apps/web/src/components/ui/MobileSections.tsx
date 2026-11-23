import { type RefObject, useRef, useState } from 'react'
import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

export interface MobileSection<T extends string> {
  id: T
  label: string
  Icon: LucideIcon
  /** A small count next to the icon (null/undefined: none). */
  badge?: number | null
}

/**
 * One section at a time on phones, so a page made of several panes is not one endless scroll. From `lg` up nothing
 * changes: every block shows as before. `only(...)` gives the class that hides a block on phones unless one of its
 * sections is open; `open(id)` switches section (and, if the page was scrolled past the bar, starts the new one under it).
 */
export function useMobileSections<T extends string>(initial: T) {
  const [active, setActive] = useState<T>(initial)
  const anchor = useRef<HTMLDivElement>(null)
  const open = (id: T) => {
    setActive(id)
    const a = anchor.current
    if (a && a.getBoundingClientRect().top < 0) a.scrollIntoView({ block: 'start' })
  }
  const only = (...ids: T[]) => (ids.includes(active) ? '' : 'max-lg:hidden')
  return { active, open, only, anchor }
}

/** The sticky bar that switches sections on phones. `active` null: none highlighted (e.g. a detail is open). */
export function MobileSectionBar<T extends string>({ sections, active, onOpen, anchor, label }: {
  sections: MobileSection<T>[]
  active: T | null
  onOpen: (id: T) => void
  anchor: RefObject<HTMLDivElement>
  label: string
}) {
  return (
    <>
      <div ref={anchor} className="lg:hidden h-0 scroll-mt-2" aria-hidden="true" />
      <div className="lg:hidden sticky top-0 z-20 -my-2 py-2 bg-[#051018]/85 backdrop-blur-md">
        <div role="tablist" aria-label={label} className="grid gap-1 rounded-2xl border border-white/10 bg-[#0a1f2f] p-1" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
          {sections.map(({ id, label: name, Icon, badge }) => {
            const on = active === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onOpen(id)}
                className={clsx('flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold transition', on ? 'bg-brand-500/20 text-brand-300' : 'text-[#9aa4ac] hover:bg-white/5')}
              >
                <span className="flex items-center gap-1">
                  <Icon size={15} />
                  {badge != null && <span className="font-mono text-[9px] opacity-70">{badge}</span>}
                </span>
                <span className="w-full truncate text-center">{name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

/** A block's title shown only on phones (on wide screens the block speaks for itself or has its own header). */
export function MobileBlockTitle({ children }: { children: string }) {
  return <p className="lg:hidden font-pixel text-[9px] uppercase tracking-widest text-brand-400">{children}</p>
}
