import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import { CurvedScrollContainer } from './CurvedScrollContainer'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  dark?: boolean
}

// How many sheets are open: the page behind is frozen while at least one is
let openCount = 0

/** The part of the screen that is really visible (the on-screen keyboard takes the rest on phones). */
function useVisibleBox(active: boolean) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    if (!active) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setBox({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setBox(null)
    }
  }, [active])
  return box
}

/**
 * A dialog that is a centered card on wide screens and a bottom sheet on phones: it rises from the
 * bottom, never covers more than 92% of what is visible (keyboard included), can be dragged down by its
 * header to close, and freezes the page behind it so nothing scrolls, zooms or shifts underneath.
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startY: number; dy: number; id: number } | null>(null)
  const box = useVisibleBox(open)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Freeze the page while a sheet is open, and leave it exactly where it was (and unzoomed) on close
  useEffect(() => {
    if (!open) return
    openCount += 1
    const html = document.documentElement
    html.style.overflow = 'hidden'
    return () => {
      // On a touch screen the browser delivers the end of the tap (mouse events, the "click") to whatever is under the
      // finger once the sheet is gone: the icon of the bottom bar lit up or even got pressed. A transparent shield absorbs
      // it for a moment.
      if (window.matchMedia?.('(pointer: coarse)').matches) {
        const shield = document.createElement('div')
        shield.setAttribute('aria-hidden', 'true')
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;touch-action:none;'
        document.body.appendChild(shield)
        setTimeout(() => shield.remove(), 450)
      }
      openCount -= 1
      if (openCount === 0) {
        html.style.overflow = ''
        // the keyboard may have left the page shifted
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        window.scrollTo(0, 0)
      }
    }
  }, [open])

  if (!open) return null

  function onDragStart(e: React.PointerEvent) {
    // only on phones, where it is a sheet, and not when the touch starts on a button
    if (window.matchMedia('(min-width: 640px)').matches || (e.target as HTMLElement).closest('button')) return
    drag.current = { startY: e.clientY, dy: 0, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (sheetRef.current) sheetRef.current.style.transition = 'none'
  }
  function onDragMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d || !sheetRef.current) return
    d.dy = Math.max(0, e.clientY - d.startY)
    sheetRef.current.style.transform = `translateY(${d.dy}px)`
  }
  function onDragEnd() {
    const d = drag.current
    drag.current = null
    if (!d || !sheetRef.current) return
    if (d.dy > 90) {
      onClose()
    } else {
      sheetRef.current.style.transition = 'transform 0.2s ease-out'
      sheetRef.current.style.transform = ''
    }
  }

  // Drawn on <body>: an ancestor with a transform or overflow (animated pages, scroll panes) would clip a fixed overlay
  return createPortal(
    <div
      className="fixed inset-x-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overscroll-contain"
      style={box ? { top: box.top, height: box.height } : { top: 0, bottom: 0 }}
    >
      {/* The backdrop animates its own tint and blur: fading the whole overlay would stop the blur from showing until the end */}
      <div className="absolute inset-0 modal-backdrop touch-none" onClick={onClose} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'relative z-10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92%] sm:max-h-[90%] min-w-0',
          'bg-[#0a1f2f] border border-brand-500/25 border-b-0 sm:border-b text-[#f0fae8] sheet-in shadow-[0_-12px_60px_rgba(5,16,24,0.9)]',
        )}
      >
        {/* Header: on phones a grab handle, and dragging it down closes the sheet */}
        <div
          className="flex-shrink-0 border-b border-white/[0.06] touch-none sm:touch-auto"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="sm:hidden flex justify-center pt-2.5" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-white/20" />
          </div>
          <div className="flex items-center justify-between px-4 sm:px-6 pt-2 sm:pt-6 pb-3 sm:pb-4">
            <h2 className="text-base font-bold text-[#f3f5f6] tracking-tight">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#9aa4ac] hover:text-[#f3f5f6] hover:bg-white/5 transition"
              aria-label="Cerrar modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <CurvedScrollContainer
          className="flex-1 min-h-0 sm:rounded-b-2xl"
          contentClassName="px-4 sm:px-6 py-4 sm:py-5 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-4 min-w-0 overflow-x-hidden"
          corners="bottom-right"
          borderRadius={16}
          themeColor="cyan"
        >
          {children}
        </CurvedScrollContainer>
      </div>
    </div>,
    document.body,
  )
}
