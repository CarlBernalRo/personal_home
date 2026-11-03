import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Bell, BellOff } from 'lucide-react'
import { clsx } from 'clsx'
import { useNotifications } from '@/hooks/useNotifications'
import { IconTip } from '@/components/ui/IconTip'
import { Modal } from '@/components/ui/Modal'
import { useIsMobile } from '@/hooks/useIsMobile'
import { NotificationCard } from './NotificationCard'

const PANEL_W = 380
const MARGIN = 8
const LATEST = 6

interface Props {
  /** sidebar: panel opens to the right of the button · mobile: near full-screen sheet under the header */
  variant: 'sidebar' | 'mobile'
}

/** Bell with an unread badge (99+) that opens a dropdown with the latest notifications. */
export function NotificationBell({ variant }: Props) {
  const { notifications, unread, markAllRead, loading } = useNotifications()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number; narrow: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => { setOpen(false); btnRef.current?.focus() }, [])

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const narrow = variant === 'mobile' || window.innerWidth < 768
    if (narrow) {
      // leaves room for the bottom navigation bar
      setPos({ top: r.bottom + 8, left: MARGIN, maxH: window.innerHeight - r.bottom - 8 - 80, narrow })
    } else {
      const top = Math.max(MARGIN, Math.min(r.top, window.innerHeight - 320))
      // opens beside the sidebar, not on top of it
      const edge = btnRef.current?.closest('aside')?.getBoundingClientRect().right ?? r.right
      setPos({ top, left: Math.min(edge + 8, window.innerWidth - PANEL_W - MARGIN), maxH: window.innerHeight - top - MARGIN, narrow })
    }
  }, [variant])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    // Phones: the Modal closes itself (backdrop / swipe). This "tap outside" listener is for the floating panel only; on a
    // phone the sheet lives outside panelRef, so it would close the sheet on touchstart, before a tap on "Ver todas" or on a
    // card could turn into a click.
    const floating = !isMobile
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    function onDown(e: MouseEvent | TouchEvent) {
      if (!floating) return
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [open, close, place, isMobile])

  // how urgent the unread ones are decides the colour and speed of the bell
  const unreadList = notifications.filter((n) => !n.read)
  const state: 'none' | 'info' | 'warning' | 'critical' =
    unreadList.some((n) => n.severity === 'critical') ? 'critical'
      : unreadList.some((n) => n.severity === 'warning') ? 'warning'
        : unreadList.length > 0 ? 'info' : 'none'
  const BELL_COLOR = { none: '#9aa4ac', info: '#52b69a', warning: '#f59e0b', critical: '#ef4444' }[state]

  const latest = [...notifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, LATEST)
  const badge = unread > 99 ? '99+' : String(unread)
  const label = unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'

  const button = (
    <button
      ref={btnRef}
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-state={open ? 'none' : state}
      style={{ ['--bell-color' as string]: BELL_COLOR, color: open ? undefined : BELL_COLOR, backgroundColor: !open && state !== 'none' ? BELL_COLOR + '1f' : undefined }}
      className={clsx(
        'bell-btn relative p-1.5 rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
        open ? 'bg-brand-500/15 text-brand-300' : state === 'none' ? 'hover:text-[#f3f5f6] hover:bg-white/5' : 'hover:brightness-125',
      )}
    >
      <Bell size={variant === 'mobile' ? 19 : 17} className="bell-icon" />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold font-mono leading-4 text-center ring-2 ring-[#0a1f2f]" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  )

  return (
    <>
      {/* The tooltip would sit on top of the open panel, so it is dropped while it is open */}
      {open ? button : <IconTip text={label} className="inline-flex" placement={variant === 'sidebar' ? 'right' : 'top'}>{button}</IconTip>}
      {/* Phones: the notifications rise as a bottom sheet like every other dialog */}
      {open && isMobile && (
        <Modal open onClose={() => setOpen(false)} title={unread > 0 ? `Notificaciones · ${unread} sin leer` : 'Notificaciones'}>
          {unread > 0 && (
            <button type="button" onClick={() => markAllRead()} className="text-xs font-semibold text-brand-300">
              Marcar todo como leído
            </button>
          )}
          {loading && latest.length === 0 ? (
            <p className="text-xs text-[#8a929a] text-center py-8">Cargando…</p>
          ) : latest.length === 0 ? (
            <div className="text-center py-6 px-4">
              <BellOff size={26} className="mx-auto text-[#6f7a83] mb-2" aria-hidden="true" />
              <p className="text-sm font-bold text-[#f0fae8]">Todo en orden</p>
              <p className="text-xs text-[#8a929a] mt-1">No tienes notificaciones por ahora.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {latest.map((n) => <NotificationCard key={n.key} n={n} compact onNavigate={() => setOpen(false)} />)}
            </div>
          )}
          <Link to="/notificaciones" onClick={() => setOpen(false)} className="block text-center rounded-xl border border-white/10 bg-[#0d263a] px-4 py-2.5 text-xs font-semibold text-brand-300">
            Ver todas
          </Link>
        </Modal>
      )}
      {open && !isMobile && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notificaciones"
          className="fixed z-[60] flex flex-col rounded-2xl border border-brand-500/25 bg-[#0a1f2f] shadow-[0_25px_60px_rgba(5,16,24,0.9)] scale-in overflow-hidden"
          style={{ top: pos.top, left: pos.left, maxHeight: pos.maxH, width: pos.narrow ? `calc(100vw - ${MARGIN * 2}px)` : PANEL_W }}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08] flex-shrink-0">
            <h2 className="text-sm font-bold text-[#f3f5f6]">
              Notificaciones{unread > 0 && <span className="ml-2 font-mono text-xs text-brand-300">{unread} sin leer</span>}
            </h2>
            {unread > 0 && (
              <button type="button" onClick={() => markAllRead()} className="text-[11px] font-semibold text-brand-300 hover:text-brand-200 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">
                Marcar todo como leído
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {loading && latest.length === 0 ? (
              <p className="text-xs text-[#8a929a] text-center py-8">Cargando…</p>
            ) : latest.length === 0 ? (
              <div className="text-center py-8 px-4">
                <BellOff size={26} className="mx-auto text-[#6f7a83] mb-2" aria-hidden="true" />
                <p className="text-sm font-bold text-[#f0fae8]">Todo en orden</p>
                <p className="text-xs text-[#8a929a] mt-1">No tienes notificaciones por ahora.</p>
              </div>
            ) : (
              latest.map((n) => <NotificationCard key={n.key} n={n} compact onNavigate={() => setOpen(false)} />)
            )}
          </div>
          <Link
            to="/notificaciones"
            onClick={() => setOpen(false)}
            className="flex-shrink-0 block text-center px-4 py-2.5 border-t border-white/[0.08] text-xs font-semibold text-brand-300 hover:text-brand-200 hover:bg-white/5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:-outline-offset-2"
          >
            Ver todas
          </Link>
        </div>,
        document.body,
      )}
    </>
  )
}
