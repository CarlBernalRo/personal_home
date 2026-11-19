import { useState } from 'react'
import { addMonths, format, isSameMonth, startOfMonth } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { formatCOP } from '@/shared'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import type { AccountLite } from '@/components/ui/AccountChip'
import { MOVEMENT_ZONES, type Movement } from './MovementTimeline'

interface Props {
  /** Movements already filtered by account and zone; the calendar only picks the month. */
  items: Movement[]
  accounts: AccountLite[]
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
/** A cell shows every movement up to this many; beyond it, it folds the rest behind "+N más". */
const CELL_FOLD_AT = 3
const CELL_FOLDED_VISIBLE = 2
const DOTS_MAX = 4
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'

const zoneOf = (m: Movement) => MOVEMENT_ZONES.find((z) => z.id === m.zone)!
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatCOP(Math.abs(n))}`

/**
 * The month of movements as a calendar, in the style of the Gastos Fijos one: a chip per movement on its day,
 * coloured by zone, with the day's net and the month's totals. On a phone the day shows dots and the detail opens below.
 */
export function MovementCalendar({ items, accounts }: Props) {
  const today = new Date()
  const [cursor, setCursor] = useState(() => startOfMonth(today))
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [picked, setPicked] = useState<number | null>(null)

  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const leading = (new Date(y, m, 1).getDay() + 6) % 7 // Monday-first
  const isThisMonth = isSameMonth(cursor, today)
  const todayDay = isThisMonth ? today.getDate() : -1

  const byDay = new Map<number, Movement[]>()
  for (const it of items) {
    if (it.date.getFullYear() !== y || it.date.getMonth() !== m) continue
    byDay.set(it.date.getDate(), [...(byDay.get(it.date.getDate()) ?? []), it])
  }
  const inMonth = [...byDay.values()].flat()
  const entered = inMonth.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0)
  const left = inMonth.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0)

  const cells: (number | null)[] = [...Array(leading).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const pickedDay = picked !== null && picked <= daysInMonth ? picked : isThisMonth ? today.getDate() : null
  const pickedItems = pickedDay !== null ? byDay.get(pickedDay) ?? [] : []

  function go(delta: number) {
    setCursor((c) => addMonths(c, delta))
    setPicked(null)
    setExpanded(new Set())
  }
  function toggleExpanded(day: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(day)) next.add(day)
      return next
    })
  }

  const chip = (mv: Movement) => {
    const zone = zoneOf(mv)
    const Icon = zone.icon
    const acc = accounts.find((a) => a.id === mv.accountId)
    return (
      <div
        key={mv.id}
        title={`${mv.concept} · ${mv.sub}${acc ? ` · ${acc.name}` : ''} · ${signed(mv.amount)}`}
        className="flex items-stretch min-w-0 rounded-md border overflow-hidden bg-[#0d263a]"
        style={{ borderColor: zone.color + '66' }}
      >
        <span className="w-[3px] shrink-0" style={{ backgroundColor: zone.color }} aria-hidden />
        <div className="min-w-0 flex-1 pl-1.5 pr-1 py-1 leading-tight">
          <span className="flex items-center gap-1 min-w-0">
            <Icon size={11} className="shrink-0" style={{ color: zone.color }} aria-hidden="true" />
            <span className="truncate text-[11px] font-semibold text-[#f0fae8]">{mv.concept}</span>
          </span>
          <span className="flex items-center gap-1 min-w-0 mt-0.5">
            <span className={clsx('font-mono text-[11px] font-semibold tabular-nums truncate', mv.amount >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{signed(mv.amount)}</span>
            {mv.attachmentId && <AttachmentButton compact attachmentId={mv.attachmentId} />}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(-1)} aria-label="Mes anterior" className={clsx('p-1.5 rounded-lg border border-white/10 bg-[#0d263a] text-[#c7ccd1] hover:text-white transition', FOCUS)}><ChevronLeft size={16} /></button>
          <p className="min-w-[8.5rem] text-center text-sm font-bold text-[#f0fae8] capitalize">{format(cursor, 'MMMM yyyy', { locale: es })}</p>
          <button type="button" onClick={() => go(1)} aria-label="Mes siguiente" className={clsx('p-1.5 rounded-lg border border-white/10 bg-[#0d263a] text-[#c7ccd1] hover:text-white transition', FOCUS)}><ChevronRight size={16} /></button>
          {!isThisMonth && (
            <button type="button" onClick={() => { setCursor(startOfMonth(new Date())); setPicked(null) }} className="ml-1 text-[11px] font-semibold text-brand-300 hover:text-brand-200 transition">Hoy</button>
          )}
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#9aa4ac]">
          <span>Entró <b className="font-mono font-semibold text-brand-300">{formatCOP(entered)}</b></span>
          <span>Salió <b className="font-mono font-semibold text-[#f0fae8]">{formatCOP(left)}</b></span>
          <span>Neto <b className={clsx('font-mono font-semibold', entered - left >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{signed(entered - left)}</b></span>
          <span className="text-[#8a929a]">{inMonth.length} {inMonth.length === 1 ? 'movimiento' : 'movimientos'}</span>
        </p>
      </div>

      <div className="bg-[#0a1f2f] border border-white/10 notch-sm overflow-hidden">
        <div className="grid grid-cols-7 border-b border-white/10 bg-[#0d263a]">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={clsx('py-2 text-center font-pixel text-[9px] sm:text-[10px] uppercase tracking-[0.18em]', i >= 5 ? 'text-brand-300/60' : 'text-[#8a929a]')}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const isToday = day === todayDay
            const weekend = i % 7 >= 5
            const dayItems = day !== null ? byDay.get(day) ?? [] : []
            const folds = dayItems.length > CELL_FOLD_AT
            const open = day !== null && expanded.has(day)
            const shown = folds && !open ? dayItems.slice(0, CELL_FOLDED_VISIBLE) : dayItems
            const net = dayItems.reduce((s, x) => s + x.amount, 0)
            const isPicked = day !== null && day === pickedDay
            return (
              <div
                key={i}
                className={clsx(
                  'relative flex flex-col gap-1 min-w-0 min-h-[64px] sm:min-h-[116px] p-1 sm:p-1.5 border-b border-r border-white/[0.06]',
                  day === null && 'bg-black/25',
                  day !== null && weekend && 'bg-white/[0.02]',
                  isToday && 'bg-brand-500/[0.08] ring-1 ring-inset ring-brand-400/50 shadow-[inset_0_0_22px_-8px_rgba(82,182,154,0.55)]',
                  isPicked && !isToday && 'bg-white/[0.05] sm:bg-transparent',
                )}
              >
                {day !== null && (
                  <>
                    <button type="button" onClick={() => setPicked(day)} aria-label={`Ver detalle del día ${day}`} className={clsx('sm:hidden flex flex-col items-center gap-1 w-full rounded-md py-0.5', FOCUS)}>
                      <DayNumber day={day} isToday={isToday} weekend={weekend} />
                      <span className="flex flex-wrap justify-center gap-[3px] min-h-[8px]">
                        {dayItems.slice(0, DOTS_MAX).map((x) => <span key={x.id} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: zoneOf(x).color }} />)}
                        {dayItems.length > DOTS_MAX && <span className="text-[8px] leading-[6px] font-mono text-[#9aa4ac]">+{dayItems.length - DOTS_MAX}</span>}
                      </span>
                    </button>

                    <div className="hidden sm:flex items-center justify-between">
                      <DayNumber day={day} isToday={isToday} weekend={weekend} />
                      {dayItems.length > 0 && <span className="font-mono text-[9px] text-[#8a929a]">{dayItems.length}</span>}
                    </div>

                    <div className="hidden sm:flex flex-col gap-1 min-w-0">
                      {shown.map(chip)}
                      {folds && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(day)}
                          aria-expanded={open}
                          className={clsx('w-full rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-[#c7ccd1] hover:bg-white/10 hover:border-white/25 transition', FOCUS)}
                        >
                          {open ? 'Ver menos' : `+${dayItems.length - CELL_FOLDED_VISIBLE} más`}
                        </button>
                      )}
                    </div>

                    {dayItems.length >= 2 && (
                      <div title={`Neto del día: ${signed(net)}`} className="hidden sm:flex mt-auto items-center justify-between gap-1 border-t border-white/10 pt-0.5 text-[9px] text-[#8a929a]">
                        <span className="font-pixel uppercase tracking-widest">Neto</span>
                        <span className={clsx('font-mono font-semibold truncate', net >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{signed(net)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile: detail of the tapped day */}
      <div className="sm:hidden">
        {pickedDay !== null ? (
          <div className="bg-[#0a1f2f] border border-white/10 notch-sm p-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-[#f0fae8] capitalize">{format(new Date(y, m, pickedDay), "EEEE d 'de' MMMM", { locale: es })}</p>
              {pickedItems.length > 1 && <span className="font-mono text-[11px] font-semibold text-[#c7ccd1]">{signed(pickedItems.reduce((s, x) => s + x.amount, 0))}</span>}
            </div>
            {pickedItems.length > 0
              ? <div className="flex flex-col gap-1.5">{pickedItems.map(chip)}</div>
              : <p className="text-[11px] text-[#8a929a]">Sin movimientos este día.</p>}
          </div>
        ) : (
          <p className="px-1 text-[11px] text-[#8a929a]">Toca un día para ver su detalle.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px] text-[#9aa4ac]">
        {MOVEMENT_ZONES.map(({ id, label, color, icon: Icon }) => (
          <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5">
            <Icon size={10} style={{ color }} aria-hidden="true" /> {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function DayNumber({ day, isToday, weekend }: { day: number; isToday: boolean; weekend: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full font-mono text-[11px] leading-none',
        isToday ? 'bg-brand-400 text-[#0a1f2f] font-bold shadow-[0_0_10px_rgba(82,182,154,0.7)]' : weekend ? 'text-brand-300/70' : 'text-[#9aa4ac]',
      )}
      aria-label={isToday ? `Hoy, día ${day}` : undefined}
    >
      {day}
    </span>
  )
}
