import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, LogIn, PlusCircle, Settings, UserPlus } from 'lucide-react'
import { clsx } from 'clsx'

interface Props {
  inviteCode: string
  copied: boolean
  onSettings: () => void
  onInvite: () => void
  onCopyCode: () => void
  onSwitch: () => void
  onCreate: () => void
  onJoin: () => void
}

function Item({ onClick, icon, children, disabled, className }: { onClick: () => void; icon: ReactNode; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx('w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#dcf1eb] hover:text-white hover:bg-white/5 transition text-left disabled:opacity-50', className)}
    >
      <span className="text-[#8a929a] flex-shrink-0">{icon}</span>
      {children}
    </button>
  )
}

/** Gear dropdown with the household-level actions (settings, invite code, switch / create / join). */
export function HouseholdMenu({ inviteCode, copied, onSettings, onInvite, onCopyCode, onSwitch, onCreate, onJoin }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const run = (fn: () => void) => () => { setOpen(false); fn() }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Hogar y ajustes"
        aria-label="Hogar y ajustes"
        className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 text-[#9aa4ac] hover:text-white transition"
      >
        <Settings size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-[#0a1f2f] rounded-2xl shadow-2xl border border-brand-500/25 py-2 z-50 slide-up">
          <Item onClick={run(onSettings)} icon={<Settings size={14} />}>Configurar hogar</Item>
          <Item onClick={run(onInvite)} icon={<UserPlus size={14} />}>Invitar a una persona</Item>
          <button
            onClick={onCopyCode}
            className="w-full flex items-center justify-between px-3 py-2 text-sm text-[#dcf1eb] hover:text-white hover:bg-white/5 transition"
          >
            <span className="flex items-center gap-2.5"><Copy size={14} className="text-[#8a929a]" /> Código: <span className="font-mono">{inviteCode}</span></span>
            <span className={clsx('text-[10px]', copied ? 'text-brand-300 font-semibold' : 'text-[#8a929a]')}>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
          <div className="border-t border-white/10 my-1" />
          <Item onClick={run(onSwitch)} icon={<ArrowLeft size={14} />}>Cambiar de hogar</Item>
          <Item onClick={run(onCreate)} icon={<PlusCircle size={14} />}>Nuevo hogar</Item>
          <Item onClick={run(onJoin)} icon={<LogIn size={14} />}>Unirme a hogar</Item>
        </div>
      )}
    </div>
  )
}
