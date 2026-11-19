import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Mail, MessageCircle, Send, Trash2, UserPlus, type LucideIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from '@/components/ui/Modal'
import { IconTip } from '@/components/ui/IconTip'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { deleteHouseholdInvite, getHouseholdInvites } from '@/lib/firestore'
import type { HouseholdInvite, InviteStatus } from '@/shared/types/notification'

interface Props {
  open: boolean
  onClose: () => void
  householdId: string
  householdName: string
  inviteCode: string
}

const STATUS: Record<InviteStatus, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  accepted: { label: 'Aceptada', cls: 'text-brand-300 bg-brand-500/10 border-brand-500/30' },
  declined: { label: 'Rechazada', cls: 'text-red-300 bg-red-500/10 border-red-500/30' },
}

const TILE = 'group flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-[#0d263a] px-2 py-3 text-[11px] font-semibold text-[#c7ccd1] transition hover:border-brand-400/50 hover:bg-[#133e5f] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400'

/** One share option: a round coloured icon with its name underneath; a link, or a button when it only copies. */
function Tile({ icon: Icon, label, color, href, onClick }: { icon: LucideIcon; label: string; color: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="flex h-10 w-10 items-center justify-center rounded-full border transition group-hover:scale-105" style={{ backgroundColor: color + '22', borderColor: color + '66', color }}>
        <Icon size={18} aria-hidden="true" />
      </span>
      {label}
    </>
  )
  return href
    ? <a href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer" className={TILE}>{inner}</a>
    : <button type="button" onClick={onClick} className={TILE}>{inner}</button>
}

/** Invite someone to the household by sharing its code through Telegram, WhatsApp or e-mail (or copying the message). */
export function InviteModal({ open, onClose, householdId, householdName, inviteCode }: Props) {
  const { showToast } = useToast()
  const ask = useConfirm()
  const [invites, setInvites] = useState<HouseholdInvite[]>([])
  const [copied, setCopied] = useState<'code' | 'msg' | null>(null)

  const loadInvites = useCallback(async () => {
    try {
      const list = (await getHouseholdInvites(householdId)) as unknown as HouseholdInvite[]
      setInvites(list.sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0)))
    } catch { /* the list is only a courtesy for invitations sent before */ }
  }, [householdId])

  useEffect(() => { if (open) loadInvites() }, [open, loadInvites])

  async function cancel(inv: HouseholdInvite) {
    const msg = inv.status === 'pending'
      ? `¿Cancelar la invitación para ${inv.email}? Ya no la verá en sus notificaciones.`
      : `¿Quitar de la lista la invitación de ${inv.email}?`
    if (!(await ask(msg, { title: inv.status === 'pending' ? 'Cancelar invitación' : 'Quitar invitación', confirmLabel: inv.status === 'pending' ? 'Cancelar invitación' : 'Quitar', cancelLabel: 'Volver' }))) return
    try {
      await deleteHouseholdInvite(inv.id)
      setInvites((prev) => prev.filter((i) => i.id !== inv.id))
      showToast('Invitación eliminada', 'delete')
    } catch { showToast('No se pudo eliminar la invitación', 'error') }
  }

  const origin = window.location.origin
  const message = `Hola, te invito a mi hogar "${householdName}" en Gastos Hogar (${origin}). ` +
    `Para unirte: entra a la app, ve a Hogar > Unirme a hogar e ingresa el código ${inviteCode}. ` +
    'Si aún no puedes entrar a la app, pídele acceso al administrador.'
  // Telegram shows the link as a preview card, so the address goes in `url` and is left out of the text
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(origin)}&text=${encodeURIComponent(message.replace(` (${origin})`, ''))}`

  async function copy(text: string, what: 'code' | 'msg') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
      showToast(what === 'code' ? 'Código copiado' : 'Mensaje copiado', 'info')
    } catch { showToast('No se pudo copiar', 'error') }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invitar a una persona">
      <p className="text-xs text-[#9aa4ac] leading-relaxed">
        Envía el código de <span className="text-[#dcf1eb] font-semibold">{householdName}</span> por el medio que prefieras. La persona entra a la app, va a <span className="text-[#dcf1eb] font-semibold">Hogar › Unirme a hogar</span> y lo escribe.
      </p>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-brand-400/30 bg-brand-500/5 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Código del hogar</p>
          <p className="font-mono text-2xl font-bold tracking-[0.3em] text-[#f3f5f6]">{inviteCode}</p>
        </div>
        <button
          type="button"
          onClick={() => copy(inviteCode, 'code')}
          aria-label="Copiar código del hogar"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0d263a] px-3 py-2 text-xs font-semibold text-[#c7ccd1] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
        >
          {copied === 'code' ? <Check size={14} /> : <Copy size={14} />} {copied === 'code' ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      <section aria-label="Enviar la invitación" className="space-y-2">
        <h3 className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Enviar por</h3>
        <div className="grid grid-cols-4 gap-2">
          <Tile icon={Send} label="Telegram" color="#38bdf8" href={telegramHref} />
          <Tile icon={MessageCircle} label="WhatsApp" color="#34d399" href={`https://wa.me/?text=${encodeURIComponent(message)}`} />
          <Tile icon={Mail} label="Correo" color="#fbbf24" href={`mailto:?subject=${encodeURIComponent(`Invitación al hogar "${householdName}"`)}&body=${encodeURIComponent(message)}`} />
          <Tile icon={copied === 'msg' ? Check : Copy} label={copied === 'msg' ? 'Copiado' : 'Mensaje'} color="#a78bfa" onClick={() => copy(message, 'msg')} />
        </div>
        <p className="rounded-xl border border-white/10 bg-[#051018]/60 p-3 text-[11px] text-[#9aa4ac] leading-relaxed select-all">{message}</p>
      </section>

      {/* Invitations by e-mail sent before: kept only so they can still be cancelled */}
      {invites.length > 0 && (
        <section aria-label="Invitaciones anteriores" className="space-y-2 border-t border-white/[0.08] pt-4">
          <h3 className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Invitaciones anteriores</h3>
          <ul className="space-y-1.5">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d263a] px-3 py-2">
                <UserPlus size={14} className="text-[#8a929a] flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate text-xs text-[#e6ebef]" title={inv.email}>{inv.email}</span>
                <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full border', STATUS[inv.status].cls)}>{STATUS[inv.status].label}</span>
                <IconTip text={inv.status === 'pending' ? 'Cancelar invitación' : 'Quitar de la lista'} className="inline-flex flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => cancel(inv)}
                    aria-label={`${inv.status === 'pending' ? 'Cancelar' : 'Quitar'} invitación de ${inv.email}`}
                    className="p-1.5 rounded-lg text-[#6f7a83] hover:text-red-300 hover:bg-red-500/10 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </IconTip>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  )
}
