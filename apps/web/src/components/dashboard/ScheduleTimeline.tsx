import { useMemo, useRef, useState } from 'react'
import { addMonths, format, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarRange, Download, TriangleAlert } from 'lucide-react'
import { clsx } from 'clsx'
import type { SalaryState } from '@/hooks/useSalary'
import { useFocusToday } from '@/hooks/useFocusToday'
import { Modal } from '@/components/ui/Modal'
import { entryDisplayDate } from '@/components/fixed/status'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useDisplayName } from '@/hooks/useDisplayName'
import { downloadPeriodReport } from '@/lib/periodReport'
import {
  entryKey, formatCOP, monthEntries, monthKey, monthRange, payDatesBetween, salaryLedgers, PERSONAL_CATEGORIES, FIXED_EXPENSE_CATEGORIES,
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
    // by calendar month the next periods are the coming months, with the salary the schedule expects in each
    const calendarNext: { date: Date; amount: number; end: Date }[] = []
    if (salary.periodMode === 'calendar' && salary.schedule && lastEnd) {
      for (let s = new Date(lastEnd.getFullYear(), lastEnd.getMonth(), 1); s.getTime() < to.getTime(); s = new Date(s.getFullYear(), s.getMonth() + 1, 1)) {
        const e = new Date(s.getFullYear(), s.getMonth() + 1, 1)
        const amount = payDatesBetween(salary.schedule, s, lastDay(e)).reduce((sum, x) => sum + x.amount, 0)
        if (amount > 0) calendarNext.push({ date: s, amount, end: e })
      }
    }
    const pays = salary.periodMode === 'calendar' ? [] : salary.schedule && lastEnd ? payDatesBetween(salary.schedule, lastEnd, to) : []
    const upcoming = [...calendarNext.map((c): Block => ({
      id: `next|${c.date.getTime()}`, start: c.date, end: c.end, amount: c.amount, upcoming: true, current: false,
      parts: [], whole: 0, overrun: 0, period: { id: `next|${c.date.getTime()}`, start: c.date, end: c.end, amount: c.amount }, ledger: null,
    })), ...pays.map((p, i): Block => {
      const end = pays[i + 1]?.date ?? new Date(p.date.getTime() + 30 * DAY_MS)
      return {
        id: `next|${p.date.getTime()}`, start: p.date, end, amount: p.amount, upcoming: true, current: false,
        parts: [], whole: 0, overrun: 0, period: { id: `next|${p.date.getTime()}`, start: p.date, end, amount: p.amount }, ledger: null,
      }
    })]
    return [...done, ...upcoming]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salary.periods, salary.schedule, salary.periodMode, salary.extras, salary.variable, expenses, paymentIndex, from.getTime()])

  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => addMonths(from, i))
  const todayPct = pct(today)
  const hasDone = blocks.some((b) => !b.upcoming)
  // on a narrow screen the timeline scrolls sideways: open it with today in the middle
  const scroller = useRef<HTMLDivElement>(null)
  useFocusToday(scroller, () => (scroller.current ? (scroller.current.scrollWidth * todayPct) / 100 : null), hasDone)

  return (
    <DashCard
      title={salary.periodMode === 'calendar' ? 'Cronograma por mes' : 'Cronograma por período'}
      eyebrow="Snapshot mensual"
      icon={CalendarRange}
      tone={SERIES.fixed}
      info="Cada bloque es un período ya iniciado (de pago a pago, o un mes calendario según lo que elegiste en tu perfil), repartido en colores según a dónde fue el dinero. Haz clic en uno para ver el detalle. Los punteados son los próximos pagos según tu calendario: solo muestran fechas y sueldo esperado."
    >
      {!hasDone ? (
        <EmptyNote icon={CalendarRange}>Confirma tu sueldo para ver el cronograma de tus períodos.</EmptyNote>
      ) : (
        <div ref={scroller} className="overflow-x-auto scrollbar-none -mx-1 px-1">
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
      .map((x) => ({ id: x.id as string, concept: x.description as string, category: x.category as string, amount: x.amount as number, accountId: x.accountId as string | undefined, date: (x.date instanceof Date ? x.date : new Date(x.date)) as Date }))
      .filter((x) => inPeriod(x.date, p))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
    const occasional = salary.spends
      .filter((x) => x.budgetId && inPeriod(x.date, p))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
    const extras = salary.extras.filter((x) => inPeriod(x.date, p)).sort((a, b) => a.date.getTime() - b.date.getTime())
    return { fixed, additional, occasional, extras }
  }, [block, salary.personal, salary.spends, salary.extras, expenses, paymentIndex])

  const userName = useDisplayName()
  const { showToast } = useToast()
  const [downloading, setDownloading] = useState(false)

  if (!block || !block.ledger || !detail) return null
  const { period: p, ledger: l } = block
  const day = (d: Date) => format(d, "d 'de' MMM", { locale: es })
  const available = p.amount + l.extraTotal + l.carryIn
  const used = l.committed + l.additionalSpent + l.variableSpent + l.variableReserved
  const pctUsed = available > 0 ? Math.round((used / available) * 100) : 0

  async function download() {
    if (!block || !block.ledger || !detail) return
    setDownloading(true)
    try {
      const accountName = (id?: string) => (id ? (salary.accounts.find((a: any) => a.id === id)?.name as string | undefined) : undefined) ?? ''
      await downloadPeriodReport({
        userName,
        generatedAt: new Date(),
        start: p.start,
        end: lastDay(p.end),
        salary: p.amount,
        extras: detail.extras.map((x) => ({ concept: x.concept, date: x.date, amount: x.amount })),
        extraTotal: l.extraTotal,
        carryIn: l.carryIn,
        available,
        totals: { fixed: l.committed, additional: l.additionalSpent, occasional: l.variableSpent, reserved: l.variableReserved },
        remaining: l.remaining,
        fixed: detail.fixed.map(({ e, amount }) => ({
          concept: e.fe.concept as string,
          category: FIXED_EXPENSE_CATEGORIES.find((c) => c.id === e.fe.category)?.label ?? (e.fe.category as string),
          // a paid payment goes on the day it was paid
          due: entryDisplayDate(e),
          amount,
          state: e.owed.length === 0 ? 'Pagado' : e.arrears.length > 0 || e.status === 'overdue' ? 'Vencido' : 'Por pagar',
          paidOn: e.owed.length === 0 && e.payment?.paymentDate ? (e.payment.paymentDate instanceof Date ? e.payment.paymentDate : new Date(e.payment.paymentDate)) : null,
        })),
        additional: detail.additional.map((x) => ({
          concept: x.concept,
          category: PERSONAL_CATEGORIES.find((c) => c.id === x.category)?.label ?? x.category,
          date: x.date,
          amount: x.amount,
          account: accountName(x.accountId),
        })),
        occasional: detail.occasional.map((x) => ({ concept: x.concept, date: x.date, amount: x.amount })),
        accounts: salary.accounts.map((a: any) => ({ name: a.name as string, balance: a.balance as number })),
      })
    } catch {
      showToast('No se pudo generar el reporte', 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Período ${day(p.start)} – ${day(lastDay(p.end))}`}>
      <div className="space-y-4">
        <p className="text-sm text-[#c7ccd1] leading-relaxed">
          {l.remaining < 0
            ? <>Los gastos de este período superan lo disponible por <span className="font-mono font-semibold text-red-300">{formatCOP(-l.remaining)}</span>.</>
            : <>De <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(available)}</span> disponibles ya hay comprometido el <span className="font-semibold text-[#f0fae8]">{pctUsed}%</span>. Te quedan <span className="font-mono font-semibold text-brand-300">{formatCOP(l.remaining)}</span>.</>}
        </p>

        <div className="flex h-3 gap-px" aria-hidden="true">
          {block.parts.map((x) => <div key={x.key} className="h-full rounded-[2px]" style={{ width: `${(x.value / block.whole) * 100}%`, backgroundColor: x.color }} />)}
        </div>

        <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
          {block.parts.filter((x) => x.value > 0).map((x) => (
            <li key={x.key} className="flex items-center gap-2 min-w-0 text-xs">
              <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ backgroundColor: x.color }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[#9aa4ac] truncate">{x.label}</span>
                <span className="block font-mono font-semibold text-[#f0fae8]">{formatCOP(x.value)}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3 space-y-2">
          <p className="text-xs text-[#9aa4ac] leading-relaxed">
            El reporte en PDF explica el período paso a paso: de dónde vino el dinero, a dónde se fue y el detalle de cada gasto fijo, adicional y ocasional.
          </p>
          <Button type="button" className="w-full" notched onClick={download} disabled={downloading}>
            <Download size={15} aria-hidden="true" /> {downloading ? 'Generando reporte…' : 'Descargar reporte (PDF)'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
