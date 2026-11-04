import { useMemo, useRef, useState } from 'react'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { addMonths, format, startOfDay, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { ListChecks } from 'lucide-react'
import type { DashboardData } from '@/hooks/useDashboardData'
import { useFocusToday } from '@/hooks/useFocusToday'
import { useHouseholdOwed } from '@/hooks/useHouseholdOwed'
import { useMyHouseholds } from '@/hooks/useMyHouseholds'
import { Modal } from '@/components/ui/Modal'
import { inkOn } from '@/components/ui/SegmentedBar'
import { AccountChip } from '@/components/ui/AccountChip'
import { amountFor, formatCOP, getStatus, monthKey, monthRange, occurrencesInMonth, PERSONAL_CATEGORIES, paymentKey, FIXED_EXPENSE_CATEGORIES } from '@/shared'
import { STATUS_META, type StatusKey } from '@/components/fixed/status'
import { DashCard, EmptyNote, SERIES } from './shared'

/** Months drawn, counted from the one the first confirmed salary falls in (the same axis as "Cronograma por período"). */
const MONTHS_SHOWN = 6
const DAY_MS = 86_400_000
/** Width of one day on the line: wide enough for a circle, so the line scrolls sideways. */
const DAY_W = 34
/** A run of days with nothing in it is not drawn day by day: it is squeezed into one short break of this width. */
const GAP_W = 24
/** The left column with the name of each row, and the height of a row of circles. */
const LABEL_W = 76
const LANE_H = 30
const LANES_TOP = 46

interface Item {
  id: string
  label: string
  sub: string
  amount: number
  color: string
  /** Text for the state of a fixed payment; empty for spends. */
  state: string
  /** Urgency of the state (higher = needs more attention), to color the day's circle. */
  rank: number
  /** Account the money came out of (or, for an unpaid expense, the one it is set to be paid from). */
  accountId?: string
  /** The account is only the planned one: the payment is not made yet. */
  planned?: boolean
  /** For a payment made on a different day than its due date: when it was due. */
  note?: string
  /** Screenshot of the payment / spend sent from Telegram. */
  attachmentId?: string
}

/** Sky blue: what moves in the household (abonos paid and debts still to pay). */
const HOUSEHOLD = '#38bdf8'

/** Green, like "te queda": money that came in. */
const INCOME = '#199e70'

type Track = 'fixed' | 'additional' | 'household' | 'income'

interface Day {
  day: number
  date: Date
  fixed: Item[]
  additional: Item[]
  household: Item[]
  income: Item[]
}

const dayKey = (d: Date) => startOfDay(d).getTime()
const longDay = (d: Date) => format(d, "EEEE d 'de' MMMM", { locale: es })
const RANK: Record<string, number> = { overdue: 5, 'due-soon': 4, pending: 3, upcoming: 2, auto: 1, paid: 0 }

/**
 * The spending along time, on one horizontal line like "Cronograma por período": each day that has payments
 * is a circle with how many there are. A day with fixed expenses and additional spends gets two circles (the
 * fixed one colored by its most urgent state, the additional one in the spends' color). Click a circle to see
 * what is behind it.
 */
export function ExpensesSchedule({ data }: { data: Pick<DashboardData, 'salary' | 'fixed'> }) {
  const { salary, fixed } = data
  const today = new Date()
  const [selected, setSelected] = useState<{ track: Track; day: number } | null>(null)
  const household = useHouseholdOwed(true)
  const householdList = useMyHouseholds(true)
  const scroller = useRef<HTMLDivElement>(null)

  const earliest = [...salary.periods].sort((a, b) => a.start.getTime() - b.start.getTime())[0]?.start
  const from = startOfMonth(earliest && earliest.getTime() < today.getTime() ? earliest : today)
  const to = startOfMonth(addMonths(from, MONTHS_SHOWN))
  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => addMonths(from, i))

  const days = useMemo(() => {
    const inRange = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime()
    const map = new Map<number, Day>()
    const at = (date: Date) => {
      const k = dayKey(date)
      const d = map.get(k) ?? { day: k, date: new Date(k), fixed: [], additional: [], household: [], income: [] }
      map.set(k, d)
      return d
    }

    // every occurrence of every fixed expense due in the range, with the state it is in
    // one month beyond the range too: a bill due just after it may have been paid inside it
    for (const m of monthRange(monthKey(from), monthKey(to))) {
      for (const { fe, occMonth, due } of occurrencesInMonth(fixed.expenses, m)) {
        const payment = fixed.paymentIndex.get(paymentKey(fe.id, occMonth))
        // a payment is drawn on the day it was paid; an unpaid one on its due date
        const paidOn = payment?.paymentDate ? startOfDay(payment.paymentDate instanceof Date ? payment.paymentDate : new Date(payment.paymentDate)) : null
        const shownOn = paidOn && !isNaN(paidOn.getTime()) ? paidOn : due
        if (!inRange(shownOn)) continue
        const status = getStatus(fe, occMonth, payment, today)
        if (status === 'na') continue
        const key: StatusKey = payment ? ((payment as any).auto ? 'auto' : 'paid') : status
        at(shownOn).fixed.push({
          id: `${fe.id}|${occMonth}`,
          label: fe.concept as string,
          sub: FIXED_EXPENSE_CATEGORIES.find((c) => c.id === fe.category)?.label ?? '',
          amount: payment ? payment.paidAmount : amountFor(fe, occMonth),
          color: STATUS_META[key].dot,
          state: STATUS_META[key].label,
          rank: RANK[key] ?? 0,
          accountId: (payment ? (payment as any).accountId : fe.accountId) as string | undefined,
          planned: !payment,
          attachmentId: payment ? ((payment as any).attachmentId as string | undefined) : undefined,
          note: payment && shownOn.getTime() !== startOfDay(due).getTime() ? `vencía el ${format(due, "d 'de' MMM", { locale: es })}` : undefined,
        })
      }
    }

    // additional spends (the ones that count, and the older ones kept as history)
    for (const e of salary.personal as any[]) {
      if (e.variableBudgetId) continue
      const date = e.date instanceof Date ? e.date : new Date(e.date)
      if (!inRange(date)) continue
      const counted = Boolean(e.tracked)
      at(date).additional.push({
        id: e.id as string,
        label: e.description as string,
        sub: PERSONAL_CATEGORIES.find((c) => c.id === e.category)?.label ?? (e.category as string),
        amount: e.amount as number,
        color: counted ? SERIES.additional : '#6b7280',
        state: counted ? '' : 'Anterior · no cuenta',
        rank: 0,
        accountId: e.accountId as string | undefined,
        attachmentId: e.attachmentId as string | undefined,
      })
    }
    // money that came in: the confirmed salaries and the extra incomes
    for (const s of salary.salaries as any[]) {
      if (!inRange(s.date)) continue
      at(s.date).income.push({ id: `sal|${s.id}`, label: 'Sueldo', sub: 'Sueldo', amount: s.amount, color: INCOME, state: 'Recibido', rank: 0, accountId: s.accountId, attachmentId: s.attachmentId })
    }
    for (const x of salary.extras as any[]) {
      if (!inRange(x.date)) continue
      at(x.date).income.push({ id: `ext|${x.id}`, label: x.concept, sub: 'Ingreso adicional', amount: x.amount, color: INCOME, state: 'Recibido', rank: 0, accountId: x.accountId, attachmentId: x.attachmentId })
    }

    // household: the abonos the user paid (real money out) and the debts still to pay, on their agreed date
    const houseName = (id: string) => householdList.find((h) => h.id === id)?.name ?? 'Hogar'
    for (const a of household.abonos) {
      if (!inRange(a.date)) continue
      at(a.date).household.push({
        id: `abono|${a.id}`,
        label: 'Abono en el hogar',
        sub: houseName(a.householdId),
        amount: a.amount,
        color: HOUSEHOLD,
        state: 'Pagado',
        rank: 0,
        accountId: a.accountId,
        attachmentId: a.attachmentId,
      })
    }
    for (const l of household.lines) {
      if (!l.dueDate || !inRange(l.dueDate)) continue
      const left = Math.round((startOfDay(l.dueDate).getTime() - startOfDay(today).getTime()) / DAY_MS)
      const key: StatusKey = left < 0 ? 'overdue' : left <= 7 ? 'due-soon' : 'upcoming'
      at(l.dueDate).household.push({
        id: `debt|${l.id}`,
        label: l.concept,
        sub: `Deuda · ${houseName(l.householdId)}`,
        amount: l.remaining,
        color: STATUS_META[key].dot,
        state: STATUS_META[key].label,
        rank: RANK[key] ?? 0,
        planned: true,
      })
    }
    return [...map.values()].sort((a, b) => a.day - b.day)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed.expenses, fixed.paymentIndex, salary.personal, salary.salaries, salary.extras, household.abonos, household.lines, householdList, from.getTime()])

  // The axis: only the days that have something (and today, so its mark has a place) take room; the empty stretches
  // between them are squeezed into a short break. `x` maps any date onto it, so months and salary periods follow along.
  const todayKey = dayKey(today)
  const axis = useMemo(() => {
    const keys = new Set(days.map((d) => d.day))
    if (todayKey >= from.getTime() && todayKey < to.getTime()) keys.add(todayKey)
    const cells = [...keys].sort((a, b) => a - b)
    const left = new Map<number, number>()
    const breaks: { at: number; days: number }[] = []
    let cursor = 0
    cells.forEach((k, i) => {
      if (i > 0) {
        const empty = Math.round((k - cells[i - 1]) / DAY_MS) - 1
        if (empty > 0) { breaks.push({ at: cursor + GAP_W / 2, days: empty }); cursor += GAP_W }
      }
      left.set(k, cursor)
      cursor += DAY_W
    })
    const width = Math.max(cursor, DAY_W)
    const x = (date: Date) => {
      const t = dayKey(date)
      if (cells.length === 0 || t <= cells[0]) return 0
      if (t > cells[cells.length - 1]) return width
      const exact = left.get(t)
      if (exact !== undefined) return exact
      // inside a squeezed stretch: placed in proportion to how far through it the date is
      const next = cells.findIndex((c) => c > t)
      const prev = cells[next - 1]
      const empty = Math.round((cells[next] - prev) / DAY_MS) - 1
      const through = (Math.round((t - prev) / DAY_MS) - 1) / empty
      return left.get(prev)! + DAY_W + GAP_W * through
    }
    return { cells, left, breaks, width, x }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, todayKey, from.getTime(), to.getTime()])
  const { x, width: axisW } = axis

  // open on today, so the nearest payments are the first thing seen
  const todayCell = axis.left.get(todayKey)
  useFocusToday(scroller, () => (todayCell !== undefined ? todayCell + DAY_W / 2 : null), days.length > 0)

  const periods = salary.periods.filter((p) => p.end.getTime() > from.getTime() && p.start.getTime() < to.getTime())
  const todayX = todayCell !== undefined ? todayCell + DAY_W / 2 : -1

  const picked = (() => {
    if (!selected) return null
    const d = days.find((b) => b.day === selected.day)
    if (!d) return null
    const items = d[selected.track]
    return { date: d.date, items, total: items.reduce((s, i) => s + i.amount, 0) }
  })()

  const circle = (track: Track, d: Day, items: Item[]) => {
    if (items.length === 0) return null
    // How many payments sit in each state (or color), most urgent first: the circle is split in those proportions
    const groups = new Map<string, { color: string; state: string; rank: number; count: number }>()
    for (const i of items) {
      const g = groups.get(i.color) ?? { color: i.color, state: i.state, rank: i.rank, count: 0 }
      g.count += 1
      groups.set(i.color, g)
    }
    const parts = [...groups.values()].sort((a, b) => b.rank - a.rank || b.count - a.count)
    const mixed = parts.length > 1
    let acc = 0
    const stops = parts.map((g) => {
      const from = (acc / items.length) * 100
      acc += g.count
      return `${g.color} ${from}% ${(acc / items.length) * 100}%`
    })
    // a short tooltip: how many and in what state, plus the total; the list of payments is one click away
    const plural = (state: string, n: number) => {
      const t = state.toLowerCase()
      if (n === 1 || !t || t.startsWith('anterior') || t === 'por vencer') return t
      return t.startsWith('pagado autom') ? t.replace('pagado', 'pagados') : `${t}s`
    }
    const kind = track === 'fixed' ? (items.length === 1 ? 'gasto fijo' : 'gastos fijos')
      : track === 'income' ? (items.length === 1 ? 'ingreso' : 'ingresos')
      : track === 'household' ? (items.length === 1 ? 'movimiento del hogar' : 'movimientos del hogar')
      : (items.length === 1 ? 'gasto adicional' : 'gastos adicionales')
    const mix = mixed ? ` (${parts.map((g) => `${g.count} ${g.state ? plural(g.state, g.count) : 'adicionales'}`).join(', ')})` : ''
    const total = items.reduce((sum, i) => sum + i.amount, 0)
    const label = `${format(d.date, "d 'de' MMMM", { locale: es })} · ${items.length} ${kind}${mix} · ${formatCOP(total)}`
    return (
      <button
        key={track}
        type="button"
        onClick={() => setSelected({ track, day: d.day })}
        title={label}
        aria-label={label}
        className="w-[26px] h-[26px] rounded-full flex items-center justify-center ring-2 ring-[#0a1f2f] hover:scale-110 hover:brightness-110 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        style={mixed ? { background: `conic-gradient(${stops.join(', ')})` } : { backgroundColor: parts[0].color }}
      >
        {mixed ? (
          // a dark center keeps the number readable over any mix of colors; the ring shows the proportions
          <span className="w-[16px] h-[16px] rounded-full bg-[#0a1f2f] flex items-center justify-center text-[11px] font-bold font-mono text-white">{items.length}</span>
        ) : (
          <span className="text-[12px] font-bold font-mono" style={{ color: inkOn(parts[0].color) }}>{items.length}</span>
        )}
      </button>
    )
  }

  // The rows of the chart: only those that have something at some point, each labeled on the left
  const lanes = ([
    { track: 'income', label: 'Ingresos', color: INCOME },
    { track: 'fixed', label: 'Gastos fijos', color: SERIES.fixed },
    { track: 'additional', label: 'Adicionales', color: SERIES.additional },
    { track: 'household', label: 'Hogar', color: HOUSEHOLD },
  ] as { track: Track; label: string; color: string }[]).filter((l) => days.some((d) => d[l.track].length > 0))
  const axisY = LANES_TOP + lanes.length * LANE_H + 2
  const chartH = axisY + 24

  return (
    <DashCard
      title="Cronograma de gastos"
      eyebrow="Histórico completo"
      icon={ListChecks}
      tone="#52b69a"
      info="Tus gastos a lo largo del tiempo en una sola línea. Cada círculo es un día con pagos y dice cuántos son: el de gastos fijos va coloreado por su estado de pago y el de gastos adicionales en naranja, el del hogar en azul cielo (abonos que pagaste y deudas con fecha límite) y los ingresos (sueldo e ingresos adicionales) en verde. Si un día tiene de varios tipos, aparecen varios círculos. Haz clic en uno para ver el detalle. Desliza para recorrer los meses."
    >
      {days.length === 0 ? (
        <EmptyNote icon={ListChecks}>Aún no hay gastos para dibujar.</EmptyNote>
      ) : (
        <div>
          <p className="-mt-1 mb-2 text-[11px] leading-snug text-[#6f7a83]">
            El número es la cantidad de movimientos del día; si hay varios estados, el círculo se reparte en proporción.
          </p>
          <div className="flex">
            {/* the Y axis: what each row of circles is */}
            <div className="relative flex-shrink-0" style={{ width: LABEL_W, height: chartH }} aria-hidden="true">
              {lanes.map((l, i) => (
                <span key={l.track} className="absolute left-0 flex items-center gap-1.5 text-[10px] font-semibold leading-none text-[#c7ccd1]" style={{ top: LANES_TOP + i * LANE_H, height: LANE_H - 4, width: LABEL_W - 4 }}>
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                  <span className="truncate">{l.label}</span>
                </span>
              ))}
            </div>
            <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto scrollbar-none pb-1">
              <div className="relative" style={{ width: axisW, height: chartH }}>
                {/* today's line goes first so it sits under the period ranges and the circles */}
                {todayX >= 0 && (
                  <>
                    <span className="absolute w-px bg-white/70 pointer-events-none" style={{ left: todayX, top: 44, bottom: 0 }} aria-hidden="true" />
                    <span className="absolute bottom-0 -translate-x-1/2 rounded bg-white/90 px-1 text-[9px] font-bold uppercase text-[#06131d] pointer-events-none" style={{ left: todayX }}>Hoy</span>
                  </>
                )}

                {/* month axis: only the months that have something (the others were squeezed away) */}
                {months.filter((m) => axis.cells.some((c) => c >= m.getTime() && c < addMonths(m, 1).getTime())).map((m, i) => (
                  <span key={m.getTime()} className="absolute top-0 text-[10px] font-semibold capitalize text-[#9aa4ac] border-l border-white/15 pl-1.5 h-4" style={{ left: x(m) }}>
                    {format(m, i === 0 || m.getMonth() === 0 ? 'MMMM yyyy' : 'MMMM', { locale: es })}
                  </span>
                ))}

                {/* the salary periods, as context for the dates */}
                {periods.map((p) => {
                  const left = Math.max(0, x(p.start))
                  const right = Math.min(axisW, x(p.end))
                  if (right <= left) return null
                  return (
                    <span key={p.id} className="absolute top-5 h-5 rounded border border-white/10 bg-[#0e2434] px-1.5 text-[9px] font-mono leading-5 text-[#8a929a] truncate" style={{ left, width: right - left - 2 }}>
                      {format(p.start, 'd MMM', { locale: es })} – {format(new Date(p.end.getTime() - DAY_MS), 'd MMM', { locale: es })}
                    </span>
                  )
                })}

                {/* one band per row, so each circle can be read against the label at the left */}
                {lanes.map((l, i) => (
                  <span key={l.track} className="absolute left-0 right-0 rounded-md bg-white/[0.035] pointer-events-none" style={{ top: LANES_TOP + i * LANE_H, height: LANE_H - 4 }} aria-hidden="true" />
                ))}

                {/* the line of days, with the day number under every day that has something */}
                <span className="absolute left-0 right-0 h-px bg-white/15" style={{ top: axisY }} aria-hidden="true" />
                {/* a stretch of days with nothing in it, squeezed: a small break in the line says how long it was */}
                {axis.breaks.map((b) => (
                  <span
                    key={b.at}
                    title={`${b.days} ${b.days === 1 ? 'día' : 'días'} sin movimientos`}
                    aria-label={`${b.days} ${b.days === 1 ? 'día' : 'días'} sin movimientos`}
                    className="absolute h-[18px] -translate-x-1/2 cursor-default bg-[#0a1f2f] px-0.5 text-[12px] font-bold leading-[18px] tracking-[-0.08em] text-[#7d8a94]"
                    style={{ left: b.at, top: axisY - 9 }}
                  >
                    ···
                  </span>
                ))}
                {days.map((d) => (
                  <div key={d.day}>
                    {lanes.map((l, i) => d[l.track].length > 0 && (
                      <div key={l.track} className="absolute flex items-center justify-center" style={{ left: x(d.date), width: DAY_W, top: LANES_TOP + i * LANE_H, height: LANE_H - 4 }}>
                        {circle(l.track, d, d[l.track])}
                      </div>
                    ))}
                    <span className="absolute text-center text-[10px] font-mono text-[#8a929a]" style={{ left: x(d.date), width: DAY_W, top: axisY + 5 }}>{d.date.getDate()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-[#9aa4ac]">
            {(['paid', 'auto', 'overdue', 'due-soon', 'pending', 'upcoming'] as StatusKey[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_META[k].dot }} aria-hidden="true" />
                {STATUS_META[k].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SERIES.additional }} aria-hidden="true" /> Gasto adicional
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: HOUSEHOLD }} aria-hidden="true" /> Abono al hogar
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: INCOME }} aria-hidden="true" /> Ingreso
            </span>
          </div>
        </div>
      )}

      {picked && selected && (
        <Modal open onClose={() => setSelected(null)} title={selected.track === 'fixed' ? 'Gastos fijos del día' : selected.track === 'income' ? 'Ingresos del día' : selected.track === 'household' ? 'Hogar del día' : 'Gastos adicionales del día'}>
          <p className="text-xs text-[#9aa4ac] capitalize -mt-1">{longDay(picked.date)}</p>
          <ul className="space-y-2">
            {picked.items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-[#0d263a] px-3 py-2.5">
                <span className="flex items-start gap-2.5 min-w-0">
                  <span className="mt-1 w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ backgroundColor: i.color }} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#f0fae8] break-words">{i.label}</span>
                    <span className="block text-[11px] text-[#8a929a]">{[i.sub, i.state, i.note].filter(Boolean).join(' · ')}</span>
                    <AccountChip account={salary.accounts.find((a: any) => a.id === i.accountId)} planned={i.planned} className="mt-0.5" />
                  </span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {i.attachmentId && <AttachmentButton compact attachmentId={i.attachmentId} />}
                  <span className={`font-mono text-sm font-bold whitespace-nowrap ${selected.track === 'income' ? 'text-emerald-300' : 'text-rose-300'}`}>{selected.track === 'income' ? '+' : '−'}{formatCOP(i.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
          {picked.items.length > 1 && (
            <p className="flex justify-between gap-3 border-t border-white/10 pt-2 text-xs font-mono">
              <span className="text-[#9aa4ac]">Total del día</span>
              <span className="font-bold text-[#f3f5f6]">{formatCOP(picked.total)}</span>
            </p>
          )}
        </Modal>
      )}
    </DashCard>
  )
}
