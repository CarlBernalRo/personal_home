import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { Inbox, PackageCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { usePendingMovements } from '@/hooks/usePendingMovements'
import { IconTip } from '@/components/ui/IconTip'
import { Modal } from '@/components/ui/Modal'
import { useIsMobile } from '@/hooks/useIsMobile'
import { PendingMovementCard } from './PendingMovementCard'

const PANEL_W = 380
const MARGIN = 8
const LATEST = 6

/**
 * Inbox icon with a count badge that opens a dropdown preview of the movements waiting for confirmation — same
 * behaviour as the notifications bell: a quick look, then "Ver todas" to go to the full /pendientes screen.
 */
export function PendingMovementsLink({ variant = 'mobile' }: { variant?: 'mobile' | 'sidebar' }) {
  const { items, counts, loading } = usePendingMovements()
  const n = counts.total
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number; narrow: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const narrow = variant === 'mobile' || window.innerWidth < 768
    if (narrow) {
      setPos({ top: r.bottom + 8, left: MARGIN, maxH: window.innerHeight - r.bottom - 8 - 80, narrow })
    } else {
      const top = Math.max(MARGIN, Math.min(r.top, window.innerHeight - 320))
      const edge = btnRef.current?.closest('aside')?.getBoundingClientRect().right ?? r.right
      setPos({ top, left: Math.min(edge + 8, window.innerWidth - PANEL_W - MARGIN), maxH: window.innerHeight - top - MARGIN, narrow })
    }
  }, [variant])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    const floating = !isMobile
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
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
  }, [open, place, isMobile])

  const latest = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, LATEST)
  const badge = n > 99 ? '99+' : String(n)
  const label = n > 0 ? `Pendientes por confirmar: ${n}` : 'Pendientes por confirmar'

  const button = (
    <button
      ref={btnRef}
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={clsx(
        'relative rounded-lg p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
        open ? 'bg-brand-500/15 text-brand-300' : n > 0 ? 'text-sky-300 hover:brightness-125' : 'text-[#9aa4ac] hover:bg-white/5 hover:text-[#f3f5f6]',
      )}
    >
      <Inbox size={variant === 'mobile' ? 19 : 17} />
      {n > 0 && (
        <span className="absolute -right-1 -top-1 h-4 min-w-[16px] rounded-full bg-sky-500 px-1 text-center font-mono text-[9px] font-bold leading-4 text-[#04141f] ring-2 ring-[#0a1f2f]" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  )

  return (
    <>
      {open ? button : <IconTip text={label} className="inline-flex" placement={variant === 'sidebar' ? 'right' : 'top'}>{button}</IconTip>}

      {open && isMobile && (
        <Modal open onClose={() => setOpen(false)} title={n > 0 ? `Pendientes por confirmar · ${n}` : 'Pendientes por confirmar'}>
          {loading && latest.length === 0 ? (
            <p className="text-xs text-[#8a929a] text-center py-8">Cargando…</p>
          ) : latest.length === 0 ? (
            <div className="text-center py-6 px-4">
              <PackageCheck size={26} className="mx-auto text-[#6f7a83] mb-2" aria-hidden="true" />
              <p className="text-sm font-bold text-[#f0fae8]">Todo confirmado</p>
              <p className="text-xs text-[#8a929a] mt-1">No tienes movimientos de Telegram por confirmar.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {latest.map((pm) => <PendingMovementCard key={pm.id} pm={pm} onNavigate={() => setOpen(false)} />)}
            </div>
          )}
          <button
            type="button"
            onClick={() => { navigate('/pendientes'); setOpen(false) }}
            className="block w-full text-center rounded-xl border border-white/10 bg-[#0d263a] px-4 py-2.5 text-xs font-semibold text-brand-300"
          >
            Ver todas
          </button>
        </Modal>
      )}

      {open && !isMobile && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Pendientes por confirmar"
          className="fixed z-[60] flex flex-col rounded-2xl border border-brand-500/25 bg-[#0a1f2f] shadow-[0_25px_60px_rgba(5,16,24,0.9)] scale-in overflow-hidden"
          style={{ top: pos.top, left: pos.left, maxHeight: pos.maxH, width: pos.narrow ? `calc(100vw - ${MARGIN * 2}px)` : PANEL_W }}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08] flex-shrink-0">
            <h2 className="text-sm font-bold text-[#f3f5f6]">
              Pendientes por confirmar{n > 0 && <span className="ml-2 font-mono text-xs text-sky-300">{n}</span>}
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {loading && latest.length === 0 ? (
              <p className="text-xs text-[#8a929a] text-center py-8">Cargando…</p>
            ) : latest.length === 0 ? (
              <div className="text-center py-8 px-4">
                <PackageCheck size={26} className="mx-auto text-[#6f7a83] mb-2" aria-hidden="true" />
                <p className="text-sm font-bold text-[#f0fae8]">Todo confirmado</p>
                <p className="text-xs text-[#8a929a] mt-1">No tienes movimientos de Telegram por confirmar.</p>
              </div>
            ) : (
              latest.map((pm) => <PendingMovementCard key={pm.id} pm={pm} onNavigate={() => setOpen(false)} />)
            )}
          </div>
          <Link
            to="/pendientes"
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
