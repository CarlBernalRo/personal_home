import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus, Trash2, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { FormActions } from '@/components/ui/FormActions'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { getAccounts, updateUserProfile } from '@/lib/firestore'
import { formatCOP, payDatesBetween, periodModeOf, type PayRule, type PaySchedule, type PeriodMode, type WeekendAdjust } from '@/shared'

// Draft rows keep amount/day as strings so the inputs can be edited freely
interface Row {
  /** '' = not chosen yet: the field shows its placeholder instead of a made-up value. */
  kind: PayRule['kind'] | ''
  day: string
  amount: string
}

const EMPTY_ROW: Row = { kind: '', day: '', amount: '' }

const WEEKEND_OPTIONS: { value: WeekendAdjust; label: string }[] = [
  { value: 'before', label: 'Se paga el viernes anterior' },
  { value: 'after',  label: 'Se paga el lunes siguiente' },
  { value: 'none',   label: 'Se paga ese mismo día' },
]

const selectCls = 'w-full bg-[#0d263a] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-[#f3f5f6] outline-none focus:border-brand-400 transition'

function toRows(schedule: PaySchedule | null): Row[] {
  if (!schedule) return [{ ...EMPTY_ROW }]
  return schedule.rules.map((r) => ({
    kind: r.kind,
    day: r.kind === 'day' ? String(r.day) : '',
    amount: String(r.amount),
  }))
}

function toSchedule(rows: Row[], weekendAdjust: WeekendAdjust | ''): PaySchedule | string {
  const rules: PayRule[] = []
  for (const [i, r] of rows.entries()) {
    if (!r.kind) return `Elige cuándo te pagan en el pago ${i + 1}`
    const amount = Number(r.amount)
    if (!(amount > 0)) return 'Cada pago debe tener un monto mayor a 0'
    if (r.kind === 'last-business-day') {
      rules.push({ kind: 'last-business-day', amount })
    } else {
      const day = Number(r.day)
      if (!Number.isInteger(day) || day < 1 || day > 31) return 'El día de pago debe estar entre 1 y 31'
      rules.push({ kind: 'day', day, amount })
    }
  }
  // the weekend rule only matters for payments on a fixed day
  if (rules.some((r) => r.kind === 'day') && !weekendAdjust) return 'Elige qué pasa si tu día de pago cae en fin de semana'
  return { rules, weekendAdjust: weekendAdjust || 'before' }
}

export function PayScheduleForm() {
  const { user, profile } = useAuth()
  const setProfile = useAuthStore((s) => s.setProfile)
  const { showToast } = useToast()

  const saved = ((profile as any)?.paySchedule ?? null) as PaySchedule | null
  const [rows, setRows] = useState<Row[]>(() => toRows(saved))
  const [weekend, setWeekend] = useState<WeekendAdjust | ''>(saved?.weekendAdjust ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Account the salary is deposited into ('' = the default one)
  const [accountId, setAccountId] = useState(saved?.accountId ?? '')
  // How the periods are counted: pay day to pay day, or by calendar month
  const [periodMode, setPeriodMode] = useState<PeriodMode>(periodModeOf(saved))
  const [accounts, setAccounts] = useState<any[]>([])
  useEffect(() => {
    if (!user) return
    getAccounts(user.uid).then((a) => setAccounts(a as any[])).catch(() => {})
  }, [user])

  // The profile can arrive after the form is drawn (first load): follow what is saved, so the selected options
  // (quick payment choice, period type, account) show what the user really has instead of the defaults
  const savedKey = JSON.stringify(saved)
  // Back to what is saved: also what Cancelar does
  const restore = () => {
    setRows(toRows(saved))
    setWeekend(saved?.weekendAdjust ?? '')
    setAccountId(saved?.accountId ?? '')
    setPeriodMode(periodModeOf(saved))
    setError(null)
  }
  useEffect(() => {
    restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  // Is there anything edited that is not saved yet?
  const dirty = JSON.stringify({ rows, weekend, accountId, periodMode })
    !== JSON.stringify({ rows: toRows(saved), weekend: saved?.weekendAdjust ?? '', accountId: saved?.accountId ?? '', periodMode: periodModeOf(saved) })

  const draft = useMemo(() => toSchedule(rows, weekend), [rows, weekend])

  // Preview of the next pay dates so the weekend / business-day rules can be checked at a glance
  const upcoming = useMemo(() => {
    if (typeof draft === 'string') return []
    const from = new Date()
    return payDatesBetween(draft, from, new Date(from.getFullYear(), from.getMonth() + 3, 0)).slice(0, 4)
  }, [draft])

  const update = (i: number, patch: Partial<Row>) => {
    setError(null)
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  // Mensual = one payment a month, Quincenal = two. Picking the one you already have changes nothing.
  function preset(kind: 'monthly' | 'biweekly') {
    setError(null)
    const count = kind === 'monthly' ? 1 : 2
    if (rows.length === count) return
    // what is already saved with that many payments comes back; otherwise the fields start empty and
    // only show examples, so nothing is invented for the user
    const savedRows = toRows(saved)
    setRows(saved && savedRows.length === count ? savedRows : Array.from({ length: count }, () => ({ ...EMPTY_ROW })))
  }

  async function onSave() {
    if (!user) return
    if (typeof draft === 'string') {
      setError(draft)
      return
    }
    setSaving(true)
    try {
      const schedule: PaySchedule = { ...draft, periodMode, ...(accountId ? { accountId } : {}) }
      await updateUserProfile(user.uid, { paySchedule: schedule })
      setProfile({ ...profile, paySchedule: schedule } as any)
      showToast('Sueldo y frecuencia de pago guardados', 'success')
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasDayRule = rows.some((r) => r.kind === 'day')
  // Which quick option the current payments match, so it shows as selected
  const isMonthly = rows.length === 1
  const isBiweekly = rows.length === 2

  return (
    <div className="rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-4 shadow-xl">
      <div className="flex items-center gap-2">
        <Wallet size={14} className="text-brand-400" />
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Sueldo y frecuencia de pago</p>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {([
          ['monthly', 'Mensual · un pago al mes', isMonthly],
          ['biweekly', 'Quincenal · dos pagos al mes', isBiweekly],
        ] as const).map(([kind, label, active]) => (
          <button
            key={kind}
            type="button"
            onClick={() => preset(kind)}
            aria-pressed={active}
            className={clsx(
              'px-3 py-1.5 rounded-lg border transition',
              active ? 'bg-brand-500/15 border-brand-400/70 text-[#f0fae8] font-semibold' : 'bg-[#0d263a] border-white/10 text-[#c7ccd1] hover:border-brand-400/50',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-[#0d263a]/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#c7ccd1]">Pago {i + 1}</p>
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="p-1 text-[#8a929a] hover:text-red-400 transition" aria-label="Quitar pago">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-[#9aa4ac]">Cuándo te pagan</span>
                <select className={selectCls} value={r.kind} onChange={(e) => update(i, { kind: e.target.value as Row['kind'] })}>
                  <option value="" disabled>Elige cuándo te pagan…</option>
                  <option value="last-business-day">Último día hábil del mes</option>
                  <option value="day">Un día específico</option>
                </select>
              </label>
              {r.kind === 'day' ? (
                <Input label="Día del mes" type="number" placeholder={i === 0 ? 'ej. 15' : 'ej. 30'} value={r.day} onChange={(e) => update(i, { day: e.target.value })} />
              ) : r.kind === 'last-business-day' ? (
                <div className="self-end text-[11px] text-[#8a929a] pb-2">Lunes a viernes; si cae fin de semana, el viernes anterior.</div>
              ) : (
                <div className="self-end text-[11px] text-[#8a929a] pb-2">Elige primero cuándo te pagan.</div>
              )}
            </div>
            <Input label="Monto de este pago (COP)" money placeholder="ej. 2.500.000" value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} />
          </div>
        ))}
      </div>

      {rows.length < 4 && (
        <button type="button" onClick={() => setRows((p) => [...p, { kind: 'day', day: '', amount: p[p.length - 1]?.amount ?? '' }])} className="flex items-center gap-1.5 text-xs font-semibold text-brand-300 hover:text-brand-200 transition">
          <Plus size={14} /> Agregar otro pago al mes
        </button>
      )}

      {hasDayRule && (
        <label className="space-y-1 block">
          <span className="text-xs font-semibold text-[#9aa4ac]">Si el día de pago cae en fin de semana</span>
          <select className={selectCls} value={weekend} onChange={(e) => { setWeekend(e.target.value as WeekendAdjust); setError(null) }}>
            <option value="" disabled>Elige una opción…</option>
            {WEEKEND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}

      {accounts.length > 0 && (
        <label className="space-y-1 block">
          <span className="text-xs font-semibold text-[#9aa4ac]">Cuenta donde se consigna tu sueldo</span>
          <select className={selectCls} value={accountId} onChange={(e) => { setAccountId(e.target.value); setError(null) }}>
            <option value="">{accounts.find((a) => a.isDefault) ? `${accounts.find((a) => a.isDefault).name} (por defecto)` : 'Ninguna: no sumar a una cuenta'}</option>
            {accounts.filter((a) => !a.isDefault).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <span className="text-[11px] text-[#8a929a] block">Al confirmar cada sueldo se suma a esta cuenta; puedes cambiarla en el momento.</span>
        </label>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#9aa4ac]">¿Cómo quieres manejar tus períodos?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de período">
          {([
            ['salary', 'Por fecha de pago', 'Cada período va de un pago al siguiente. Ej.: del 30 de octubre al 29 de noviembre.'],
            ['calendar', 'Por mes calendario', 'Cada período es un mes, del 1 al último día, sin importar cuándo te pagan.'],
          ] as const).map(([value, title, text]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={periodMode === value}
              onClick={() => { setPeriodMode(value); setError(null) }}
              className={clsx(
                'text-left rounded-xl border px-3 py-2.5 transition',
                periodMode === value ? 'border-brand-400/70 bg-brand-500/10' : 'border-white/10 bg-[#0d263a]/50 hover:border-white/25',
              )}
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-[#f0fae8]">
                <span className={clsx('w-3.5 h-3.5 rounded-full border-2 flex-shrink-0', periodMode === value ? 'border-brand-400 bg-brand-400' : 'border-white/30')} aria-hidden="true" />
                {title}
              </span>
              <span className="block mt-1 text-[11px] text-[#8a929a] leading-snug">{text}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[#8a929a]">
          Cambia cómo se agrupan tus gastos, ingresos y lo que te queda. No borra ni modifica nada de lo que ya registraste: solo cambia la forma de verlo.
        </p>
      </div>

      {accounts.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/15 bg-[#0d263a]/50 p-3 space-y-1">
          <p className="text-xs font-semibold text-[#9aa4ac]">Cuenta donde se consigna tu sueldo</p>
          <p className="text-[11px] text-[#8a929a]">
            Aún no tienes cuentas. La "Cuenta default" se crea sola la primera vez que abres Inicio o Fijos con tu sueldo configurado, y aquí podrás elegir otra. También puedes crearlas en <Link to="/finanzas" className="text-brand-300 hover:text-brand-200">Finanzas</Link>.
          </p>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="rounded-xl bg-[#0d263a] border border-white/10 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Próximos pagos</p>
          {upcoming.map((p) => (
            <p key={p.date.getTime()} className="text-xs font-mono text-[#c7ccd1] flex justify-between capitalize">
              <span>{format(p.date, "EEEE d 'de' MMMM", { locale: es })}</span>
              <span className="text-[#f0fae8]">{formatCOP(p.amount)}</span>
            </p>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <FormActions onSave={onSave} onCancel={restore} saving={saving} disabled={!dirty} saveLabel="Guardar sueldo y períodos" />
    </div>
  )
}
