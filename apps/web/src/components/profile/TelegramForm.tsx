import { useEffect, useState } from 'react'
import { deleteField, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { Send, Link2, Unlink, ExternalLink, Copy, Loader2, Timer, TimerOff, ShieldCheck, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { FormActions } from '@/components/ui/FormActions'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { db } from '@/lib/firebase'
import { updateUserProfile } from '@/lib/firestore'

const BOT = (import.meta.env.VITE_TELEGRAM_BOT as string | undefined)?.replace(/^@/, '')

/** How long a link code lasts. The bot and the job enforce the same limit on their side. */
const CODE_TTL_MS = 5 * 60 * 1000

const ZONES: { id: string; label: string; hint: string }[] = [
  { id: 'sueldo', label: 'Sueldo', hint: 'Día de pago y presupuesto' },
  { id: 'fijos',  label: 'Fijos',  hint: 'Pagos por vencer o vencidos' },
  { id: 'gastos', label: 'Gastos', hint: 'Presupuestos variables' },
  { id: 'hogar',  label: 'Hogar',  hint: 'Deudas, abonos y pagos recibidos' },
]

const CLEAR_CODE = { telegramLinkCode: deleteField(), telegramLinkCodeAt: deleteField() }

/** Random single-use code (16 characters, no look-alikes: ~80 bits, so two people never get the same one). */
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Links the user's Telegram chat so the app's notifications also arrive there. */
export function TelegramForm() {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  // when the code was issued (the server's clock, read back from the profile) and the ticking "now"
  const [issuedAt, setIssuedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [expired, setExpired] = useState(false)

  const p = profile as any
  const linked = !!p?.telegramChatId
  const code = (p?.telegramLinkCode ?? '') as string
  const saved: string[] = Array.isArray(p?.telegramZones) ? p.telegramZones : ZONES.map((z) => z.id)
  // zones are edited as a draft and saved with the card's bottom bar, like the other tabs
  const [zones, setZones] = useState<string[]>(saved)
  const savedKey = [...saved].sort().join(',')
  useEffect(() => { setZones(saved) }, [savedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = [...zones].sort().join(',') !== savedKey
  const deepLink = BOT && code ? `https://t.me/${BOT}?start=${code}` : ''
  const waiting = !!code && !linked && !expired

  async function save(patch: Record<string, unknown>, local: Record<string, unknown>) {
    if (!user) return false
    setBusy(true)
    try {
      await updateUserProfile(user.uid, patch)
      setProfile({ ...profile, ...local } as any)
      return true
    } catch {
      showToast('No se pudo guardar', 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  // While waiting: watch the profile (the screen turns to "vinculado" by itself) and read back when the code was issued
  useEffect(() => {
    if (!user || !code || linked) return
    return onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const fresh = snap.data()
      if (!fresh) return
      if (fresh.telegramChatId) {
        setProfile({ ...profile, telegramChatId: fresh.telegramChatId, telegramLinkCode: undefined } as any)
        showToast('¡Telegram vinculado! Ya recibirás tus avisos', 'success')
        return
      }
      const at = fresh.telegramLinkCodeAt?.toMillis?.()
      if (at) setIssuedAt(at)
    }, () => { /* no live updates: the countdown still runs from the local clock */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, code, linked])

  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waiting])

  const remaining = issuedAt ? issuedAt + CODE_TTL_MS - now : CODE_TTL_MS

  // time is up: the code is thrown away (also in the database), the person has to ask for another one
  useEffect(() => {
    if (!waiting || remaining > 0) return
    setExpired(true)
    save(CLEAR_CODE, { telegramLinkCode: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, remaining])

  async function generate() {
    const c = newCode()
    setExpired(false)
    setIssuedAt(Date.now())
    setNow(Date.now())
    await save({ telegramLinkCode: c, telegramLinkCodeAt: serverTimestamp() }, { telegramLinkCode: c })
  }

  const cancel = () => { setIssuedAt(null); return save(CLEAR_CODE, { telegramLinkCode: undefined }) }

  const unlink = () =>
    save(
      { telegramChatId: deleteField(), telegramLinkedAt: deleteField(), ...CLEAR_CODE },
      { telegramChatId: undefined, telegramLinkCode: undefined },
    ).then(() => showToast('Telegram desvinculado', 'delete'))

  const toggleZone = (id: string) => setZones((z) => (z.includes(id) ? z.filter((x) => x !== id) : [...z, id]))
  const saveZones = () => save({ telegramZones: zones }, { telegramZones: zones }).then((ok) => ok && showToast('Avisos actualizados', 'edit'))

  const copy = (text: string, done: string) => navigator.clipboard?.writeText(text).then(() => showToast(done, 'success'))
  const pct = Math.max(0, Math.min(100, (remaining / CODE_TTL_MS) * 100))
  const urgent = remaining < 60_000

  return (
    <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-3 shadow-xl">
      <div className="flex items-center gap-2">
        <Send size={14} className="text-brand-400" />
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Avisos por Telegram</p>
      </div>
      <p className="text-xs text-[#8a929a]">
        Recibe en Telegram las mismas notificaciones de la app: pagos recibidos, deudas y abonos del hogar, vencimientos. Los avisos llegan cada hora, no al instante.
      </p>

      {!BOT ? (
        <p className="rounded-xl border border-amber-300/25 bg-amber-200/[0.06] p-3 text-xs text-amber-100">
          Falta configurar el bot (<code>VITE_TELEGRAM_BOT</code>) en la app.
        </p>
      ) : linked ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><ShieldCheck size={15} /> Telegram vinculado</p>
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
          <FormActions onSave={saveZones} onCancel={() => setZones(saved)} saving={busy} disabled={!dirty} saveLabel="Guardar los avisos que quiero recibir" />
        </div>
      ) : waiting ? (
        <div className="overflow-hidden rounded-2xl border border-sky-300/20 bg-[#0d263a]">
          {/* status + countdown */}
          <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-sky-100">
              <Loader2 size={16} className="animate-spin text-sky-300" /> Esperando a Telegram…
            </p>
            <span className={clsx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-bold tabular-nums', urgent ? 'border-red-400/40 bg-red-500/10 text-red-200' : 'border-white/10 bg-white/[0.04] text-[#f3f5f6]')}>
              <Timer size={12} /> {clock(remaining)}
            </span>
          </div>
          <div className="mx-4 mt-3 h-1 overflow-hidden rounded-full bg-white/10">
            <div className={clsx('h-full rounded-full transition-[width] duration-1000 ease-linear', urgent ? 'bg-red-400' : 'bg-sky-300')} style={{ width: `${pct}%` }} />
          </div>

          <div className="space-y-3 p-4">
            <a href={deepLink} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-sky-300/40 bg-sky-500/15 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25">
              <ExternalLink size={15} /> Abrir Telegram y tocar Iniciar
            </a>

            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-[#5f6a72]">
              <span className="h-px flex-1 bg-white/10" /> ¿No se abre? <span className="h-px flex-1 bg-white/10" />
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-[#9aa4ac]">
                Escribe este mensaje a <b className="text-[#f3f5f6]">@{BOT}</b> desde tu celular o desde{' '}
                <a href="https://web.telegram.org" target="_blank" rel="noreferrer" className="underline text-sky-200">web.telegram.org</a>:
              </p>
              <button
                type="button"
                onClick={() => copy(`/start ${code}`, 'Mensaje copiado')}
                title="Copiar el mensaje"
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0a1f2f] px-3 py-2 text-left font-mono text-[13px] text-[#f3f5f6] transition hover:border-sky-300/40"
              >
                <span className="truncate">/start {code}</span>
                <Copy size={13} className="flex-shrink-0 text-[#8a929a]" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <p className="text-[11px] text-[#8a929a]">Esta pantalla se actualiza sola cuando queda vinculado.</p>
              <button type="button" disabled={busy} onClick={cancel} className="flex items-center gap-1 text-xs font-semibold text-[#9aa4ac] hover:text-white disabled:opacity-50">
                <X size={12} /> Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : expired ? (
        <div className="space-y-3 rounded-2xl border border-amber-300/25 bg-amber-200/[0.05] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-100"><TimerOff size={16} /> El código venció</p>
          <p className="text-xs text-[#c7ccd1]">Por seguridad cada código dura 5 minutos y sirve una sola vez. Genera uno nuevo para vincular.</p>
          <Button type="button" notched disabled={busy} onClick={generate}><Link2 size={14} /> Generar código nuevo</Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0d263a] p-4">
          <p className="text-xs text-[#c7ccd1]">
            Genera un código, ábrelo en Telegram y toca <b>Iniciar</b>. El código es personal, dura 5 minutos y sirve una sola vez.
          </p>
          <Button type="button" notched disabled={busy} onClick={generate}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Vincular Telegram
          </Button>
        </div>
      )}
    </div>
  )
}
