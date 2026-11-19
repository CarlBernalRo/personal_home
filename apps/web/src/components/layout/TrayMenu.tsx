import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronUp, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { useNotifications } from '@/hooks/useNotifications'
import { usePendingMovements } from '@/hooks/usePendingMovements'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { PendingMovementsLink } from '@/components/pending/PendingMovementsLink'
import { IconTip } from '@/components/ui/IconTip'
import { SideTip } from '@/components/ui/SideTip'

/** Width of the popover + its gap to the sidebar: the notification / pending panels open to the right of it, not on top of it. */
const POPOVER_W = 148
const PANEL_OFFSET = POPOVER_W + 8

/**
 * The sidebar's "hidden icons" arrow, like the Windows taskbar's: one button showing how much is waiting (unread
 * notifications + movements to confirm) that opens a small popover with each of those icons on its own —
 * notifications, finances, pending to confirm. Each keeps its own behaviour (the bell and the inbox still open
 * their own panel; finances is a link).
 */
export function TrayMenu() {
  const { unread } = useNotifications()
  const pending = usePendingMovements().counts.total
  const total = unread + pending
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Element
      // the bell's and the inbox's panels live in a portal: a click inside one is not "outside"
      if (wrapRef.current?.contains(t) || t.closest?.('[role="dialog"]')) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open])

  const badge = total > 99 ? '99+' : String(total)
  const label = total > 0 ? `Más accesos · ${total} por revisar` : 'Más accesos'

  const button = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      className={clsx(
        'relative rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
        open ? 'bg-brand-500/15 text-brand-300' : total > 0 ? 'text-brand-300 hover:bg-white/5' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
      )}
    >
      <ChevronUp size={18} className={clsx('transition-transform duration-200', open && 'rotate-180')} />
      {total > 0 && (
        <span
          className={clsx(
            'absolute -right-1 -top-1 h-4 min-w-[16px] rounded-full px-1 text-center font-mono text-[9px] font-bold leading-4 ring-2 ring-[#0a1f2f]',
            unread > 0 ? 'bg-red-500 text-white' : 'bg-sky-500 text-[#04141f]',
          )}
          aria-hidden="true"
        >
          {badge}
        </span>
      )}
    </button>
  )

  return (
    <div className="relative flex justify-center" ref={wrapRef}>
      {open ? button : <SideTip label={label}>{button}</SideTip>}

      {open && (
        <div
          role="menu"
          aria-label="Más accesos"
          className="absolute bottom-0 left-full ml-2 z-50 flex items-center justify-center gap-1.5 rounded-2xl border border-brand-500/25 bg-[#0a1f2f] p-2 shadow-[0_25px_60px_rgba(5,16,24,0.9)] scale-in"
          style={{ width: POPOVER_W }}
        >
          <NotificationBell variant="sidebar" panelOffset={PANEL_OFFSET} tipPlacement="top" />
          <IconTip text="Finanzas" className="inline-flex" placement="top">
            <NavLink
              to="/finanzas"
              aria-label="Finanzas"
              className={({ isActive }) => clsx(
                'relative block rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
                isActive ? 'bg-brand-500/15 text-brand-300' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
              )}
            >
              <Wallet size={17} />
            </NavLink>
          </IconTip>
          <PendingMovementsLink variant="sidebar" panelOffset={PANEL_OFFSET} tipPlacement="top" />
        </div>
      )}
    </div>
  )
}
