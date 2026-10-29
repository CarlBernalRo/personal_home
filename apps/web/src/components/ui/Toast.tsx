import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

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
  success: <CheckCircle size={16} className="text-green-500 flex-shrink-0" />,
  error:   <AlertCircle size={16} className="text-red-500 flex-shrink-0" />,
  info:    <Info size={16} className="text-blue-500 flex-shrink-0" />,
}

const BG: Record<ToastType, string> = {
  success: 'border-green-200 bg-white',
  error:   'border-red-200 bg-white',
  info:    'border-blue-200 bg-white',
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
      <div className="fixed top-4 inset-x-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-sm mx-auto">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`fade-in flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg pointer-events-auto ${BG[t.type]}`}
          >
            {ICONS[t.type]}
            <p className="flex-1 text-sm font-medium text-gray-800">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="p-0.5 text-gray-400 hover:text-gray-600 transition">
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
