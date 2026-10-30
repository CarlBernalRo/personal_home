import { type ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Dark-surface variant for the Hogar screens — every other modal in the
   *  app stays on the default light chrome. */
  dark?: boolean
}

export function Modal({ open, onClose, title, children, dark }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx(
        'relative z-10 w-full max-w-md rounded-2xl shadow-xl flex flex-col max-h-[90dvh]',
        dark ? 'bg-[#0e1215] border border-white/10' : 'bg-white',
      )}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className={clsx('text-lg font-semibold', dark ? 'text-[#f3f5f6]' : 'text-gray-900')}>{title}</h2>
          <button onClick={onClose} className={clsx('p-1.5 rounded-lg transition', dark ? 'hover:bg-white/5' : 'hover:bg-gray-100')}>
            <X size={18} className={dark ? 'text-[#9aa4ac]' : 'text-gray-500'} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-6 flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
