import type { LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { IconTip } from './IconTip'

export type ActionTone = 'edit' | 'danger' | 'success' | 'warning'

// Colors by what the action does, the same language as the profile's save/cancel bar
const TONES: Record<ActionTone, string> = {
  edit: 'bg-sky-500/15 border-sky-400/60 text-sky-200 hover:bg-sky-500/30 hover:text-white',
  danger: 'bg-red-500/15 border-red-400/60 text-red-300 hover:bg-red-500/30 hover:text-white',
  success: 'bg-emerald-500 border-emerald-300 text-[#04140d] hover:bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.45)]',
  warning: 'bg-amber-500/15 border-amber-400/70 text-amber-200 hover:bg-amber-500/30 hover:text-white',
}

interface Props {
  icon: LucideIcon
  /** What the action does: the tooltip and the accessible name. */
  label: string
  tone: ActionTone
  onClick: () => void
  disabled?: boolean
  className?: string
}

/** An action as an icon button with a descriptive tooltip, colored by what it does (edit, delete, save, cancel). */
export function IconActionButton({ icon: Icon, label, tone, onClick, disabled = false, className }: Props) {
  return (
    <IconTip text={label} className="inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={clsx('p-2.5 rounded-lg border transition disabled:opacity-40 disabled:pointer-events-none', TONES[tone], className)}
      >
        <Icon size={17} strokeWidth={tone === 'success' ? 2.75 : 2} aria-hidden="true" />
      </button>
    </IconTip>
  )
}
