import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Copy, Mail, MessageCircle, Send, Trash2, UserPlus } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { IconTip } from '@/components/ui/IconTip'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { createHouseholdInvite, deleteHouseholdInvite, getAllowedUsers, getHouseholdInvites } from '@/lib/firestore'
import type { HouseholdInvite, InviteStatus } from '@/shared/types/notification'

interface Props {
  open: boolean
  onClose: () => void
  householdId: string
  householdName: string
  inviteCode: string
  /** Current member ids (uids; legacy members may be stored as e-mails). */
  members: string[]
  myUid: string
  myEmail: string
  myName: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const STATUS: Record<InviteStatus, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  accepted: { label: 'Aceptada', cls: 'text-brand-300 bg-brand-500/10 border-brand-500/30' },
  declined: { label: 'Rechazada', cls: 'text-red-300 bg-red-500/10 border-red-500/30' },
}

/** Invite a person by e-mail (shows up in their notification center) or share the household code by message. */
export function InviteModal({ open, onClose, householdId, householdName, inviteCode, members, myUid, myEmail, myName }: Props) {
  const { showToast } = useToast()
  const ask = useConfirm()
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [invites, setInvites] = useState<HouseholdInvite[]>([])
  const [loadingList, setLoadingList] = useState(false)
  // lower-case e-mails with access; null while loading or if the lookup failed (then no warning is shown)
  const [allowed, setAllowed] = useState<Set<string> | null>(null)
  const [copied, setCopied] = useState<'code' | 'msg' | null>(null)

  const loadInvites = useCallback(async () => {
    setLoadingList(true)
    try {
      const list = (await getHouseholdInvites(householdId)) as unknown as HouseholdInvite[]
      setInvites(list.sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0)))
    } catch { showToast('No se pudieron cargar las invitaciones', 'error') }
    finally { setLoadingList(false) }
  }, [householdId, showToast])

  useEffect(() => {
    if (!open) return
    setEmail(''); setTouched(false)
    loadInvites()
    getAllowedUsers()
      .then((rows) => setAllowed(new Set(rows
        .filter((u) => u.active === true && u.deleted !== true && typeof u.email === 'string')
        .map((u) => (u.email as string).toLowerCase()))))
      .catch(() => setAllowed(null))
  }, [open, loadInvites])

  const clean = email.trim().toLowerCase()
  const valid = EMAIL_RE.test(clean)

  // Why this address cannot be invited (null when it can)
  const blocker = useMemo(() => {
    if (!valid) return null
    if (clean === myEmail.toLowerCase()) return 'Ese es tu propio correo: ya estás en este hogar.'
    if (members.some((m) => m.toLowerCase() === clean)) return 'Esta persona ya es miembra de este hogar.'
    const prev = invites.find((i) => i.email === clean && i.status !== 'declined')
    if (prev?.status === 'pending') return 'Ya hay una invitación pendiente para este correo.'
    if (prev?.status === 'accepted') return 'Esta persona ya aceptó una invitación a este hogar.'
    return null
  }, [valid, clean, myEmail, members, invites])

  const noAccess = valid && !blocker && allowed !== null && !allowed.has(clean)
  const error = touched && !clean ? 'Escribe un correo' : touched && !valid ? 'Escribe un correo válido (nombre@dominio.com)' : blocker ?? undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!valid || blocker) return
    setSending(true)
    try {
      await createHouseholdInvite({ householdId, householdName, inviteCode, email: clean, invitedBy: myUid, invitedByName: myName })
      showToast(`Invitación enviada a ${clean}`, 'success')
      setEmail(''); setTouched(false)
      await loadInvites()
    } catch { showToast('No se pudo enviar la invitación', 'error') }
    finally { setSending(false) }
  }

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

  const message = `Hola, te invito a mi hogar "${householdName}" en Gastos Hogar (${window.location.origin}). ` +
    `Para unirte: entra a la app, ve a Hogar > Unirme a hogar e ingresa el código ${inviteCode}. ` +
    'Si aún no puedes entrar a la app, pídele acceso al administrador.'

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
      <form onSubmit={submit} noValidate className="space-y-3">
        <p className="text-xs text-[#9aa4ac] leading-relaxed">
          Le llegará una invitación a sus notificaciones de la app. Al aceptarla entra directo a <span className="text-[#dcf1eb] font-semibold">{householdName}</span>.
        </p>
        <Input
          label="Correo de la persona"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="nombre@correo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          error={error}
          aria-invalid={!!error}
        />
        {noAccess && (
          <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <AlertTriangle size={16} className="text-amber-300 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs text-amber-100 leading-relaxed">
              <span className="font-bold">Esta persona aún no tiene acceso a la app.</span> Pídele al administrador que la autorice en Usuarios. Puedes enviar la invitación igual; la verá cuando pueda entrar.
            </p>
          </div>
        )}
        <Button type="submit" notched className="w-full" disabled={sending || !!blocker}>
          <Send size={14} /> {sending ? 'Enviando…' : 'Enviar invitación'}
        </Button>
      </form>

      {/* Invitations already created for this household */}
      <section aria-label="Invitaciones de este hogar" className="space-y-2 pt-1">
        <h3 className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Invitaciones</h3>
        {loadingList && invites.length === 0 ? (
          <p className="text-xs text-[#8a929a]">Cargando…</p>
        ) : invites.length === 0 ? (
          <p className="text-xs text-[#8a929a]">Aún no has invitado a nadie a este hogar.</p>
        ) : (
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
        )}
      </section>

      {/* Alternative: share the code */}
      <section aria-label="Compartir el código" className="space-y-2.5 border-t border-white/[0.08] pt-4">
        <h3 className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">O comparte el código</h3>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0d263a] px-3 py-2">
          <span className="font-mono text-lg font-bold tracking-[0.25em] text-[#f3f5f6]">{inviteCode}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => copy(inviteCode, 'code')} aria-label="Copiar código del hogar">
            {copied === 'code' ? <Check size={14} /> : <Copy size={14} />} {copied === 'code' ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        <p className="rounded-xl border border-white/10 bg-[#051018]/60 p-3 text-xs text-[#c7ccd1] leading-relaxed select-all">{message}</p>
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => copy(message, 'msg')}>
            {copied === 'msg' ? <Check size={14} /> : <Copy size={14} />} Mensaje
          </Button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium bg-[#0d263a] text-[#f0fae8] border border-brand-500/25 hover:bg-[#133e5f] hover:border-brand-400/40 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
          >
            <MessageCircle size={14} /> WhatsApp
          </a>
          <a
            href={`mailto:${valid ? clean : ''}?subject=${encodeURIComponent(`Invitación al hogar "${householdName}"`)}&body=${encodeURIComponent(message)}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium bg-[#0d263a] text-[#f0fae8] border border-brand-500/25 hover:bg-[#133e5f] hover:border-brand-400/40 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
          >
            <Mail size={14} /> Correo
          </a>
        </div>
      </section>
    </Modal>
  )
}
