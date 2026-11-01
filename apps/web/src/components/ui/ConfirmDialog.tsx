import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

export interface ConfirmOptions {
  title?: string
  /** 'danger' (default) for deletions; 'default' for confirmations that are not destructive. */
  tone?: 'danger' | 'default'
  confirmLabel?: string
  cancelLabel?: string
}

type Ask = (message: ReactNode, options?: ConfirmOptions) => Promise<boolean>

// Outside the provider it falls back to the browser dialog, so nothing breaks if it is ever missing
const ConfirmContext = createContext<Ask>((message) => Promise.resolve(window.confirm(typeof message === 'string' ? message : '¿Continuar?')))

interface Pending {
  message: ReactNode
  options: ConfirmOptions
}

/** In-app replacement for window.confirm: `const ask = useConfirm(); if (!(await ask('¿Eliminar…?'))) return`. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback<Ask>((message, options = {}) => {
    // a second question while one is open cancels the first
    resolver.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setPending({ message, options })
    })
  }, [])

  function close(ok: boolean) {
    resolver.current?.(ok)
    resolver.current = null
    setPending(null)
  }

  const danger = (pending?.options.tone ?? 'danger') === 'danger'
  const Icon = danger ? AlertTriangle : HelpCircle

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Modal open={!!pending} onClose={() => close(false)} title={pending?.options.title ?? (danger ? 'Confirmar eliminación' : 'Confirmar')}>
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <span
              className={danger
                ? 'w-10 h-10 notch-sm flex items-center justify-center flex-shrink-0 bg-red-500/15 border border-red-500/40 text-red-300'
                : 'w-10 h-10 notch-sm flex items-center justify-center flex-shrink-0 bg-brand-500/15 border border-brand-500/40 text-brand-300'}
              aria-hidden="true"
            >
              <Icon size={18} />
            </span>
            <div className="text-sm text-[#d6dde2] leading-relaxed whitespace-pre-line min-w-0">{pending?.message}</div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => close(false)}>
              {pending?.options.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button type="button" variant={danger ? 'danger' : 'primary'} className="flex-1" notched autoFocus onClick={() => close(true)}>
              {pending?.options.confirmLabel ?? (danger ? 'Eliminar' : 'Confirmar')}
            </Button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmContext)
