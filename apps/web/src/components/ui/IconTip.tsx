import { useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const WIDTH = 224
const MARGIN = 8

/**
 * Wraps an icon (or any small element) with an explanatory tooltip: shown on hover and keyboard
 * focus, and toggled by tapping on touch screens. It is drawn in a portal so cards that clip their
 * content (notched corners, scroll panes) never cut it, and it is kept inside the viewport.
 */
export function IconTip({ text, children, className, placement = 'top' }: { text: string; children: ReactNode; className?: string; placement?: 'top' | 'right' }) {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean; side?: boolean } | null>(null)

  function show() {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    if (placement === 'right') {
      // beside the sidebar it lives in
      const edge = ref.current?.closest('aside')?.getBoundingClientRect().right ?? r.right
      setPos({ top: r.top + r.height / 2, left: edge + 8 + WIDTH / 2, below: false, side: true })
      return
    }
    const left = Math.max(MARGIN + WIDTH / 2, Math.min(r.left + r.width / 2, window.innerWidth - MARGIN - WIDTH / 2))
    // flip under the icon when there is no room above it
    const below = r.top < 90
    setPos({ top: below ? r.bottom + 8 : r.top - 8, left, below })
  }
  const hide = () => setPos(null)

  return (
    <span
      ref={ref}
      tabIndex={0}
      role="button"
      aria-label={text}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => { e.stopPropagation(); pos ? hide() : show() }}
      onKeyDown={(e) => { if (e.key === 'Escape') hide() }}
      className={className ?? 'inline-flex cursor-help rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2'}
    >
      {children}
      {pos && createPortal(
        <span
          id={id}
          role="tooltip"
          className={`fixed z-[1000] ${pos.side ? 'whitespace-nowrap' : '-translate-x-1/2'} notch-sm bg-[#0a1f2f] border border-brand-500/40 border-t-2 border-t-brand-400 px-3 py-2 text-[11px] font-medium normal-case tracking-normal leading-snug text-[#e6ebef] text-center glow-brand-sm pointer-events-none`}
          style={{ top: pos.top, left: pos.side ? pos.left - WIDTH / 2 : pos.left, width: pos.side ? undefined : WIDTH, transform: pos.side ? 'translateY(-50%)' : `translate(-50%, ${pos.below ? '0' : '-100%'})` }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  )
}
