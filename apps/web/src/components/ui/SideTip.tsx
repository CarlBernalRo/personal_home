import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Tooltip for the icon-only sidebar: names the section on hover or keyboard focus, to the right of the
 * item. Drawn in a portal so the sidebar's own overflow never clips it.
 */
export function SideTip({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  function show() {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    // to the right of the sidebar itself, not of the (narrower) item inside it
    const edge = ref.current?.closest('aside')?.getBoundingClientRect().right ?? r.right
    setPos({ top: r.top + r.height / 2, left: edge + 8 })
  }

  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}>
      {children}
      {pos && label && createPortal(
        <span
          role="tooltip"
          className="fixed z-[1000] -translate-y-1/2 whitespace-nowrap notch-sm bg-[#0a1f2f] border border-brand-500/40 border-l-2 border-l-brand-400 px-3.5 py-2 text-xs font-semibold text-[#f3f5f6] glow-brand-sm pointer-events-none"
          style={{ top: pos.top, left: pos.left }}
        >
          {label}
        </span>,
        document.body,
      )}
    </div>
  )
}
