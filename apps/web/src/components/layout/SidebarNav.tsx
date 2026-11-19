import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { clsx } from 'clsx'
import { create } from 'zustand'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useNotifications } from '@/hooks/useNotifications'
import { usePendingMovements } from '@/hooks/usePendingMovements'
import { updateUserProfile } from '@/lib/firestore'
import { SideTip } from '@/components/ui/SideTip'
import { IconTip } from '@/components/ui/IconTip'
import { useToast } from '@/components/ui/Toast'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { PendingMovementsLink } from '@/components/pending/PendingMovementsLink'

export interface SidebarItem {
  to: string
  label: string
  icon: any
  end?: boolean
  accent: string
  glow: string
  gradient: string
}

/** What sits in "Más accesos" until the person moves things around. */
const DEFAULT_TRAY = ['/notificaciones', '/finanzas', '/pendientes']
/** Same as the calendar's chips: the icon starts moving once the pressed pointer travels this far; less is a click. */
const DRAG_THRESHOLD_PX = 4
/** Width of the tray popover per icon (it grows with what it holds); the bell's / inbox's panels open to its right. */
const TRAY_ICON_W = 40

type Zone = 'main' | 'tray'

/** The icon being moved with a long press: where it comes from, where the pointer is, and the zone under it. */
const useDrag = create<{ drag: { item: SidebarItem; from: Zone; x: number; y: number; over: Zone | null } | null }>(() => ({ drag: null }))
// a drop must not also count as a click on the icon that was moved
let justDropped = false

/** Which accesses the person keeps in "Más accesos" (the rest are in the sidebar), remembered on their profile. */
function useSidebarTray(items: SidebarItem[]) {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const { showToast } = useToast()
  const stored = (profile as any)?.sidebarTray as string[] | undefined
  const tray = (stored ?? DEFAULT_TRAY).filter((id) => items.some((i) => i.to === id))
  const main = items.filter((i) => !tray.includes(i.to))

  async function move(to: string, intoTray: boolean) {
    if (!user) return
    if (intoTray && main.length <= 1) { showToast('La barra necesita al menos un acceso', 'error'); return }
    const next = intoTray ? [...tray.filter((x) => x !== to), to] : tray.filter((x) => x !== to)
    setProfile({ ...(profile as any), sidebarTray: next } as any)
    try { await updateUserProfile(user.uid, { sidebarTray: next }) } catch { showToast('No se pudo guardar el cambio', 'error') }
  }
  return { tray: items.filter((i) => tray.includes(i.to)), main, move }
}

const zoneAt = (x: number, y: number): Zone | null =>
  (document.elementFromPoint(x, y)?.closest('[data-drop]')?.getAttribute('data-drop') as Zone | null) ?? null

/**
 * Press an icon and drag it onto the sidebar or onto "Más accesos", like a calendar chip onto another day: it starts
 * moving as soon as the pressed pointer travels a few pixels; a press without movement stays a normal click.
 */
function useHoldToMove(item: SidebarItem, from: Zone, move: (to: string, intoTray: boolean) => void) {
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD_PX) return
        started = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
      }
      ev.preventDefault()
      const over = zoneAt(ev.clientX, ev.clientY)
      useDrag.setState({ drag: { item, from, x: ev.clientX, y: ev.clientY, over } })
    }
    const onUp = (ev: PointerEvent) => {
      if (started) {
        const over = zoneAt(ev.clientX, ev.clientY)
        if (over && over !== from) move(item.to, over === 'tray')
        justDropped = true // swallow the click that follows the release
        window.setTimeout(() => { justDropped = false }, 0)
      }
      cleanup()
    }
    function cleanup() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cleanup)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      useDrag.setState({ drag: null })
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cleanup)
  }
  // the click that ends a drag is swallowed before it reaches the link / button
  const onClickCapture = (e: React.MouseEvent) => { if (justDropped) { e.preventDefault(); e.stopPropagation() } }
  return { onPointerDown, onClickCapture, onContextMenu: (e: React.MouseEvent) => e.preventDefault(), onDragStart: (e: React.DragEvent) => e.preventDefault() }
}

/** The number on an access (unread notifications, movements to confirm). */
function useBadges() {
  const { unread } = useNotifications()
  const pending = usePendingMovements().counts.total
  return (to: string) => (to === '/notificaciones' ? unread : to === '/pendientes' ? pending : 0)
}
const badgeText = (n: number) => (n > 99 ? '99+' : String(n))

/** The icon that follows the pointer while it is moved, and a hint of where it will land. */
export function SidebarDragGhost() {
  const drag = useDrag((s) => s.drag)
  if (!drag) return null
  const Icon = drag.item.icon
  const target = drag.over && drag.over !== drag.from ? (drag.over === 'tray' ? 'Soltar en Más accesos' : 'Soltar en la barra') : 'Arrastra a la barra o a Más accesos'
  return createPortal(
    <div className="pointer-events-none fixed z-[90] flex items-center gap-2" style={{ left: drag.x + 10, top: drag.y - 16 }}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand-400/60 bg-[#0d263a] text-brand-300 shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
        <Icon size={18} />
      </span>
      <span className={clsx('whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-semibold shadow-lg', drag.over && drag.over !== drag.from ? 'bg-brand-500 text-white' : 'bg-[#0d263a] text-[#c7ccd1] border border-white/10')}>{target}</span>
    </div>,
    document.body,
  )
}

/** One sidebar icon (press and hold to move it). */
function MainIcon({ item, badge, move }: { item: SidebarItem; badge: number; move: (to: string, intoTray: boolean) => void }) {
  const hold = useHoldToMove(item, 'main', move)
  const dragging = useDrag((s) => s.drag?.item.to === item.to)
  const { to, label, icon: Icon, end, accent, glow, gradient } = item
  return (
    <SideTip label={`${label} · arrástralo para moverlo`}>
      <NavLink
        to={to}
        end={end}
        aria-label={label}
        draggable={false}
        {...hold}
        style={{ '--nav-accent': accent, '--nav-glow': glow, '--nav-grad': gradient, touchAction: 'none' } as React.CSSProperties}
        className={({ isActive }) => clsx(
          'sidebar-nav-item is-collapsed flex items-center justify-center gap-3 px-0 py-2.5 rounded-xl text-sm font-medium border relative',
          isActive ? 'is-active bg-brand-500/15 text-brand-400 font-bold border-l-2 !border-brand-500 glow-brand-sm' : 'text-[#9aa4ac] border-transparent hover:text-[#f3f5f6]',
          dragging && 'opacity-30',
        )}
      >
        {({ isActive }) => (
          <div className="icon-box flex items-center justify-center transition-all w-8 h-8 rounded-lg">
            <Icon size={18} className={clsx('sidebar-icon flex-shrink-0 transition-all duration-300', isActive ? 'text-brand-400' : 'text-[#8a929a]')} />
            {badge > 0 && (
              <span className={clsx('absolute right-0.5 top-0.5 h-4 min-w-[16px] rounded-full px-1 text-center font-mono text-[9px] font-bold leading-4 ring-2 ring-[#0a1f2f]', to === '/notificaciones' ? 'bg-red-500 text-white' : 'bg-sky-500 text-[#04141f]')} aria-hidden="true">
                {badgeText(badge)}
              </span>
            )}
          </div>
        )}
      </NavLink>
    </SideTip>
  )
}

/** The sidebar's accesses: whatever the person did not send to "Más accesos". Its <nav> is the drop zone. */
export function SidebarMainNav({ items }: { items: SidebarItem[] }) {
  const { main, move } = useSidebarTray(items)
  const badge = useBadges()
  return <>{main.map((item) => <MainIcon key={item.to} item={item} badge={badge(item.to)} move={move} />)}</>
}

/** One icon in "Más accesos": the bell and the inbox keep their own panels; the rest are links. Press and hold to move. */
function TrayIcon({ item, move, panelOffset }: { item: SidebarItem; move: (to: string, intoTray: boolean) => void; panelOffset: number }) {
  const hold = useHoldToMove(item, 'tray', move)
  const dragging = useDrag((s) => s.drag?.item.to === item.to)
  const Icon = item.icon
  return (
    <span {...hold} className={clsx('inline-flex', dragging && 'opacity-30')} style={{ touchAction: 'none' }}>
      {item.to === '/notificaciones' ? (
        <NotificationBell variant="sidebar" panelOffset={panelOffset} tipPlacement="top" />
      ) : item.to === '/pendientes' ? (
        <PendingMovementsLink variant="sidebar" panelOffset={panelOffset} tipPlacement="top" />
      ) : (
        <IconTip text={item.label} className="inline-flex" placement="top">
          <NavLink
            to={item.to}
            end={item.end}
            aria-label={item.label}
            draggable={false}
            className={({ isActive }) => clsx(
              'relative block rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
              isActive ? 'bg-brand-500/15 text-brand-300' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
            )}
          >
            <Icon size={17} />
          </NavLink>
        </IconTip>
      )}
    </span>
  )
}

/**
 * The footer's "Más accesos" arrow, like the Windows taskbar's hidden icons: a small popover with the icons the person
 * keeps out of the sidebar. Icons are moved in and out by pressing, holding and dragging them.
 */
export function SidebarTray({ items }: { items: SidebarItem[] }) {
  const { tray, move } = useSidebarTray(items)
  const badge = useBadges()
  const drag = useDrag((s) => s.drag)
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const total = tray.reduce((s, i) => s + badge(i.to), 0)
  const hasUnread = tray.some((i) => i.to === '/notificaciones' && badge(i.to) > 0)
  const width = Math.max(1, tray.length) * TRAY_ICON_W + 16
  const receiving = !!drag && drag.from === 'main'

  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Element
      // the bell's and the inbox's panels live in a portal: a click inside one is not "outside"
      if (wrapRef.current?.contains(t) || t.closest?.('[role="dialog"]')) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown) }
  }, [open])

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
        receiving ? (drag?.over === 'tray' ? 'bg-brand-500/30 text-brand-200 ring-2 ring-brand-400' : 'bg-brand-500/10 text-brand-300 ring-1 ring-brand-400/60')
          : open ? 'bg-brand-500/15 text-brand-300' : total > 0 ? 'text-brand-300 hover:bg-white/5' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
      )}
    >
      {/* points left while closed, right once open */}
      <ChevronLeft size={18} className={clsx('transition-transform duration-200', open && 'rotate-180')} />
      {total > 0 && (
        <span className={clsx('absolute -right-1 -top-1 h-4 min-w-[16px] rounded-full px-1 text-center font-mono text-[9px] font-bold leading-4 ring-2 ring-[#0a1f2f]', hasUnread ? 'bg-red-500 text-white' : 'bg-sky-500 text-[#04141f]')} aria-hidden="true">
          {badgeText(total)}
        </span>
      )}
    </button>
  )

  return (
    <div className="relative flex justify-center" ref={wrapRef} data-drop="tray">
      {open || drag ? button : <SideTip label={`${label} · arrastra un ícono para moverlo`}>{button}</SideTip>}
      {open && (
        <div
          role="menu"
          aria-label="Más accesos"
          className={clsx('absolute bottom-0 left-full ml-2 z-50 flex items-center justify-center gap-1.5 rounded-2xl border bg-[#0a1f2f] p-2 shadow-[0_25px_60px_rgba(5,16,24,0.9)] scale-in', drag?.over === 'tray' && drag.from === 'main' ? 'border-brand-400' : 'border-brand-500/25')}
          style={{ minWidth: width }}
        >
          {tray.map((item) => <TrayIcon key={item.to} item={item} move={move} panelOffset={width + 8} />)}
          {tray.length === 0 && <span className="px-1 text-[10px] text-[#8a929a] whitespace-nowrap">Suelta aquí un ícono</span>}
        </div>
      )}
    </div>
  )
}
