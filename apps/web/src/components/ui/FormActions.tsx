import { Check, X } from 'lucide-react'
import { clsx } from 'clsx'
import { IconTip } from './IconTip'

interface Props {
  onSave?: () => void
  onCancel: () => void
  /** Submit instead of calling onSave (for a <form onSubmit>). */
  submit?: boolean
  saving?: boolean
  /** Nothing edited yet: there is nothing to save or to cancel. */
  disabled?: boolean
  saveLabel?: string
  cancelLabel?: string
  className?: string
}

/**
 * The actions of a form, kept in view: a bar pinned to the bottom of what scrolls, at the end of the card.
 * It says whether there are unsaved changes and, once there are, its two icon buttons light up: a vivid green
 * check to save and an amber cross to cancel (back to what was saved).
 */
export function FormActions({ onSave, onCancel, submit = false, saving = false, disabled = false, saveLabel = 'Guardar cambios', cancelLabel = 'Cancelar: volver a lo guardado', className }: Props) {
  const active = !disabled && !saving
  return (
    <div
      className={clsx(
        'sticky bottom-0 z-10 flex items-center justify-between gap-3 -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 mt-2 px-5 sm:px-6 py-3 rounded-b-2xl border-t backdrop-blur-md transition-colors',
        disabled ? 'bg-[#0a1f2f]/95 border-white/10' : 'bg-[#0d263a]/95 border-brand-400/40',
        className,
      )}
    >
      <p className={clsx('text-xs font-medium flex items-center gap-2 min-w-0', disabled ? 'text-[#8a929a]' : 'text-amber-200')}>
        <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', disabled ? 'bg-white/20' : 'bg-amber-400 animate-pulse')} aria-hidden="true" />
        <span className="truncate">{saving ? 'Guardando…' : disabled ? 'Sin cambios' : 'Tienes cambios sin guardar'}</span>
      </p>

      <div className="flex items-center gap-2 flex-shrink-0">
        <IconTip text={cancelLabel} className="inline-flex">
          <button
            type="button"
            onClick={onCancel}
            disabled={!active}
            aria-label={cancelLabel}
            className={clsx(
              'p-2.5 rounded-lg border transition',
              active
                ? 'bg-amber-500/15 border-amber-400/70 text-amber-200 hover:bg-amber-500/30 hover:text-white'
                : 'bg-[#0d263a] border-white/10 text-[#5f6a72] pointer-events-none',
            )}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </IconTip>
        <IconTip text={saving ? 'Guardando…' : saveLabel} className="inline-flex">
          <button
            type={submit ? 'submit' : 'button'}
            onClick={submit ? undefined : onSave}
            disabled={!active}
            aria-label={saveLabel}
            className={clsx(
              'p-2.5 rounded-lg border transition',
              active
                ? 'bg-emerald-500 border-emerald-300 text-[#04140d] hover:bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.45)]'
                : 'bg-[#0d263a] border-white/10 text-[#5f6a72] pointer-events-none',
            )}
          >
            <Check size={18} strokeWidth={2.75} aria-hidden="true" />
          </button>
        </IconTip>
      </div>
    </div>
  )
}
