import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { ArrowDownRight, ArrowUpRight, CalendarCheck, CalendarClock, ChevronDown, Home, Lightbulb, ListChecks, Minus, RotateCcw, ShoppingBag, SlidersHorizontal, Tag as TagIcon } from 'lucide-react'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { TagChip } from '@/components/ui/TagPicker'
import { useTags } from '@/hooks/useTags'
import { useAuth } from '@/hooks/useAuth'
import {
  FIXED_EXPENSE_CATEGORIES, PERSONAL_CATEGORIES, formatCOP, isPaused, monthBounds, periodEntries, shiftMonth, type MonthEntry,
} from '@/shared'
import type { SalaryState } from '@/hooks/useSalary'
import type { HouseholdAbono } from '@/hooks/useHouseholdOwed'

/**
 * Categorical slots, in this fixed order (validated together on the dark surface: lightness band, chroma, CVD and
 * normal-vision separation, contrast). The order is also the order of the segments in the composition bar.
 */
const TYPE_COLOR = { fixed: '#3987e5', additional: '#d95926', household: '#199e70', occasional: '#c98500' } as const
/** Single series (the categories): one hue, so the length carries the meaning. */
const BAR = '#3987e5'

type Kind = keyof typeof TYPE_COLOR
const KIND_META: Record<Kind, { label: string; icon: typeof ShoppingBag; what: string }> = {
  fixed: { label: 'Gastos fijos', icon: CalendarCheck, what: 'lo que pagas todos los meses sí o sí: arriendo, servicios, cuotas, suscripciones' },
  additional: { label: 'Gastos adicionales', icon: ShoppingBag, what: 'lo del día a día que no estaba planeado: comidas, compras, salidas, antojos' },
  household: { label: 'Abonos al hogar', icon: Home, what: 'lo que pagaste de los gastos compartidos del hogar' },
  occasional: { label: 'Gastos ocasionales', icon: CalendarClock, what: 'gastos que sabes que llegan pero sin fecha ni valor fijo: gasolina, tarjeta' },
}

interface Spend { id: string; kind: Kind; concept: string; amount: number; date: Date; category: string; tagIds: string[] }
/** Something still to pay in the period (it does not weigh in what was spent): an unpaid fixed bill, or what is left of an occasional estimate. */
interface Pending { kind: Kind; concept: string; amount: number; category: string; tagIds: string[]; estimate: boolean }

interface Props {
  salary: SalaryState
  expenses: any[]
  paymentIndex: Map<string, any>
  abonos: HouseholdAbono[]
  month: string
}

const asDate = (d: unknown) => (d instanceof Date ? d : new Date(d as any))
const categoryLabel = (id: string) => PERSONAL_CATEGORIES.find((c) => c.id === id)?.label ?? FIXED_EXPENSE_CATEGORIES.find((c) => c.id === id)?.label ?? 'Otro'
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const days = (b: { start: Date; end: Date }) => Math.max(1, Math.round((b.end.getTime() - b.start.getTime()) / 86_400_000))

/**
 * Everything the user spent in a pay period, worked out from the same records Mi dinero lists: the money that really
 * left their accounts (cash registered without an account is not counted, as everywhere else).
 */
function spendsOf(salary: SalaryState, expenses: any[], paymentIndex: Map<string, any>, abonos: HouseholdAbono[], month: string, bounds: { start: Date; end: Date }) {
  const inside = (d: Date) => d.getTime() >= bounds.start.getTime() && d.getTime() < bounds.end.getTime()
  const out: Spend[] = []
  const entries = periodEntries(expenses, month, bounds, paymentIndex, new Date())
  for (const e of entries as MonthEntry<any>[]) {
    if (e.owed.length > 0 || !e.payment) continue
    out.push({ id: `fx|${e.fe.id}|${e.hostMonth}`, kind: 'fixed', concept: e.fe.concept, amount: e.payment.paidAmount, date: asDate(e.payment.paymentDate), category: e.fe.category ?? 'otro', tagIds: e.fe.tagIds ?? [] })
  }
  for (const x of salary.personal) {
    const date = asDate(x.date)
    if (!inside(date) || !salary.movesMoney(date, x.accountId)) continue
    if (x.variableBudgetId) out.push({ id: `sp|${x.id}`, kind: 'occasional', concept: x.description ?? 'Gasto ocasional', amount: x.amount, date, category: x.category ?? 'otro', tagIds: salary.budgets.find((b) => b.id === x.variableBudgetId)?.tagIds ?? [] })
    else if (x.tracked) out.push({ id: `sp|${x.id}`, kind: 'additional', concept: x.description ?? 'Gasto', amount: x.amount, date, category: x.category ?? 'otro', tagIds: x.tagIds ?? [] })
  }
  for (const a of abonos) {
    if (!inside(a.date) || !salary.movesMoney(a.date, a.accountId)) continue
    out.push({ id: `hh|${a.id}`, kind: 'household', concept: 'Abono en el hogar', amount: a.amount, date: a.date, category: 'hogar', tagIds: [] })
  }
  const owed = entries.reduce((s, e) => s + (e.owed.length > 0 ? e.total : 0), 0)
  // still to pay in the period: unpaid fixed bills, and what is left of each occasional estimate (only while it is open)
  const pending: Pending[] = []
  for (const e of entries as MonthEntry<any>[]) {
    if (e.owed.length > 0) pending.push({ kind: 'fixed', concept: e.fe.concept, amount: e.total, category: e.fe.category ?? 'otro', tagIds: e.fe.tagIds ?? [], estimate: false })
  }
  const open = new Date() >= bounds.start && new Date() < bounds.end
  if (open) {
    for (const b of salary.budgets) {
      if (!b.active || b.source === 'household-debt' || isPaused(b, month) || !(b.amount > 0)) continue
      const spent = out.filter((x) => x.kind === 'occasional' && salary.personal.some((p) => `sp|${p.id}` === x.id && p.variableBudgetId === b.id)).reduce((t, x) => t + x.amount, 0)
      if (b.amount - spent > 0) pending.push({ kind: 'occasional', concept: b.concept, amount: b.amount - spent, category: b.category, tagIds: b.tagIds ?? [], estimate: true })
    }
  }
  const income = [...salary.salaries, ...salary.extras].filter((i) => inside(i.date)).reduce((s, i) => s + i.amount, 0)
  return { spends: out, owed, income, pending }
}

/** Up / down / same against the previous period, in words and with an arrow (never color alone). */
function Change({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (before <= 0) return <span className="text-[11px] text-[#8a929a]">sin datos del período anterior</span>
  const diff = now - before
  const p = Math.round((Math.abs(diff) / before) * 100)
  if (p < 3) return <span className="inline-flex items-center gap-1 text-[11px] text-[#9aa4ac]"><Minus size={12} aria-hidden="true" /> igual que el período anterior</span>
  const up = diff > 0
  const bad = invert ? !up : up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[11px] font-semibold', bad ? 'text-red-300' : 'text-brand-300')}>
      <Icon size={13} aria-hidden="true" /> {p}% {up ? 'más' : 'menos'} que el período anterior ({formatCOP(before)})
    </span>
  )
}

const card = 'rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl'
const eyebrow = 'font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold'

/**
 * Mi dinero's report: the period explained in plain words, for someone who doesn't want to read the timeline. How much
 * was spent against what came in, how it splits by kind of expense, what weighs the most, the biggest expenses, the
 * day-to-day spending, and a few sentences that sum it up — each compared with the previous period.
 */
export function MoneyReport({ salary, expenses, paymentIndex, abonos, month }: Props) {
  const bounds = useMemo(() => monthBounds(month, salary.periods, salary.boundsSchedule), [month, salary.periods, salary.boundsSchedule])
  const prevMonth = shiftMonth(month, -1)
  const prevBounds = useMemo(() => monthBounds(prevMonth, salary.periods, salary.boundsSchedule), [prevMonth, salary.periods, salary.boundsSchedule])
  const nowAll = useMemo(() => spendsOf(salary, expenses, paymentIndex, abonos, month, bounds), [salary, expenses, paymentIndex, abonos, month, bounds])
  const prevAll = useMemo(() => spendsOf(salary, expenses, paymentIndex, abonos, prevMonth, prevBounds), [salary, expenses, paymentIndex, abonos, prevMonth, prevBounds])

  // ── What the person chose to include (remembered in this browser) ──
  const { user } = useAuth()
  const storeKey = `report-builder:${user?.uid ?? ''}`
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? 'null') } catch { return null } }, [storeKey])
  const [kindSel, setKindSel] = useState<string[]>(saved?.kinds ?? [])
  const [catSel, setCatSel] = useState<string[]>(saved?.cats ?? [])
  const [excluded, setExcluded] = useState<string[]>(saved?.excluded ?? [])
  const [pickOpen, setPickOpen] = useState(false)
  const [tagSel, setTagSel] = useState<string[]>(saved?.tags ?? [])
  useEffect(() => {
    try { localStorage.setItem(storeKey, JSON.stringify({ kinds: kindSel, cats: catSel, excluded, tags: tagSel })) } catch { /* private mode */ }
  }, [storeKey, kindSel, catSel, excluded, tagSel])
  const { tags: allTags } = useTags()
  const tagOk = (ids: string[]) => tagSel.length === 0 || tagSel.some((t) => (t === 'none' ? ids.length === 0 : ids.includes(t)))
  const passes = (x: { kind: Kind; category: string; tagIds: string[] }) => (kindSel.length === 0 || kindSel.includes(x.kind)) && (catSel.length === 0 || catSel.includes(categoryLabel(x.category))) && tagOk(x.tagIds)
  const now = { ...nowAll, spends: nowAll.spends.filter((x) => passes(x) && !excluded.includes(x.id)), owed: kindSel.length === 0 || kindSel.includes('fixed') ? nowAll.owed : 0 }
  const prev = { ...prevAll, spends: prevAll.spends.filter(passes) }
  const removedCount = nowAll.spends.filter((x) => excluded.includes(x.id)).length
  const customized = kindSel.length > 0 || catSel.length > 0 || tagSel.length > 0 || removedCount > 0
  const reset = () => { setKindSel([]); setCatSel([]); setExcluded([]); setTagSel([]) }
  const toggleOne = (id: string) => setExcluded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))
  const catOptions = [...new Set(nowAll.spends.map((x) => categoryLabel(x.category)))].sort((a, b) => a.localeCompare(b, 'es'))
    .map((c) => ({ value: c, label: c, count: nowAll.spends.filter((x) => categoryLabel(x.category) === c).length }))
  const pickable = nowAll.spends.filter(passes).sort((a, b) => b.date.getTime() - a.date.getTime())
  const pendingShown = nowAll.pending.filter(passes)
  const tagOptions = [
    ...allTags.map((t) => ({ value: t.id, label: t.name, color: t.color, count: nowAll.spends.filter((x) => x.tagIds.includes(t.id)).length })),
    { value: 'none', label: 'Sin etiqueta', count: nowAll.spends.filter((x) => x.tagIds.length === 0).length },
  ]

  const total = now.spends.reduce((s, x) => s + x.amount, 0)
  const prevTotal = prev.spends.reduce((s, x) => s + x.amount, 0)
  const sumKind = (list: Spend[], k: Kind) => list.filter((x) => x.kind === k).reduce((s, x) => s + x.amount, 0)
  const kinds = (Object.keys(TYPE_COLOR) as Kind[]).map((k) => ({ k, value: sumKind(now.spends, k), before: sumKind(prev.spends, k), count: now.spends.filter((x) => x.kind === k).length }))
  const shown = kinds.filter((x) => x.value > 0)
  // per tag: what was paid (it weighs) and what is still to pay with it (it doesn't)
  const tagRows = allTags
    .filter((t) => tagSel.length === 0 || tagSel.includes(t.id))
    .map((tag) => {
      const mine = now.spends.filter((x) => x.tagIds.includes(tag.id))
      const pend = pendingShown.filter((x) => x.tagIds.includes(tag.id))
      return {
        tag,
        paid: mine.reduce((t, x) => t + x.amount, 0),
        pending: pend.reduce((t, x) => t + x.amount, 0),
        pendingItems: pend,
        byKind: (Object.keys(TYPE_COLOR) as Kind[]).map((k) => ({ k, value: mine.filter((x) => x.kind === k).reduce((t, x) => t + x.amount, 0) })).filter((x) => x.value > 0),
      }
    })
    .filter((r) => r.paid > 0 || r.pending > 0)
    .sort((a, b) => b.paid + b.pending - (a.paid + a.pending))
  const tagMax = Math.max(1, ...tagRows.map((r) => r.paid + r.pending))
  const pendingTotal = pendingShown.reduce((t, x) => t + x.amount, 0)

  // categories across every kind (a fixed "Servicios públicos" and an additional one add up)
  const byCategory = new Map<string, number>()
  for (const x of now.spends) {
    const label = categoryLabel(x.category)
    byCategory.set(label, (byCategory.get(label) ?? 0) + x.amount)
  }
  const cats = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
  const topCats = cats.slice(0, 6)
  const restCats = cats.slice(6).reduce((s, [, v]) => s + v, 0)
  const maxCat = topCats[0]?.[1] ?? 1

  const biggest = [...now.spends].sort((a, b) => b.amount - a.amount).slice(0, 6)

  const additional = now.spends.filter((x) => x.kind === 'additional')
  const additionalTotal = sumKind(now.spends, 'additional')
  const prevAdditional = sumKind(prev.spends, 'additional')
  const today = new Date()
  const elapsed = today >= bounds.start && today < bounds.end ? Math.max(1, Math.ceil((today.getTime() - bounds.start.getTime()) / 86_400_000)) : days(bounds)
  const perDay = additionalTotal / elapsed
  const byDay = new Map<string, number>()
  for (const x of additional) byDay.set(format(x.date, 'yyyy-MM-dd'), (byDay.get(format(x.date, 'yyyy-MM-dd')) ?? 0) + x.amount)
  const worstDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]
  const addCats = new Map<string, number>()
  for (const x of additional) addCats.set(categoryLabel(x.category), (addCats.get(categoryLabel(x.category)) ?? 0) + x.amount)
  const topAddCat = [...addCats.entries()].sort((a, b) => b[1] - a[1])[0]

  // the summary, in plain sentences
  const insights: string[] = []
  if (total > 0) {
    const lead = [...shown].sort((a, b) => b.value - a.value)[0]
    if (lead) insights.push(`La mayor parte (${pct(lead.value, total)}%) se fue en ${KIND_META[lead.k].label.toLowerCase()}: ${KIND_META[lead.k].what}.`)
    if (topCats[0]) insights.push(`Lo que más pesa es "${topCats[0][0]}": ${formatCOP(topCats[0][1])}, el ${pct(topCats[0][1], total)}% de todo lo que gastaste.`)
    if (now.income > 0) insights.push(total > now.income
      ? `Gastaste ${formatCOP(total - now.income)} más de lo que entró en el período.`
      : `De cada $100 que entraron, gastaste $${pct(total, now.income)} y te quedaron $${100 - pct(total, now.income)}.`)
    if (prevAdditional > 0 && additionalTotal > prevAdditional * 1.1) insights.push(`Los gastos del día a día van ${pct(additionalTotal - prevAdditional, prevAdditional)}% por encima del período anterior${topAddCat ? `; lo que más creció tu bolsillo fue "${topAddCat[0]}"` : ''}.`)
    else if (prevAdditional > 0 && additionalTotal < prevAdditional * 0.9) insights.push(`Bien: los gastos del día a día van ${pct(prevAdditional - additionalTotal, prevAdditional)}% por debajo del período anterior.`)
    if (now.owed > 0) insights.push(`Todavía faltan ${formatCOP(now.owed)} de gastos fijos por pagar en este período.`)
  }

  const builder = (
    <section className={card} aria-label="Construir mi reporte">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={clsx(eyebrow, 'inline-flex items-center gap-1.5')}><SlidersHorizontal size={12} aria-hidden="true" /> Construir mi reporte</p>
        {customized && <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-300 hover:text-brand-200"><RotateCcw size={11} aria-hidden="true" /> Incluir todo otra vez</button>}
      </div>
      <p className="text-[11px] text-[#8a929a] -mt-1">Elige qué gastos entran al reporte. Todo lo de abajo, incluida la comparación con el período anterior, se calcula solo con lo elegido.</p>
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect label="Tipos" allLabel="Todos" value={kindSel} onChange={setKindSel}
          options={(Object.keys(TYPE_COLOR) as Kind[]).map((k) => ({ value: k, label: KIND_META[k].label, color: TYPE_COLOR[k], count: nowAll.spends.filter((x) => x.kind === k).length }))} />
        {catOptions.length > 0 && <MultiSelect label="Categorías" allLabel="Todas" value={catSel} onChange={setCatSel} options={catOptions} />}
        {allTags.length > 0 && <MultiSelect label="Etiquetas" allLabel="Todas" value={tagSel} onChange={setTagSel} options={tagOptions} />}
        <button type="button" onClick={() => setPickOpen((o) => !o)} aria-expanded={pickOpen}
          className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition', removedCount > 0 ? 'border-brand-400/60 bg-brand-500/10 text-white' : 'border-white/10 bg-[#0d263a] text-[#c7ccd1] hover:text-white')}>
          <ListChecks size={13} aria-hidden="true" /> Elegir gastos uno por uno{removedCount > 0 ? ` · ${removedCount} quitados` : ''}
          <ChevronDown size={12} className={clsx('transition-transform', pickOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      {pickOpen && (
        <div className="rounded-xl border border-white/10 bg-[#0d263a] p-2 space-y-1">
          <div className="flex items-center justify-between px-1.5 pb-1 text-[11px] text-[#8a929a]">
            <span>{pickable.filter((x) => !excluded.includes(x.id)).length} de {pickable.length} incluidos</span>
            <span className="flex gap-3">
              <button type="button" className="font-semibold text-brand-300 hover:text-brand-200" onClick={() => setExcluded((e) => e.filter((id) => !pickable.some((x) => x.id === id)))}>Marcar todos</button>
              <button type="button" className="font-semibold text-[#c7ccd1] hover:text-white" onClick={() => setExcluded((e) => [...new Set([...e, ...pickable.map((x) => x.id)])])}>Quitar todos</button>
            </span>
          </div>
          <ul className="max-h-72 overflow-y-auto space-y-0.5">
            {pickable.map((x) => {
              const on = !excluded.includes(x.id)
              return (
                <li key={x.id}>
                  <label className={clsx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs cursor-pointer transition hover:bg-white/5', on ? 'text-[#f0fae8]' : 'text-[#5f6a72]')}>
                    <input type="checkbox" checked={on} onChange={() => toggleOne(x.id)} />
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: TYPE_COLOR[x.kind] }} aria-hidden="true" />
                    <span className={clsx('min-w-0 flex-1 truncate', !on && 'line-through')}>{x.concept}</span>
                    <span className="hidden sm:inline text-[10px] text-[#8a929a]">{categoryLabel(x.category)} · {format(x.date, 'd MMM', { locale: es })}</span>
                    <span className="font-mono tabular-nums">{formatCOP(x.amount)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {customized && <p className="text-[11px] text-amber-200/90">Reporte personalizado: incluye {formatCOP(now.spends.reduce((t, x) => t + x.amount, 0))} de {formatCOP(nowAll.spends.reduce((t, x) => t + x.amount, 0))} gastados en el período.</p>}
    </section>
  )

  const periodText = `${format(bounds.start, "d 'de' MMM", { locale: es })} al ${format(new Date(bounds.end.getTime() - 86_400_000), "d 'de' MMM", { locale: es })}`

  if (total === 0) {
    return (
      <div className="space-y-4">
        {nowAll.spends.length > 0 && builder}
        <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
          <p className="text-sm font-bold text-[#f0fae8]">{nowAll.spends.length > 0 ? 'Con lo que elegiste no queda ningún gasto' : 'Aún no hay gastos en este período'}</p>
          <p className="text-xs text-[#8a929a] mt-1">{nowAll.spends.length > 0 ? 'Incluye algún tipo, categoría o gasto en "Construir mi reporte".' : 'Cuando pagues fijos o registres gastos, aquí verás en qué se va tu dinero.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {builder}
      {/* The headline */}
      <section className={card} aria-label="Cuánto gastaste">
        <p className={eyebrow}>Del {periodText}</p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-[#9aa4ac]">Gastaste</p>
            <p className="text-3xl font-bold font-mono tabular-nums text-[#f0fae8]">{formatCOP(total)}</p>
            <Change now={total} before={prevTotal} />
            {tagSel.length > 0 && pendingTotal > 0 && (
              <p className="mt-1 text-[11px] text-[#9aa4ac]">Además faltan <span className="font-mono font-semibold text-[#dcf1eb]">{formatCOP(pendingTotal)}</span> por pagar con {tagSel.length === 1 ? 'esa etiqueta' : 'esas etiquetas'} (no se suman aquí).</p>
            )}
          </div>
          {now.income > 0 && (
            <div className="text-right">
              <p className="text-xs text-[#9aa4ac]">de lo que entró</p>
              <p className="text-lg font-bold font-mono tabular-nums text-[#dcf1eb]">{formatCOP(now.income)}</p>
              <p className={clsx('text-[11px] font-semibold', total > now.income ? 'text-red-300' : 'text-brand-300')}>
                {total > now.income ? `te pasaste ${formatCOP(total - now.income)}` : `quedan ${formatCOP(now.income - total)} (${100 - pct(total, now.income)}%)`}
              </p>
            </div>
          )}
        </div>
        {now.income > 0 && (
          <div className="space-y-1">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`Gastaste el ${pct(total, now.income)}% de lo que entró`}>
              <div className={clsx('h-full rounded-full', total > now.income ? 'bg-red-400' : 'bg-brand-400')} style={{ width: `${Math.min(100, pct(total, now.income))}%` }} />
            </div>
            <p className="text-[11px] text-[#8a929a]">Gastaste el {pct(total, now.income)}% de lo que entró. Cuenta lo que salió de tus cuentas: lo pagado en efectivo sin cuenta no se suma.</p>
          </div>
        )}
      </section>

      {/* Plain-language summary */}
      {insights.length > 0 && (
        <section className={card} aria-label="En resumen">
          <p className={clsx(eyebrow, 'inline-flex items-center gap-1.5')}><Lightbulb size={12} aria-hidden="true" /> En resumen</p>
          <ul className="space-y-2">
            {insights.map((t) => <li key={t} className="flex gap-2 text-sm text-[#dcf1eb]"><span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-400" aria-hidden="true" />{t}</li>)}
          </ul>
        </section>
      )}

      {/* By tag: what weighs (paid) and, apart, what is still to pay with that tag */}
      {tagRows.length > 0 && (
        <section className={card} aria-label="Por etiqueta">
          <p className={clsx(eyebrow, 'inline-flex items-center gap-1.5')}><TagIcon size={12} aria-hidden="true" /> Por etiqueta</p>
          <p className="text-[11px] text-[#8a929a] -mt-1">
            <span className="font-semibold text-[#c7ccd1]">Pagado</span> es plata que ya salió y pesa en lo gastado.
            {' '}<span className="font-semibold text-[#c7ccd1]">Pendiente</span> es lo que falta pagar con esa etiqueta en el período (fijos sin pagar y lo que queda de los estimados de ocasionales): no se suma a lo gastado.
          </p>
          <div className="flex flex-wrap gap-3 text-[10px] text-[#9aa4ac]" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-[#9aa4ac]" /> Pagado</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px]" style={{ background: 'repeating-linear-gradient(45deg, #9aa4ac 0 2px, transparent 2px 5px)', outline: '1px solid #9aa4ac66' }} /> Pendiente</span>
          </div>
          <ul className="space-y-3.5">
            {tagRows.map((r) => (
              <li key={r.tag.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <TagChip tag={r.tag} size="sm" />
                  <span className="text-xs text-[#c7ccd1]">
                    <span className="font-mono font-bold text-[#f0fae8]">{formatCOP(r.paid)}</span> pagado
                    {r.pending > 0 && <> · <span className="font-mono text-[#dcf1eb]">{formatCOP(r.pending)}</span> pendiente</>}
                    {total > 0 && r.paid > 0 && <span className="text-[#8a929a]"> · {pct(r.paid, total)}% de lo gastado</span>}
                  </span>
                </div>
                <div className="mt-1.5 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[4px] bg-white/[0.05]" role="img" aria-label={`${r.tag.name}: pagado ${formatCOP(r.paid)}, pendiente ${formatCOP(r.pending)}`}>
                  {r.paid > 0 && <div className="h-full rounded-[4px]" title={`Pagado: ${formatCOP(r.paid)}`} style={{ width: `${(r.paid / tagMax) * 100}%`, backgroundColor: r.tag.color }} />}
                  {r.pending > 0 && <div className="h-full rounded-[4px]" title={`Pendiente: ${formatCOP(r.pending)}`} style={{ width: `${(r.pending / tagMax) * 100}%`, background: `repeating-linear-gradient(45deg, ${r.tag.color} 0 2px, transparent 2px 5px)`, outline: `1px solid ${r.tag.color}88`, outlineOffset: '-1px' }} />}
                </div>
                <p className="mt-1 text-[11px] text-[#8a929a]">
                  {r.byKind.map((k) => `${KIND_META[k.k].label.toLowerCase()} ${formatCOP(k.value)}`).join(' · ') || 'sin pagos todavía'}
                </p>
                {r.pendingItems.length > 0 && (
                  <p className="text-[11px] text-[#9aa4ac]">
                    Falta: {r.pendingItems.map((p) => `${p.concept} (${formatCOP(p.amount)}${p.estimate ? ' aprox.' : ''})`).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Split by kind of expense */}
      <section className={card} aria-label="En qué tipo de gasto se fue">
        <p className={eyebrow}>¿En qué tipo de gasto se fue?</p>
        <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={shown.map((x) => `${KIND_META[x.k].label} ${pct(x.value, total)}%`).join(', ')}>
          {shown.map((x) => (
            <div key={x.k} title={`${KIND_META[x.k].label}: ${formatCOP(x.value)} (${pct(x.value, total)}%)`} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ width: `${(x.value / total) * 100}%`, backgroundColor: TYPE_COLOR[x.k] }} />
          ))}
        </div>
        <ul className="divide-y divide-white/[0.06]">
          {shown.map((x) => {
            const M = KIND_META[x.k]
            return (
              <li key={x.k} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: TYPE_COLOR[x.k] + '26' }}>
                  <M.icon size={14} style={{ color: TYPE_COLOR[x.k] }} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-semibold text-[#f0fae8]">{M.label} <span className="font-mono text-xs text-[#9aa4ac]">· {pct(x.value, total)}%</span></p>
                    <p className="font-mono text-sm font-bold tabular-nums text-[#f0fae8]">{formatCOP(x.value)}</p>
                  </div>
                  <p className="text-[11px] text-[#8a929a]">{x.count} {x.count === 1 ? 'pago' : 'pagos'} · es {M.what}.</p>
                  <Change now={x.value} before={x.before} />
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* What weighs the most */}
        <section className={card} aria-label="Lo que más pesa">
          <p className={eyebrow}>¿En qué se te fue más?</p>
          <p className="text-[11px] text-[#8a929a] -mt-1">Por categoría, sumando fijos, adicionales y ocasionales.</p>
          <ul className="space-y-2.5">
            {topCats.map(([label, value]) => (
              <li key={label} title={`${label}: ${formatCOP(value)} (${pct(value, total)}%)`}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate font-semibold text-[#dcf1eb]">{label}</span>
                  <span className="whitespace-nowrap font-mono text-[#c7ccd1]">{formatCOP(value)} <span className="text-[#8a929a]">· {pct(value, total)}%</span></span>
                </div>
                <div className="mt-1 h-2 w-full rounded-[4px] bg-white/[0.05]">
                  <div className="h-full rounded-[4px]" style={{ width: `${Math.max(2, (value / maxCat) * 100)}%`, backgroundColor: BAR }} />
                </div>
              </li>
            ))}
            {restCats > 0 && (
              <li className="flex items-baseline justify-between gap-3 text-xs text-[#9aa4ac]">
                <span>Otras {cats.length - topCats.length} categorías</span>
                <span className="font-mono">{formatCOP(restCats)} · {pct(restCats, total)}%</span>
              </li>
            )}
          </ul>
        </section>

        {/* The biggest expenses */}
        <section className={card} aria-label="Los gastos más grandes">
          <p className={eyebrow}>Tus gastos más grandes</p>
          <ul className="divide-y divide-white/[0.06]">
            {biggest.map((x, i) => (
              <li key={`${x.concept}-${i}`} className="flex items-center gap-3 py-2">
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: TYPE_COLOR[x.kind] }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#f0fae8]">{x.concept}</p>
                  <p className="text-[11px] text-[#8a929a]">{KIND_META[x.kind].label} · {categoryLabel(x.category)} · {format(x.date, "d 'de' MMM", { locale: es })}</p>
                </div>
                <p className="font-mono text-sm font-bold tabular-nums text-[#f0fae8]">{formatCOP(x.amount)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Day-to-day spending */}
      {additional.length > 0 && (
        <section className={card} aria-label="Gastos del día a día">
          <p className={eyebrow}>Gastos del día a día (adicionales)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Total', value: formatCOP(additionalTotal) },
              { label: 'Registros', value: String(additional.length) },
              { label: 'Promedio por día', value: formatCOP(Math.round(perDay)) },
              { label: 'Día de más gasto', value: worstDay ? `${format(new Date(`${worstDay[0]}T12:00:00`), "d MMM", { locale: es })} · ${formatCOP(worstDay[1])}` : '—' },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-white/10 bg-[#0d263a] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">{k.label}</p>
                <p className="mt-0.5 text-sm font-bold font-mono text-[#f0fae8]">{k.value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#9aa4ac]">
            En promedio se van {formatCOP(Math.round(perDay))} al día en gastos no planeados
            {topAddCat ? `, sobre todo en "${topAddCat[0]}" (${formatCOP(topAddCat[1])})` : ''}.
            {' '}<Change now={additionalTotal} before={prevAdditional} />
          </p>
        </section>
      )}
    </div>
  )
}
