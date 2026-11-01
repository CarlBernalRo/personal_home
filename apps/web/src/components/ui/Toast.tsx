import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { X, CheckCircle, AlertCircle, Info, Trash2, Pencil } from 'lucide-react'

/** success: created/saved · edit: changed · delete: removed · error: failed · info: everything else */
export type ToastType = 'success' | 'edit' | 'delete' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={16} className="text-brand-300 flex-shrink-0" />,
  edit:    <Pencil size={16} className="text-violet-300 flex-shrink-0" />,
  delete:  <Trash2 size={16} className="text-orange-300 flex-shrink-0" />,
  error:   <AlertCircle size={16} className="text-red-300 flex-shrink-0" />,
  info:    <Info size={16} className="text-sky-300 flex-shrink-0" />,
}

// Dark surface with a tinted border and a coloured stripe, so the kind of notice reads at a glance
const BG: Record<ToastType, string> = {
  success: 'border-brand-400/50 border-l-4 border-l-brand-400 bg-[#0a1f2f]',
  edit:    'border-violet-400/50 border-l-4 border-l-violet-400 bg-[#0a1f2f]',
  delete:  'border-orange-400/50 border-l-4 border-l-orange-400 bg-[#0a1f2f]',
  error:   'border-red-400/50 border-l-4 border-l-red-400 bg-[#0a1f2f]',
  info:    'border-sky-400/50 border-l-4 border-l-sky-400 bg-[#0a1f2f]',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++counterRef.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  function dismiss(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* bottom-right; on mobile it sits above the bottom navigation bar */}
      <div className="fixed bottom-24 md:bottom-5 right-4 md:right-5 left-4 md:left-auto z-[100] flex flex-col gap-2 pointer-events-none w-auto md:w-full max-w-sm ml-auto">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`fade-in flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg pointer-events-auto ${BG[t.type]}`}
          >
            {ICONS[t.type]}
            <p className="flex-1 text-sm font-medium text-[#f3f5f6]">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="p-0.5 text-[#8a929a] hover:text-white transition">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
