import { useState } from 'react'
import { deleteField, serverTimestamp } from 'firebase/firestore'
import { Send, Link2, Unlink, ExternalLink, Copy } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { getUserProfile, updateUserProfile } from '@/lib/firestore'

const BOT = (import.meta.env.VITE_TELEGRAM_BOT as string | undefined)?.replace(/^@/, '')

const ZONES: { id: string; label: string; hint: string }[] = [
  { id: 'sueldo', label: 'Sueldo', hint: 'Día de pago y presupuesto' },
  { id: 'fijos',  label: 'Fijos',  hint: 'Pagos por vencer o vencidos' },
  { id: 'gastos', label: 'Gastos', hint: 'Presupuestos variables' },
  { id: 'hogar',  label: 'Hogar',  hint: 'Deudas, abonos y pagos recibidos' },
]

/** Random code the bot matches against (no look-alike characters). */
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/** Links the user's Telegram chat so the app's notifications also arrive there. */
export function TelegramForm() {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const p = profile as any
  const linked = !!p?.telegramChatId
  const code = (p?.telegramLinkCode ?? '') as string
  const zones: string[] = Array.isArray(p?.telegramZones) ? p.telegramZones : ZONES.map((z) => z.id)
  const deepLink = BOT && code ? `https://t.me/${BOT}?start=${code}` : ''

  async function save(patch: Record<string, unknown>, local: Record<string, unknown>) {
    if (!user) return
    setBusy(true)
    try {
      await updateUserProfile(user.uid, patch)
      setProfile({ ...profile, ...local } as any)
    } catch {
      showToast('No se pudo guardar', 'error')
    } finally {
      setBusy(false)
    }
  }

  const generate = () => { const c = newCode(); return save({ telegramLinkCode: c, telegramLinkCodeAt: serverTimestamp() }, { telegramLinkCode: c }) }

  // The bot links the chat on its next run: look at the profile again to see whether it already did
  async function refresh() {
    if (!user) return
    setBusy(true)
    try {
      const fresh = await getUserProfile(user.uid)
      if (fresh) setProfile({ ...profile, ...fresh } as any)
      showToast(fresh?.telegramChatId ? 'Telegram vinculado' : 'Todavía no se vincula: puede tardar hasta una hora', fresh?.telegramChatId ? 'success' : 'info')
    } finally {
      setBusy(false)
    }
  }

  const unlink = () =>
    save(
      { telegramChatId: deleteField(), telegramLinkedAt: deleteField(), telegramLinkCode: deleteField(), telegramLinkCodeAt: deleteField() },
      { telegramChatId: undefined, telegramLinkCode: undefined },
    ).then(() => showToast('Telegram desvinculado', 'delete'))

  const toggleZone = (id: string) => {
    const next = zones.includes(id) ? zones.filter((z) => z !== id) : [...zones, id]
    return save({ telegramZones: next }, { telegramZones: next })
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center gap-2">
        <Send size={16} className="text-sky-300" />
        <h2 className="text-base font-bold text-[#f0fae8]">Avisos por Telegram</h2>
      </div>
      <p className="text-xs text-[#9aa4ac]">
        Recibe en Telegram las mismas notificaciones de la app: pagos recibidos, deudas y abonos del hogar, vencimientos. Llegan cada hora, no al instante.
      </p>

      {!BOT ? (
        <p className="rounded-xl border border-amber-300/25 bg-amber-200/[0.06] p-3 text-xs text-amber-100">
          Falta configurar el bot (<code>VITE_TELEGRAM_BOT</code>) en la app.
        </p>
      ) : linked ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3">
            <p className="text-sm font-semibold text-emerald-200">Telegram vinculado</p>
            <button type="button" disabled={busy} onClick={unlink} className="flex items-center gap-1.5 text-xs font-semibold text-red-300 hover:text-red-200 disabled:opacity-50">
              <Unlink size={13} /> Desvincular
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#9aa4ac]">¿De qué quieres recibir avisos?</p>
            {ZONES.map((z) => {
              const on = zones.includes(z.id)
              return (
                <label key={z.id} className={clsx('flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer select-none transition', on ? 'bg-brand-500/10 border-brand-500/40' : 'bg-[#0d263a] border-white/10')}>
                  <span className="min-w-0">
                    <span className="block text-sm text-[#f3f5f6]">{z.label}</span>
                    <span className="block text-[11px] text-[#8a929a]">{z.hint}</span>
                  </span>
                  <input type="checkbox" checked={on} disabled={busy} onChange={() => toggleZone(z.id)} />
                </label>
              )
            })}
          </div>
        </div>
      ) : code ? (
        <div className="space-y-3 rounded-xl border border-white/10 bg-[#0d263a] p-3.5">
          <ol className="list-decimal pl-4 space-y-1.5 text-xs text-[#c7ccd1]">
            <li>Abre el bot en Telegram con el botón de abajo.</li>
            <li>Toca <b>Iniciar</b> (o <b>Start</b>) en el chat.</li>
            <li>En la próxima hora el bot te confirma y queda vinculado.</li>
          </ol>
          <a href={deepLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300/40 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-500/25 transition">
            <ExternalLink size={13} /> Abrir el bot en Telegram
          </a>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8a929a]">
            <span>Código: <b className="font-mono text-[#f3f5f6]">{code}</b> (vence en 48 horas)</span>
            <button type="button" onClick={() => navigator.clipboard?.writeText(deepLink).then(() => showToast('Enlace copiado', 'success'))} className="flex items-center gap-1 hover:text-white">
              <Copy size={11} /> Copiar enlace
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={refresh} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white border border-brand-400/40 transition disabled:opacity-50">
              Ya le di Iniciar: comprobar
            </button>
            <button type="button" disabled={busy} onClick={generate} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/10 text-[#c7ccd1] hover:text-white transition disabled:opacity-50">
              Código nuevo
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={generate} className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white border border-brand-400/40 transition disabled:opacity-50">
          <Link2 size={14} /> Vincular Telegram
        </button>
      )}
    </div>
  )
}
