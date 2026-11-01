import { useMemo, useState } from 'react'
import { addMonths, format, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarRange, CircleCheck, TriangleAlert } from 'lucide-react'
import { clsx } from 'clsx'
import type { SalaryState } from '@/hooks/useSalary'
import { Modal } from '@/components/ui/Modal'
import {
  entryKey, formatCOP, monthEntries, monthKey, monthRange, payDatesBetween, salaryLedgers, PERSONAL_CATEGORIES,
  type PeriodLedger, type SalaryPeriod,
} from '@/shared'
import { compactCOP, DashCard, EmptyNote, SERIES } from './shared'

/** Months drawn, counted from the one the first confirmed salary falls in. */
const MONTHS_SHOWN = 6
const DAY_MS = 86_400_000

interface Part {
  key: string
  label: string
  value: number
  color: string
}

interface Block {
  id: string
  start: Date
  end: Date
  amount: number
  /** Not paid yet: only its dates and expected salary are known, so no breakdown is drawn. */
  upcoming: boolean
  current: boolean
  parts: Part[]
  whole: number
  overrun: number
  period: SalaryPeriod
  ledger: PeriodLedger | null
}

interface Props {
  salary: SalaryState
  expenses: any[]
  paymentIndex: Map<string, { paidAmount: number; paymentDate?: Date | string }>
}

const shortDate = (d: Date) => format(d, 'd MMM', { locale: es })
const lastDay = (d: Date) => new Date(d.getTime() - DAY_MS)

/**
 * One-row snapshot per salary period along a month axis. Each confirmed period is a block filled with
 * where its money goes (fixed, additional, occasional, reserved, what is left), like "¿A dónde se fue
 * el sueldo?". Periods still to come show only their dates and expected salary: nothing is guessed.
 */
export function ScheduleTimeline({ salary, expenses, paymentIndex }: Props) {
  const today = new Date()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const earliest = [...salary.periods].sort((a, b) => a.start.getTime() - b.start.getTime())[0]?.start
  const from = startOfMonth(earliest && earliest.getTime() < today.getTime() ? earliest : today)
  const to = startOfMonth(addMonths(from, MONTHS_SHOWN))
  const span = to.getTime() - from.getTime()
  const pct = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - from.getTime()) / span) * 100))

  const blocks = useMemo<Block[]>(() => {
    const confirmed = salary.periods
    // chained, so every period starts with what the previous one left over
    const ledgers = salaryLedgers(confirmed, expenses, paymentIndex, today, salary.extras, salary.variable)

    const done = confirmed.flatMap((p): Block[] => {
      const l = ledgers.get(p.id)
      if (!l || p.end.getTime() <= from.getTime() || p.start.getTime() >= to.getTime()) return []
      const parts: Part[] = [
        { key: 'fixed', label: 'Gastos fijos', value: l.committed, color: SERIES.fixed },
        { key: 'additional', label: 'Adicionales', value: l.additionalSpent, color: SERIES.additional },
        { key: 'occasional', label: 'Ocasionales', value: l.variableSpent, color: SERIES.occasional },
        { key: 'reserved', label: 'Reservado', value: l.variableReserved, color: SERIES.reserved },
        { key: 'left', label: 'Te queda', value: Math.max(0, l.remaining), color: SERIES.left },
      ].filter((x) => x.value > 0)
      const used = parts.reduce((s, x) => s + x.value, 0)
      return [{
        id: p.id, start: p.start, end: p.end, amount: p.amount, upcoming: false,
        current: today.getTime() >= p.start.getTime() && today.getTime() < p.end.getTime(),
        parts, whole: Math.max(used, p.amount + l.extraTotal + l.carryIn),
        overrun: l.remaining < 0 ? -l.remaining : 0, period: p, ledger: l,
      }]
    })

    // the pay schedule says when the next ones fall; they get no breakdown until the salary is paid
    const lastEnd = [...confirmed].sort((a, b) => b.end.getTime() - a.end.getTime())[0]?.end
    const pays = salary.schedule && lastEnd ? payDatesBetween(salary.schedule, lastEnd, to) : []
    const upcoming = pays.map((p, i): Block => {
      const end = pays[i + 1]?.date ?? new Date(p.date.getTime() + 30 * DAY_MS)
      return {
        id: `next|${p.date.getTime()}`, start: p.date, end, amount: p.amount, upcoming: true, current: false,
        parts: [], whole: 0, overrun: 0, period: { id: `next|${p.date.getTime()}`, start: p.date, end, amount: p.amount }, ledger: null,
      }
    })
    return [...done, ...upcoming]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salary.periods, salary.schedule, salary.extras, salary.variable, expenses, paymentIndex, from.getTime()])

  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => addMonths(from, i))
  const todayPct = pct(today)
  const hasDone = blocks.some((b) => !b.upcoming)

  return (
    <DashCard
      title="Cronograma por período"
      eyebrow="Snapshot mensual"
      icon={CalendarRange}
      tone={SERIES.fixed}
      info="Cada bloque es un período de sueldo ya pagado, repartido en colores según a dónde fue el dinero. Haz clic en uno para ver el detalle. Los punteados son los próximos pagos según tu calendario: solo muestran fechas y sueldo esperado."
    >
      {!hasDone ? (
        <EmptyNote icon={CalendarRange}>Confirma tu sueldo para ver el cronograma de tus períodos.</EmptyNote>
      ) : (
        <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
          <div className="min-w-[560px]">
            {/* month axis */}
            <div className="relative h-4 border-b border-white/10 mb-2">
              {months.map((m) => (
                <span key={m.getTime()} className="absolute text-[10px] font-semibold capitalize text-[#9aa4ac] border-l border-white/15 pl-1.5" style={{ left: `${pct(m)}%` }}>
                  {format(m, m.getMonth() === 0 || m.getTime() === from.getTime() ? 'MMM yyyy' : 'MMM', { locale: es })}
                </span>
              ))}
            </div>

            {/* the single track: one block per period */}
            <div className="relative h-24 rounded-md bg-white/[0.02]">
              {months.map((m) => (
                <span key={m.getTime()} className="absolute inset-y-0 border-l border-white/[0.06]" style={{ left: `${pct(m)}%` }} aria-hidden="true" />
              ))}
              {blocks.map((b) => {
                const left = pct(b.start)
                const width = pct(b.end) - left
                if (width <= 0) return null
                const range = `${shortDate(b.start)} – ${shortDate(lastDay(b.end))}`
                const label = (
                  <span className="absolute top-1.5 left-1.5 right-1.5 flex items-center gap-1 pointer-events-none">
                    <span className="min-w-0 rounded bg-[#0a1f2f]/90 px-1.5 py-0.5 leading-tight">
                      <span className="block truncate text-[11px] font-bold text-[#f0fae8]">{b.upcoming ? '≈ ' : ''}{compactCOP(b.amount)}</span>
                      <span className="block truncate text-[9px] font-mono text-[#9aa4ac]">{range}</span>
                    </span>
                    {b.overrun > 0 && <TriangleAlert size={13} className="flex-shrink-0 text-red-200" aria-label={`Te pasas por ${formatCOP(b.overrun)}`} />}
                  </span>
                )
                const place = { left: `${left}%`, width: `calc(${width}% - 2px)` }

                if (b.upcoming) {
                  return (
                    <div key={b.id} className="absolute top-1 bottom-1 rounded-md border border-dashed border-white/25 bg-white/[0.03]" style={place} title={`Próximo pago · ${range}`}>
                      {label}
                    </div>
                  )
                }
                const summary = b.parts.map((p) => `${p.label} ${formatCOP(p.value)} (${Math.round((p.value / b.whole) * 100)}%)`).join(', ')
                return (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    aria-label={`Ver detalle del período ${range}: ${summary}`}
                    className={clsx(
                      'absolute top-1 bottom-1 rounded-md overflow-hidden min-w-0 border text-left cursor-pointer transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white',
                      b.current ? 'border-white/70' : 'border-white/20',
                    )}
                    style={place}
                  >
                    {/* the whole block is the distribution: every colour takes its share of the period */}
                    <span className="absolute inset-0 flex gap-px">
                      {b.parts.map((p) => (
                        <span
                          key={p.key}
                          title={`${p.label}: ${formatCOP(p.value)} · ${Math.round((p.value / b.whole) * 100)}%`}
                          className="h-full min-w-[2px]"
                          style={{ width: `${(p.value / b.whole) * 100}%`, backgroundColor: p.color }}
                        />
                      ))}
                    </span>
                    {label}
                  </button>
                )
              })}
              {todayPct > 0 && todayPct < 100 && (
                <span className="absolute inset-y-0 w-px bg-white/80 z-10 pointer-events-none" style={{ left: `${todayPct}%` }} aria-hidden="true" />
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-[#9aa4ac]">
              {[
                { label: 'Fijos', color: SERIES.fixed },
                { label: 'Adicionales', color: SERIES.additional },
                { label: 'Ocasionales', color: SERIES.occasional },
                { label: 'Reservado', color: SERIES.reserved },
                { label: 'Te queda', color: SERIES.left },
              ].map((l) => (
                <span key={l.label} className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: l.color }} aria-hidden="true" />
                  {l.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-4 h-2.5 rounded-sm border border-dashed border-white/40" aria-hidden="true" /> Próximo pago
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-px h-3 bg-white/80" aria-hidden="true" /> Hoy
              </span>
            </div>
          </div>
        </div>
      )}

      <PeriodDetail
        block={blocks.find((b) => b.id === selectedId && !b.upcoming) ?? null}
        salary={salary}
        expenses={expenses}
        paymentIndex={paymentIndex}
        onClose={() => setSelectedId(null)}
      />
    </DashCard>
  )
}

const inPeriod = (d: Date, p: SalaryPeriod) => d.getTime() >= p.start.getTime() && d.getTime() < p.end.getTime()

/** What one period holds: where the money comes from and goes, with every item behind each colour. */
function PeriodDetail({ block, salary, expenses, paymentIndex, onClose }: {
  block: Block | null
  salary: SalaryState
  expenses: any[]
  paymentIndex: Props['paymentIndex']
  onClose: () => void
}) {
  const detail = useMemo(() => {
    if (!block?.ledger) return null
    const { period: p, ledger } = block
    const today = new Date()
    // fixed expenses charged to this period, in date order, with what each took out of the salary
    const fixed = monthRange(monthKey(p.start), monthKey(lastDay(p.end)))
      .flatMap((m) => monthEntries(expenses, m, paymentIndex, today))
      .filter((e) => e.due && inPeriod(e.due, p))
      .map((e) => ({ e, amount: ledger.rows.get(entryKey(e))?.amount ?? 0 }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => a.e.due!.getTime() - b.e.due!.getTime())
    const additional = salary.personal
      .filter((x) => x.tracked && !x.variableBudgetId)
      .map((x) => ({ id: x.id as string, concept: x.description as string, category: x.category as string, amount: x.amount as number, date: (x.date instanceof Date ? x.date : new Date(x.date)) as Date }))
      .filter((x) => inPeriod(x.date, p))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
    const occasional = salary.spends
      .filter((x) => x.budgetId && inPeriod(x.date, p))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
    const extras = salary.extras.filter((x) => inPeriod(x.date, p)).sort((a, b) => a.date.getTime() - b.date.getTime())
    return { fixed, additional, occasional, extras }
  }, [block, salary.personal, salary.spends, salary.extras, expenses, paymentIndex])

  if (!block || !block.ledger || !detail) return null
  const { period: p, ledger: l } = block
  const day = (d: Date) => format(d, "d 'de' MMM", { locale: es })
  const available = p.amount + l.extraTotal + l.carryIn

  const Line = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <p className="flex justify-between gap-3 text-xs"><span className="text-[#9aa4ac]">{label}</span><span className={clsx('font-mono font-semibold', tone ?? 'text-[#f0fae8]')}>{value}</span></p>
  )
  const Item = ({ left, sub, right }: { left: string; sub?: string; right: string }) => (
    <li className="flex items-start justify-between gap-3 text-xs">
      <span className="min-w-0"><span className="block truncate text-[#f0fae8]">{left}</span>{sub && <span className="block text-[10px] text-[#8a929a]">{sub}</span>}</span>
      <span className="font-mono text-[#c7ccd1] flex-shrink-0">{right}</span>
    </li>
  )
  const Section = ({ color, title: t, total, children }: { color: string; title: string; total: number; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <p className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[#9aa4ac]">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden="true" />{t}</span>
        <span className="font-mono text-[#f0fae8]">{formatCOP(total)}</span>
      </p>
      <ul className="space-y-1.5 pl-4">{children}</ul>
    </div>
  )

  return (
    <Modal open onClose={onClose} title={`Período ${day(p.start)} – ${day(lastDay(p.end))}`}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Line label="Sueldo" value={formatCOP(p.amount)} />
          {l.extraTotal > 0 && <Line label="Ingresos adicionales" value={`+${formatCOP(l.extraTotal)}`} tone="text-violet-300" />}
          {l.carryIn !== 0 && <Line label={l.carryIn > 0 ? 'Sobrante anterior' : 'Faltante anterior'} value={`${l.carryIn > 0 ? '+' : '−'}${formatCOP(Math.abs(l.carryIn))}`} tone={l.carryIn > 0 ? 'text-sky-300' : 'text-red-300'} />}
          <Line label="Disponible" value={formatCOP(available)} />
          <div className="flex h-3 gap-px" aria-hidden="true">
            {block.parts.map((x) => <div key={x.key} className="h-full rounded-[2px]" style={{ width: `${(x.value / block.whole) * 100}%`, backgroundColor: x.color }} />)}
          </div>
          <Line label={l.remaining < 0 ? 'Faltante del período' : 'Te queda'} value={formatCOP(l.remaining)} tone={l.remaining < 0 ? 'text-red-300' : 'text-brand-300'} />
        </div>

        {detail.fixed.length > 0 && (
          <Section color={SERIES.fixed} title="Gastos fijos" total={l.committed}>
            {detail.fixed.map(({ e, amount }) => (
              <Item key={entryKey(e)} left={e.fe.concept} sub={`${day(e.due!)}${e.owed.length === 0 ? ' · pagado' : ''}`} right={formatCOP(amount)} />
            ))}
          </Section>
        )}
        {detail.additional.length > 0 && (
          <Section color={SERIES.additional} title="Gastos adicionales" total={l.additionalSpent}>
            {detail.additional.map((x) => <Item key={x.id} left={x.concept} sub={`${day(x.date)} · ${PERSONAL_CATEGORIES.find((c) => c.id === x.category)?.label ?? x.category}`} right={formatCOP(x.amount)} />)}
          </Section>
        )}
        {detail.occasional.length > 0 && (
          <Section color={SERIES.occasional} title="Gastos ocasionales" total={l.variableSpent}>
            {detail.occasional.map((x) => <Item key={x.id} left={x.concept} sub={day(x.date)} right={formatCOP(x.amount)} />)}
          </Section>
        )}
        {l.variableReserved > 0 && (
          <Section color={SERIES.reserved} title="Reservado para ocasionales" total={l.variableReserved}>
            <li className="text-[11px] text-[#8a929a]">Lo que aún no gastas de tus presupuestos ocasionales; sigue disponible hasta que cierre el período.</li>
          </Section>
        )}
        {detail.extras.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-violet-300">Ingresos adicionales</p>
            <ul className="space-y-1.5 pl-4">
              {detail.extras.map((x) => <Item key={x.id} left={x.concept} sub={day(x.date)} right={`+${formatCOP(x.amount)}`} />)}
            </ul>
          </div>
        )}
        {detail.fixed.length + detail.additional.length + detail.occasional.length === 0 && (
          <p className="flex items-center gap-2 text-xs text-[#8a929a]"><CircleCheck size={14} aria-hidden="true" /> Este período aún no tiene gastos registrados.</p>
        )}
      </div>
    </Modal>
  )
}
