import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Mail, MailOpen, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { AppNotification } from '@/shared/types/notification'
import { useNotifications } from '@/hooks/useNotifications'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { IconTip } from '@/components/ui/IconTip'
import { SEVERITY_ICON, SEVERITY_LABEL, SEVERITY_STYLE, ZONE_ICON, ZONE_LABEL, relativeTime } from './meta'

interface Props {
  n: AppNotification
  /** Compact: used inside the bell dropdown (no dismiss button, clamped text). */
  compact?: boolean
  /** Called after the card navigated (the dropdown closes itself). */
  onNavigate?: () => void
}

/** One notification: severity border + icons, click marks it read and follows its link; invites carry accept / decline. */
export function NotificationCard({ n, compact = false, onNavigate }: Props) {
  const { markRead, markUnread, remove, acceptInvite, declineInvite } = useNotifications()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const sev = SEVERITY_STYLE[n.severity]
  const ZoneIcon = ZONE_ICON[n.zone]
  const SevIcon = SEVERITY_ICON[n.severity]
  const isInvite = n.source === 'invite'

  async function open() {
    await markRead(n)
    if (n.link) { navigate(n.link); onNavigate?.() }
  }

  async function accept() {
    setBusy(true)
    try {
      await acceptInvite(n)
      showToast(`Te uniste a "${n.invite?.householdName ?? 'el hogar'}"`, 'success')
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'No se pudo aceptar la invitación', 'error')
    } finally { setBusy(false) }
  }

  async function decline() {
    setBusy(true)
    try {
      await declineInvite(n)
      showToast('Invitación rechazada', 'info')
    } catch { showToast('No se pudo rechazar la invitación', 'error') }
    finally { setBusy(false) }
  }

  const inert = isInvite && !n.link

  return (
    <article
      aria-label={`${SEVERITY_LABEL[n.severity]}: ${n.title}`}
      className={clsx(
        'relative rounded-2xl border border-white/10 border-l-4 transition',
        sev.border,
        n.read ? 'bg-[#0a1f2f]/60' : 'bg-[#0d263a]',
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={open}
          disabled={inert}
          className={clsx(
            'flex flex-1 min-w-0 items-start gap-3 text-left rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2',
            inert && 'cursor-default',
          )}
        >
          <span className={clsx('relative w-9 h-9 notch-sm border flex items-center justify-center flex-shrink-0', sev.icon)} aria-hidden="true">
            <ZoneIcon size={16} />
            <span className="absolute -bottom-1 -right-1 rounded-full bg-[#0a1f2f] p-px"><SevIcon size={11} /></span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              {!n.read && (
                <>
                  <span className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0 shadow-[0_0_8px_rgba(52,160,164,0.8)]" aria-hidden="true" />
                  <span className="sr-only">No leída. </span>
                </>
              )}
              <span className={clsx('text-sm text-[#f3f5f6] leading-snug', n.read ? 'font-medium' : 'font-bold', compact && 'line-clamp-2')}>{n.title}</span>
            </span>
            <span className={clsx('block mt-0.5 text-xs text-[#aab3ba] leading-relaxed', compact && 'line-clamp-2')}>{n.body}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[#8a929a]">
              <span className={clsx('font-semibold uppercase tracking-wider', sev.chip)}>{SEVERITY_LABEL[n.severity]}</span>
              <span aria-hidden="true">·</span>
              <span>{ZONE_LABEL[n.zone]}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={n.createdAt.toISOString()} className="font-mono">{relativeTime(n.createdAt)}</time>
            </span>
          </span>
        </button>

        {!isInvite && !compact && (
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <IconTip text={n.read ? 'Marcar como no leída' : 'Marcar como leída'} className="inline-flex">
              <button
                type="button"
                onClick={() => (n.read ? markUnread(n) : markRead(n))}
                aria-label={`${n.read ? 'Marcar como no leída' : 'Marcar como leída'}: ${n.title}`}
                className="p-1.5 rounded-lg text-[#6f7a83] hover:text-brand-300 hover:bg-brand-500/10 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
              >
                {n.read ? <Mail size={14} /> : <MailOpen size={14} />}
              </button>
            </IconTip>
            <IconTip text="Descartar notificación" className="inline-flex">
              <button
                type="button"
                onClick={() => remove(n)}
                aria-label={`Descartar: ${n.title}`}
                className="p-1.5 rounded-lg text-[#6f7a83] hover:text-red-300 hover:bg-red-500/10 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
              >
                <Trash2 size={14} />
              </button>
            </IconTip>
          </div>
        )}
      </div>

      {isInvite && (
        <div className="flex gap-2 px-3 pb-3 pl-[3.75rem]">
          <Button type="button" size="sm" notched disabled={busy} onClick={accept} aria-label={`Aceptar invitación a ${n.invite?.householdName ?? 'el hogar'}`}>
            <Check size={14} /> Aceptar
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={decline} aria-label="Rechazar invitación">
            <X size={14} /> Rechazar
          </Button>
        </div>
      )}
    </article>
  )
}
