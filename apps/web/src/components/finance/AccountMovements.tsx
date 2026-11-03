import { useEffect, useMemo, useState } from 'react'
import { endOfDay, format, startOfDay, startOfMonth, subDays, subMonths, endOfMonth } from 'date-fns'
import { CalendarRange, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '@/hooks/useAuth'
import { useHouseholdOwed } from '@/hooks/useHouseholdOwed'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import { getAccountTransfers, getAllFixedExpensePayments, getExpenses, getIncomes } from '@/lib/firestore'
import { formatCOP, PERSONAL_CATEGORIES } from '@/shared'
import type { AccountLite } from '@/components/ui/AccountChip'
import { AccountFilter } from '@/components/ui/AccountFilter'
import { SkeletonList } from '@/components/ui/Skeleton'
import { MOVEMENT_ZONES, MovementTimeline, type Movement, type MovementZone } from './MovementTimeline'

const asDate = (d: unknown) => (d instanceof Date ? d : new Date(d as any))

type Preset = 'all' | 'month' | 'last-month' | '30' | '90' | 'custom'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'all',        label: 'Todo' },
  { id: 'month',      label: 'Este mes' },
  { id: 'last-month', label: 'Mes anterior' },
  { id: '30',         label: '30 días' },
  { id: '90',         label: '90 días' },
  { id: 'custom',     label: 'Rango' },
]

/** The span a preset covers (null = no limit). */
function rangeOf(preset: Preset, from: string, to: string): { start: Date | null; end: Date | null } {
  const now = new Date()
  switch (preset) {
    case 'month': return { start: startOfMonth(now), end: endOfDay(now) }
    case 'last-month': { const m = subMonths(now, 1); return { start: startOfMonth(m), end: endOfMonth(m) } }
    case '30': return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) }
    case '90': return { start: startOfDay(subDays(now, 89)), end: endOfDay(now) }
    case 'custom': return { start: from ? startOfDay(new Date(`${from}T00:00:00`)) : null, end: to ? endOfDay(new Date(`${to}T00:00:00`)) : null }
    default: return { start: null, end: null }
  }
}

interface Props {
  accounts: (AccountLite & { balance?: number })[]
  /** Account picked on the left (null = all). */
  accountFilter: string | null
  onAccountFilter: (id: string | null) => void
  /** Changes when something that moves money is saved, so the list is read again. */
  refreshKey: number
}

/**
 * Everything that moved money through the user's accounts, newest first: fixed payments, additional spends,
 * household abonos, incomes and transfers. Filter by zone, by account and by date; the account totals show on the left.
 */
export function AccountMovements({ accounts, accountFilter, onAccountFilter, refreshKey }: Props) {
  const { user } = useAuth()
  const { abonos } = useHouseholdOwed(true)
  const households = useMyHouseholds(true)
  const [raw, setRaw] = useState<{ incomes: any[]; payments: any[]; expenses: any[]; transfers: any[] } | null>(null)
  const [zone, setZone] = useState<MovementZone | null>(null)
  const [preset, setPreset] = useState<Preset>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([
      getIncomes(user.uid).catch(() => []),
      getAllFixedExpensePayments(user.uid).catch(() => []),
      getExpenses(user.uid).catch(() => []),
      getAccountTransfers(user.uid).catch(() => []),
    ]).then(([incomes, payments, expenses, transfers]) => {
      if (!cancelled) setRaw({ incomes: incomes as any[], payments: payments as any[], expenses: expenses as any[], transfers: transfers as any[] })
    })
    return () => { cancelled = true }
  }, [user, refreshKey])

  const movements = useMemo<Movement[]>(() => {
    if (!raw) return []
    const out: Movement[] = []
    for (const i of raw.incomes) {
      if (!i.accountId) continue
      out.push({ id: `in|${i.id}`, zone: 'income', date: asDate(i.date), concept: i.concept ?? 'Ingreso', sub: i.kind === 'salary' ? 'Sueldo' : 'Ingreso adicional', amount: i.amount, accountId: i.accountId })
    }
    for (const p of raw.payments) {
      if (!p.accountId) continue
      out.push({ id: `pay|${p.id}`, zone: 'fixed', date: asDate(p.paymentDate), concept: p.concept ?? 'Pago', sub: p.auto ? 'Débito automático' : 'Gasto fijo', amount: -p.paidAmount, accountId: p.accountId })
    }
    for (const e of raw.expenses) {
      if (!e.accountId) continue
      const occasional = Boolean(e.variableBudgetId)
      out.push({
        id: `sp|${e.id}`,
        zone: occasional ? 'fixed' : 'additional',
        date: asDate(e.date),
        concept: e.description ?? 'Gasto',
        sub: occasional ? 'Gasto ocasional' : (PERSONAL_CATEGORIES.find((c) => c.id === e.category)?.label ?? e.category ?? 'Gasto adicional'),
        amount: -e.amount,
        accountId: e.accountId,
      })
    }
    for (const t of raw.transfers) {
      const date = asDate(t.date)
      const note = t.note || 'Traslado entre cuentas'
      out.push({ id: `tout|${t.id}`, zone: 'transfer', date, concept: note, sub: 'Traslado enviado', amount: -t.amount, accountId: t.fromId })
      out.push({ id: `tin|${t.id}`, zone: 'transfer', date, concept: note, sub: 'Traslado recibido', amount: t.amount, accountId: t.toId })
    }
    // A household abono is money out, but it isn't tied to an account yet
    for (const a of abonos) {
      out.push({ id: `hh|${a.id}`, zone: 'household', date: a.date, concept: 'Abono en el hogar', sub: households.find((h) => h.id === a.householdId)?.name ?? 'Hogar', amount: -a.amount })
    }
    return out.sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [raw, abonos, households])

  const { start, end } = rangeOf(preset, from, to)
  const inDates = (m: Movement) => (!start || m.date.getTime() >= start.getTime()) && (!end || m.date.getTime() <= end.getTime())
  // what the date and account filters leave; the zone chips count within it
  const base = movements
    .filter(inDates)
    // a movement without an account (the household ones) isn't in any account's list
    .filter((m) => !accountFilter || m.accountId === accountFilter)
  const shown = base.filter((m) => !zone || m.zone === zone)
  const entered = shown.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0)
  const left = shown.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0)
  const count = (z: MovementZone) => base.filter((m) => m.zone === z).length

  const dateText = start || end
    ? `${start ? format(start, 'd MMM yyyy') : 'el inicio'} – ${end ? format(end, 'd MMM yyyy') : 'hoy'}`
    : ''

  return (
    <div className="space-y-4">
      {/* Date filter: quick spans and a free range */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por fecha">
          <span className="text-[10px] uppercase tracking-wider text-[#8a929a] mr-1 inline-flex items-center gap-1"><CalendarRange size={11} aria-hidden="true" /> Fecha</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              aria-pressed={preset === p.id}
              className={clsx('rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition', preset === p.id ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white')}
            >
              {p.label}
            </button>
          ))}
          {preset !== 'all' && (
            <button type="button" onClick={() => { setPreset('all'); setFrom(''); setTo('') }} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-300 hover:text-brand-200 transition ml-1">
              <X size={11} aria-hidden="true" /> Quitar
            </button>
          )}
        </div>
        {preset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md">
            <label className="space-y-1 block">
              <span className="text-[10px] uppercase tracking-wider text-[#8a929a]">Desde</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm outline-none" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] uppercase tracking-wider text-[#8a929a]">Hasta</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm outline-none" />
            </label>
          </div>
        )}
        {preset !== 'all' && dateText && <p className="text-[11px] text-[#8a929a]">Mostrando del {dateText}</p>}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por zona">
        <button
          type="button"
          onClick={() => setZone(null)}
          aria-pressed={zone === null}
          className={clsx('rounded-lg border px-3 py-1.5 text-xs font-semibold transition', zone === null ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white')}
        >
          Todos ({base.length})
        </button>
        {MOVEMENT_ZONES.map(({ id, label, color, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setZone(zone === id ? null : id)}
            aria-pressed={zone === id}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
              zone === id ? 'text-white' : 'border-white/10 bg-[#0d263a] text-[#9aa4ac] hover:text-white',
            )}
            style={zone === id ? { backgroundColor: color + '33', borderColor: color } : undefined}
          >
            <Icon size={12} aria-hidden="true" style={{ color }} /> {label} ({count(id)})
          </button>
        ))}
      </div>

      <AccountFilter accounts={accounts} value={accountFilter} onChange={onAccountFilter} />

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#9aa4ac]">
        <span>Entró <span className="font-mono font-semibold text-brand-300">{formatCOP(entered)}</span></span>
        <span>Salió <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(left)}</span></span>
        <span className="text-[#8a929a]">{shown.length} {shown.length === 1 ? 'movimiento' : 'movimientos'}</span>
      </p>

      {!raw ? (
        <SkeletonList count={4} />
      ) : shown.length === 0 ? (
        <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
          <p className="text-sm font-bold text-[#f0fae8]">Sin movimientos</p>
          <p className="text-xs text-[#8a929a] mt-1">No hay movimientos con estos filtros. Los ingresos, pagos y gastos que registres con una cuenta aparecerán aquí.</p>
        </div>
      ) : (
        <MovementTimeline items={shown} accounts={accounts} />
      )}
    </div>
  )
}
