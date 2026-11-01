import { Modal } from '@/components/ui/Modal'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import {
  AlertTriangle, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, Clock, CornerUpRight,
  GripVertical, Home, Layers, Receipt, Zap, type LucideIcon,
} from 'lucide-react'
import {
  amountFor, effectiveDue, householdDebtDays, isAutoDebit, isPaused, monthEntries, monthKey, settingsFor, monthRange, shiftMonth, formatCOP,
  type DueOverride, type HouseholdDebtRow, type MonthEntry, type VariableBudget, type VariableData,
} from '@/shared'
import { STATUS_META, entryStatusKey, type StatusKey } from './status'

interface Props {
  month: string
  expenses: any[]
  paymentIndex: Map<string, any>
  onSelect: (entry: MonthEntry<any>) => void
  /** target = null restores the expense's regular day for that occurrence. */
  onMove: (expense: any, occMonth: string, target: DueOverride | null) => Promise<void>
  /** Occasional expenses: their usual pay day as a reminder, and the real spends on their date. */
  variable?: VariableData
}

interface MenuState {
  fe: any
  occMonth: string
  top: number
  left: number
}

interface DragState {
  fe: any
  occMonth: string
  x: number
  y: number
  over: DropTarget | null
}

type DropTarget = { kind: 'day'; day: number } | { kind: 'zone'; dir: -1 | 1 }

/** Everything that can sit on a calendar day. */
type DayItem =
  | { kind: 'fixed'; key: string; entry: MonthEntry<any> }
  | { kind: 'debt'; key: string; b: VariableBudget; row: HouseholdDebtRow }
  | { kind: 'reminder'; key: string; b: VariableData['budgets'][number] }
  | { kind: 'spend'; key: string; x: VariableData['spends'][number] }

type IconType = LucideIcon

const DRAG_THRESHOLD_PX = 4
/** A cell shows every item up to this many; beyond it, it folds the rest behind "+N más". */
const CELL_FOLD_AT = 3
const CELL_FOLDED_VISIBLE = 2
const DOTS_MAX = 4

function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-day],[data-drop-zone]')
  if (!el) return null
  if (el.dataset.dropDay) return { kind: 'day', day: Number(el.dataset.dropDay) }
  return { kind: 'zone', dir: el.dataset.dropZone === 'prev' ? -1 : 1 }
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MENU_WIDTH = 248

const STATUS_ICON: Record<StatusKey, IconType> = {
  paid: Check,
  overdue: AlertTriangle,
  'due-soon': Clock,
  pending: CircleDashed,
  arrears: Layers,
  auto: Zap,
  upcoming: CircleDashed,
  na: CircleDashed,
}

const monthLabel = (m: string, withYear = false) => {
  const [y, mm] = m.split('-').map(Number)
  return format(new Date(y, mm - 1, 1), withYear ? 'MMMM yyyy' : 'MMM', { locale: es })
}

/** Colour key of an entry: arrears and auto-paid override the plain status. */
const entryKey = entryStatusKey

const entryAmount = (entry: MonthEntry<any>): number =>
  entry.owed.length > 0 ? entry.total : (entry.payment?.paidAmount ?? amountFor(entry.fe, entry.hostMonth))

const AMBER_DOT = '#f59e0b'

const ORANGE_DOT = '#f97316'
const itemDot = (item: DayItem) => (item.kind === 'fixed' ? STATUS_META[entryKey(item.entry)].dot : item.kind === 'spend' ? ORANGE_DOT : AMBER_DOT)

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'

export function FixedCalendar({ month, expenses, paymentIndex, onSelect, onMove, variable }: Props) {
  const today = new Date()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [picked, setPicked] = useState<number | null>(null) // mobile: day whose detail is open
  const justDragged = useRef(false)

  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const leading = (new Date(y, m - 1, 1).getDay() + 6) % 7 // Monday-first

  // One entry per expense on its date; unpaid earlier months are folded into the amount
  const entries = monthEntries(expenses, month, paymentIndex, today)
  const byDay = new Map<number, MonthEntry<any>[]>()
  const noDay: MonthEntry<any>[] = []
  for (const e of entries) {
    if (!e.due) { noDay.push(e); continue }
    const d = e.due.getDate()
    byDay.set(d, [...(byDay.get(d) ?? []), e])
  }

  // Occasional expenses: a reminder on the usual day (when it has one) and what was actually spent
  const reminderByDay = new Map<number, VariableData['budgets']>()
  for (const b of variable?.budgets ?? []) {
    // household-debt expenses are drawn debt by debt below
    if (!b.active || !b.paymentDay || isPaused(b, month) || b.source === 'household-debt') continue
    const day = Math.min(b.paymentDay, daysInMonth)
    reminderByDay.set(day, [...(reminderByDay.get(day) ?? []), b])
  }
  // Household-debt expenses: a chip per debt, saying its household and name
  const linkedByDay = new Map<number, { b: VariableBudget; row: HouseholdDebtRow }[]>()
  for (const b of variable?.budgets ?? []) {
    if (!b.active || b.source !== 'household-debt' || isPaused(b, month)) continue
    for (const [day, rows] of householdDebtDays(b, variable, y, m - 1)) {
      linkedByDay.set(day, [...(linkedByDay.get(day) ?? []), ...rows.map((row) => ({ b, row }))])
    }
  }
  const spendByDay = new Map<number, VariableData['spends']>()
  for (const x of variable?.spends ?? []) {
    if (monthKey(x.date) !== month) continue
    spendByDay.set(x.date.getDate(), [...(spendByDay.get(x.date.getDate()) ?? []), x])
  }

  function itemsOf(day: number): DayItem[] {
    return [
      ...(byDay.get(day) ?? []).map((entry): DayItem => ({ kind: 'fixed', key: `${entry.fe.id}|${entry.hostMonth}`, entry })),
      ...(linkedByDay.get(day) ?? []).map(({ b, row }, i): DayItem => ({ kind: 'debt', key: `${b.id}|${row.householdId}|${row.debt}|${i}`, b, row })),
      ...(reminderByDay.get(day) ?? []).map((b): DayItem => ({ kind: 'reminder', key: b.id, b })),
      ...(spendByDay.get(day) ?? []).map((x): DayItem => ({ kind: 'spend', key: x.id, x })),
    ]
  }

  /** Money still to leave the account that day: fixed payments and household debts. */
  const dayTotal = (items: DayItem[]) =>
    items.reduce((sum, it) => sum + (it.kind === 'fixed' ? entryAmount(it.entry) : it.kind === 'debt' ? it.row.amount : 0), 0)

  const cells: (number | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const isThisMonth = format(today, 'yyyy-MM') === month
  const todayDay = isThisMonth ? today.getDate() : -1

  // Discreet month summary
  const monthTotal = entries.reduce((s, e) => s + entryAmount(e), 0)
  const paidEntries = entries.filter((e) => e.payment && e.owed.length === 0)
  const monthPaid = paidEntries.reduce((s, e) => s + entryAmount(e), 0)

  const pickedDay = picked !== null && picked <= daysInMonth ? picked : isThisMonth ? today.getDate() : null

  function openMenu(e: React.MouseEvent<HTMLButtonElement>, fe: any, occMonth: string) {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({
      fe,
      occMonth,
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)),
    })
  }

  // Press a chip and drag it onto another day (or a month zone) to reschedule it. A press without
  // movement stays a plain click.
  function startHold(e: React.PointerEvent, fe: any, occMonth: string) {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let active = false

    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      document.body.style.userSelect = ''
    }
    function onMove(ev: PointerEvent) {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return
        active = true
        document.body.style.userSelect = 'none'
      }
      ev.preventDefault()
      const over = dropTargetAt(ev.clientX, ev.clientY)
      setDrag({ fe, occMonth, x: ev.clientX, y: ev.clientY, over })
    }
    function onUp(ev: PointerEvent) {
      const wasActive = active
      stop()
      if (!wasActive) return
      justDragged.current = true // swallow the click that follows the release
      setTimeout(() => { justDragged.current = false }, 0)
      setDrag(null)
      drop(fe, occMonth, dropTargetAt(ev.clientX, ev.clientY))
    }
    function onCancel() {
      stop()
      setDrag(null)
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function drop(fe: any, occMonth: string, target: DropTarget | null) {
    if (!target) return
    const current = effectiveDue(fe, occMonth)
    const next: DueOverride = target.kind === 'day'
      ? { month, day: target.day }
      // month zones keep the same day of the month, in the adjacent month
      : { month: shiftMonth(month, target.dir), day: current?.getDate() ?? settingsFor(fe, occMonth).paymentDay ?? 1 }
    if (current && target.kind === 'day' && current.getDate() === next.day && format(current, 'yyyy-MM') === month) return
    onMove(fe, occMonth, next).catch(() => {})
  }

  function renderItem(item: DayItem, canDrag: boolean) {
    switch (item.kind) {
      case 'fixed': {
        const { fe, hostMonth: occMonth } = item.entry
        return (
          <FixedChip
            key={item.key}
            entry={item.entry}
            viewMonth={month}
            isDragging={drag?.fe.id === fe.id && drag?.occMonth === occMonth}
            canDrag={canDrag}
            onOpen={() => { if (!justDragged.current) onSelect(item.entry) }}
            onPointerDown={(e) => startHold(e, fe, occMonth)}
            onSuppressMenu={(e) => { if (drag) e.preventDefault() }}
            onMenu={(e) => openMenu(e, fe, occMonth)}
          />
        )
      }
      case 'debt': {
        const { b, row } = item
        return (
          <NoteChip
            key={item.key}
            icon={Home}
            title={`${row.household} · ${row.debt} · ${row.detail} (${b.concept})`}
            label={`${row.household} · ${row.debt}`}
            sub={`${formatCOP(row.amount)} · ${row.detail === 'fecha acordada' ? 'acordada' : 'día de pago'}`}
            tone="dashed"
          />
        )
      }
      case 'reminder':
        return (
          <NoteChip
            key={item.key}
            icon={CalendarClock}
            title={`${item.b.concept} · ocasional · aproximado`}
            label={item.b.concept}
            sub={`~${formatCOP(item.b.amount)} · ocasional`}
            tone="dashed"
          />
        )
      case 'spend':
        return (
          <NoteChip
            key={item.key}
            icon={Receipt}
            title={`${item.x.concept} · gasto adicional registrado`}
            label={item.x.concept}
            sub={`−${formatCOP(item.x.amount)}`}
            accent="orange"
            tone="solid"
          />
        )
    }
  }

  function toggleExpanded(day: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(day)) next.add(day)
      return next
    })
  }

  const pickedItems = pickedDay !== null ? itemsOf(pickedDay) : []
  const pickedDate = pickedDay !== null ? new Date(y, m - 1, pickedDay) : null

  return (
    <div className="space-y-3">
      {/* Month summary (kept light: the full progress lives elsewhere on the screen) */}
      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-[#9aa4ac]">
          <span className="font-pixel uppercase tracking-widest text-[9px] text-[#8a929a]">Resumen del mes</span>
          <span>Total <b className="font-mono font-semibold text-[#f3f5f6]">{formatCOP(monthTotal)}</b></span>
          <span>Pagado <b className="font-mono font-semibold text-brand-300">{formatCOP(monthPaid)}</b></span>
          <span className="text-[#8a929a]">{paidEntries.length}/{entries.length} gastos</span>
        </div>
      )}

      {drag && (
        <div className="grid grid-cols-2 gap-2">
          {([-1, 1] as const).map((dir) => {
            const hot = drag.over?.kind === 'zone' && drag.over.dir === dir
            const Arrow = dir === -1 ? ChevronLeft : ChevronRight
            return (
              <div
                key={dir}
                data-drop-zone={dir === -1 ? 'prev' : 'next'}
                className={clsx(
                  'flex items-center gap-2 py-3 px-3 text-xs font-semibold rounded-xl border-2 border-dashed transition-all duration-150 capitalize',
                  dir === -1 ? 'justify-start' : 'flex-row-reverse justify-start',
                  hot
                    ? 'border-brand-400 bg-brand-500/25 text-white scale-[1.02] shadow-[0_0_24px_-4px_rgba(82,182,154,0.55)]'
                    : 'border-white/20 bg-white/[0.02] text-[#9aa4ac] animate-pulse',
                )}
              >
                <Arrow size={16} className={hot ? 'text-brand-300' : 'text-[#8a929a]'} />
                <span className="truncate">{monthLabel(shiftMonth(month, dir), true)}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-[#0a1f2f] border border-white/10 notch-sm overflow-hidden">
        <div className="grid grid-cols-7 border-b border-white/10 bg-[#0d263a]">
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              className={clsx(
                'py-2 text-center font-pixel text-[9px] sm:text-[10px] uppercase tracking-[0.18em]',
                i >= 5 ? 'text-brand-300/60' : 'text-[#8a929a]',
              )}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const isToday = day === todayDay
            const weekend = i % 7 >= 5
            const over = drag && day !== null && drag.over?.kind === 'day' && drag.over.day === day
            const items = day !== null ? itemsOf(day) : []
            const folds = items.length > CELL_FOLD_AT
            const open = day !== null && expanded.has(day)
            const shown = folds && !open ? items.slice(0, CELL_FOLDED_VISIBLE) : items
            const total = dayTotal(items)
            const priced = items.filter((it) => it.kind === 'fixed' || it.kind === 'debt').length
            const isPicked = day !== null && day === pickedDay
            return (
              <div
                key={i}
                data-drop-day={day ?? undefined}
                className={clsx(
                  'relative flex flex-col gap-1 min-w-0 min-h-[64px] sm:min-h-[116px] p-1 sm:p-1.5 border-b border-r border-white/[0.06] transition-all duration-150',
                  day === null && 'bg-black/25',
                  day !== null && weekend && 'bg-white/[0.02]',
                  day !== null && drag && !over && 'bg-white/[0.025]',
                  isToday && 'bg-brand-500/[0.08] ring-1 ring-inset ring-brand-400/50 shadow-[inset_0_0_22px_-8px_rgba(82,182,154,0.55)]',
                  isPicked && !isToday && 'bg-white/[0.05] sm:bg-transparent',
                  over && 'z-10 bg-brand-500/25 ring-2 ring-inset ring-brand-400 shadow-[0_0_22px_-2px_rgba(82,182,154,0.6)]',
                )}
              >
                {day !== null && (
                  <>
                    {/* Day number (tap target on mobile) */}
                    <button
                      type="button"
                      onClick={() => setPicked(day)}
                      aria-label={`Ver detalle del día ${day}`}
                      className={clsx('sm:hidden flex flex-col items-center gap-1 w-full rounded-md py-0.5', FOCUS)}
                    >
                      <DayNumber day={day} isToday={isToday} weekend={weekend} />
                      <span className="flex flex-wrap justify-center gap-[3px] min-h-[8px]">
                        {items.slice(0, DOTS_MAX).map((it) => (
                          <span key={it.key} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: itemDot(it) }} />
                        ))}
                        {items.length > DOTS_MAX && (
                          <span className="text-[8px] leading-[6px] font-mono text-[#9aa4ac]">+{items.length - DOTS_MAX}</span>
                        )}
                      </span>
                    </button>

                    <div className="hidden sm:flex items-center justify-between">
                      <DayNumber day={day} isToday={isToday} weekend={weekend} />
                      {items.length > 0 && (
                        <span className="font-mono text-[9px] text-[#8a929a]">{items.length}</span>
                      )}
                    </div>

                    <div className="hidden sm:flex flex-col gap-1 min-w-0">
                      {shown.map((it) => renderItem(it, true))}
                      {folds && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(day)}
                          aria-expanded={open}
                          aria-label={open ? `Ocultar gastos del día ${day}` : `Ver ${items.length - CELL_FOLDED_VISIBLE} gastos más del día ${day}`}
                          className={clsx(
                            'w-full rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-[#c7ccd1]',
                            'hover:bg-white/10 hover:border-white/25 transition', FOCUS,
                          )}
                        >
                          {open ? 'Ver menos' : `+${items.length - CELL_FOLDED_VISIBLE} más`}
                        </button>
                      )}
                    </div>

                    {priced >= 2 && (
                      <div
                        title={`Total del día: ${formatCOP(total)}`}
                        className="hidden sm:flex mt-auto items-center justify-between gap-1 border-t border-white/10 pt-0.5 text-[9px] text-[#8a929a]"
                      >
                        <span className="font-pixel uppercase tracking-widest">Total</span>
                        <span className="font-mono font-semibold text-[#c7ccd1] truncate">{formatCOP(total)}</span>
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
        {pickedDate ? (
          <div className="bg-[#0a1f2f] border border-white/10 notch-sm p-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-[#f0fae8] capitalize">{format(pickedDate, "EEEE d 'de' MMMM", { locale: es })}</p>
              {dayTotal(pickedItems) > 0 && (
                <span className="font-mono text-[11px] font-semibold text-[#c7ccd1]">{formatCOP(dayTotal(pickedItems))}</span>
              )}
            </div>
            {pickedItems.length > 0
              ? <div className="flex flex-col gap-1.5">{pickedItems.map((it) => renderItem(it, false))}</div>
              : <p className="text-[11px] text-[#8a929a]">Sin gastos este día.</p>}
            <p className="text-[10px] text-[#8a929a]">Para cambiar la fecha usa el botón <ChevronDown size={10} className="inline -mt-0.5" /> de cada gasto.</p>
          </div>
        ) : (
          <p className="px-1 text-[11px] text-[#8a929a]">Toca un día para ver su detalle.</p>
        )}
      </div>

      {noDay.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-pixel uppercase tracking-widest text-[9px] text-[#8a929a]">Sin día de pago definido</p>
          <div className="flex flex-col gap-1.5 max-w-xs">
            {noDay.map((entry) => renderItem({ kind: 'fixed', key: `${entry.fe.id}|${entry.hostMonth}`, entry }, true))}
          </div>
        </div>
      )}

      <Legend />

      {drag && (
        <div
          className="fixed z-50 pointer-events-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-600 text-white text-[11px] font-semibold shadow-2xl border border-brand-300/50 rotate-[-2deg]"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          <GripVertical size={12} className="opacity-70" />
          {drag.fe.concept}
        </div>
      )}

      {menu && (
        <MoveMenu
          key={`${menu.fe.id}|${menu.occMonth}`}
          state={menu}
          viewMonth={month}
          onClose={() => setMenu(null)}
          onMove={onMove}
        />
      )}
    </div>
  )
}

function DayNumber({ day, isToday, weekend }: { day: number; isToday: boolean; weekend: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full font-mono text-[11px] leading-none',
        isToday
          ? 'bg-brand-400 text-[#0a1f2f] font-bold shadow-[0_0_10px_rgba(82,182,154,0.7)]'
          : weekend ? 'text-brand-300/70' : 'text-[#9aa4ac]',
      )}
      aria-label={isToday ? `Hoy, día ${day}` : undefined}
    >
      {day}
    </span>
  )
}

/** A fixed expense: status bar + icon, concept, amount and small markers; arrow opens the move menu. */
function FixedChip({ entry, viewMonth, isDragging, canDrag, onOpen, onPointerDown, onSuppressMenu, onMenu }: {
  entry: MonthEntry<any>
  viewMonth: string
  isDragging: boolean
  canDrag: boolean
  onOpen: () => void
  onPointerDown: (e: React.PointerEvent) => void
  onSuppressMenu: (e: React.MouseEvent) => void
  onMenu: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { fe, hostMonth: occMonth, status, payment, arrears } = entry
  const hasArrears = arrears.length > 0
  const key = entryKey(entry)
  const meta = STATUS_META[key]
  const Icon = STATUS_ICON[key]
  const amount = formatCOP(entryAmount(entry))
  const moved = !!fe.dueOverrides?.[occMonth]
  const autoPending = !payment && isAutoDebit(fe, occMonth)
  const fromOther = !hasArrears && occMonth !== viewMonth

  return (
    <div
      className={clsx(
        'group relative flex items-stretch min-w-0 rounded-md border overflow-hidden transition-all duration-150',
        'hover:shadow-[0_2px_10px_-2px_rgba(0,0,0,0.6)]', meta.chip, meta.hover,
        isDragging && 'opacity-40',
      )}
    >
      <span className="w-[3px] shrink-0" style={{ backgroundColor: meta.dot }} aria-hidden />
      <button
        onClick={onOpen}
        onPointerDown={canDrag ? onPointerDown : undefined}
        onContextMenu={onSuppressMenu}
        style={canDrag ? { touchAction: 'none' } : undefined}
        title={`${fe.concept} · ${hasArrears ? 'total a pagar ' : ''}${amount} · ${hasArrears ? 'atrasado' : STATUS_META[status].label}${autoPending ? ' · automático' : ''}${moved ? ' · movido' : ''}${canDrag ? ' · arrastra para mover' : ''}`}
        className={clsx(
          'flex-1 min-w-0 text-left pl-1.5 pr-1 py-1 leading-tight transition hover:brightness-125',
          canDrag && 'cursor-grab active:cursor-grabbing', FOCUS, 'focus-visible:ring-inset',
        )}
      >
        <span className="flex items-center gap-1 min-w-0">
          <Icon size={11} strokeWidth={2.5} className="shrink-0" />
          <span className="truncate text-[11px] font-semibold">{fe.concept}</span>
        </span>
        <span className="flex items-center gap-1 min-w-0 mt-0.5">
          <span className="font-mono text-[11px] font-semibold tabular-nums truncate">{amount}</span>
          {autoPending && <Zap size={10} className="shrink-0 text-cyan-300" aria-label="Automático" />}
          {moved && <CornerUpRight size={10} className="shrink-0 opacity-80" aria-label="Movido" />}
        </span>
        {(hasArrears || fromOther) && (
          <span className="block truncate text-[10px] opacity-80">
            {hasArrears ? `+${arrears.length} atrasado${arrears.length > 1 ? 's' : ''}` : `de ${monthLabel(occMonth)}`}
          </span>
        )}
      </button>
      <button
        onClick={onMenu}
        title="Mover fecha"
        aria-label={`Mover ${fe.concept}`}
        className={clsx('px-1.5 border-l border-current/20 opacity-70 hover:opacity-100 hover:bg-white/10 transition', FOCUS, 'focus-visible:ring-inset')}
      >
        <ChevronDown size={12} />
      </button>
    </div>
  )
}

/** Reminders, household debts and registered spends: informative, amber, not draggable. */
function NoteChip({ icon: Icon, title, label, sub, tone, accent = 'amber' }: {
  icon: IconType
  title: string
  label: string
  sub: string
  tone: 'dashed' | 'solid'
  /** Registered additional spends are orange (the home's color for them), apart from every payment state. */
  accent?: 'amber' | 'orange'
}) {
  const c = accent === 'orange'
    ? { text: 'text-orange-300', dashed: 'border-dashed border-orange-500/45 bg-transparent', solid: 'border-orange-500/45 bg-orange-500/10', bar: 'bg-orange-500/70' }
    : { text: 'text-amber-200', dashed: 'border-dashed border-amber-400/40 bg-transparent', solid: 'border-amber-400/40 bg-amber-500/10', bar: 'bg-amber-400/60' }
  return (
    <div
      title={title}
      className={clsx(
        'flex items-stretch min-w-0 rounded-md border overflow-hidden',
        c.text,
        tone === 'dashed' ? c.dashed : c.solid,
      )}
    >
      <span className={clsx('w-[3px] shrink-0', c.bar)} aria-hidden />
      <div className="min-w-0 flex-1 pl-1.5 pr-1.5 py-1 leading-tight">
        <span className="flex items-center gap-1 min-w-0">
          <Icon size={11} className="shrink-0" />
          <span className="truncate text-[11px] font-semibold">{label}</span>
        </span>
        <span className="block font-mono text-[10px] opacity-85 truncate mt-0.5">{sub}</span>
      </div>
    </div>
  )
}

function Legend() {
  const states = ['paid', 'auto', 'due-soon', 'pending', 'overdue', 'arrears', 'upcoming'] as const
  const pill = 'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5'
  return (
    <div className="space-y-2 text-[10px] text-[#9aa4ac]">
      <div className="flex flex-wrap gap-1.5">
        {states.map((s) => (
          <span key={s} className={pill}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_META[s].dot }} />
            {STATUS_META[s].label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={pill}><CornerUpRight size={10} /> Movido</span>
        <span className={pill}><Zap size={10} className="text-cyan-300" /> Débito automático</span>
        <span className={clsx(pill, 'border-dashed border-amber-400/40 text-amber-200')}><CalendarClock size={10} /> Ocasional (recordatorio)</span>
        <span className={clsx(pill, 'border-orange-500/45 bg-orange-500/10 text-orange-300')}><Receipt size={10} /> Gasto adicional registrado</span>
        <span className={clsx(pill, 'border-dashed border-amber-400/40 text-amber-200')}><Home size={10} /> Deuda de hogar</span>
      </div>
      <p className="flex items-center gap-1.5 text-[#8a929a]">
        <GripVertical size={12} className="hidden sm:block" />
        <span className="hidden sm:inline">Arrastra un gasto a otro día para moverlo, o usa el botón</span>
        <span className="sm:hidden">Usa el botón</span>
        <ChevronDown size={11} className="inline" />
        <span>de cada gasto para cambiar su fecha.</span>
      </p>
    </div>
  )
}

function MoveMenu({ state, viewMonth, onClose, onMove }: {
  state: MenuState
  viewMonth: string
  onClose: () => void
  onMove: Props['onMove']
}) {
  const { fe, occMonth } = state
  const current = effectiveDue(fe, occMonth)
  const [targetMonth, setTargetMonth] = useState(
    current ? `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}` : occMonth,
  )
  const [day, setDay] = useState(current?.getDate() ?? 1)
  const [busy, setBusy] = useState(false)
  const isMobile = useIsMobile()

  const monthOptions = monthRange(shiftMonth(viewMonth, -2), shiftMonth(viewMonth, 6))
  if (!monthOptions.includes(targetMonth)) monthOptions.push(targetMonth)
  const [ty, tm] = targetMonth.split('-').map(Number)
  const daysInTarget = new Date(ty, tm, 0).getDate()
  const safeDay = Math.min(day, daysInTarget)
  const isMoved = !!fe.dueOverrides?.[occMonth]

  async function run(target: DueOverride | null) {
    setBusy(true)
    try {
      await onMove(fe, occMonth, target)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const selectCls = 'w-full bg-[#0d263a] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-brand-400'

  const content = (
    <>
        <div>
          <p className="text-xs font-semibold text-[#f0fae8] truncate">{fe.concept}</p>
          <p className="text-[10px] text-[#8a929a]">
            Pago de <span className="capitalize">{monthLabel(occMonth, true)}</span> · mover a:
          </p>
        </div>

        <div className="grid grid-cols-[1fr_72px] gap-2">
          <label className="space-y-1">
            <span className="text-[10px] text-[#8a929a]">Mes</span>
            <select className={selectCls} value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)}>
              {monthOptions.map((mo) => (
                <option key={mo} value={mo}>{monthLabel(mo, true)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-[#8a929a]">Día</span>
            <select className={selectCls} value={safeDay} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: daysInTarget }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-2">
          {isMoved && (
            <button
              disabled={busy}
              onClick={() => run(null)}
              className="flex-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-[#0d263a] border border-white/10 text-[#c7ccd1] hover:bg-white/10 transition disabled:opacity-50"
            >
              Restablecer
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => run({ month: targetMonth, day: safeDay })}
            className="flex-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white border border-brand-400/40 transition disabled:opacity-50"
          >
            {busy ? 'Moviendo…' : 'Mover'}
          </button>
        </div>
    </>
  )

  // Phones: a bottom sheet like every other dialog; wide screens keep the small popover beside the day
  if (isMobile) {
    return (
      <Modal open onClose={onClose} title="Mover fecha de pago">
        <div className="space-y-3">{content}</div>
      </Modal>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        className="fixed z-50 p-3 space-y-3 bg-[#0a1f2f] border border-white/15 rounded-xl shadow-2xl"
        style={{ top: state.top, left: state.left, width: MENU_WIDTH }}
      >
        {content}
      </div>
    </>
  )
}
