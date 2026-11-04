import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarClock, CheckCheck, CheckCircle2, Home, Inbox, Layers, Loader2, Send, ShoppingBag, Trash2, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { dateGroup, type DateGroup } from '@/components/notifications/meta'
import { useSalary } from '@/hooks/useSalary'
import { PENDING_CHANGED, usePendingMovements } from '@/hooks/usePendingMovements'
import { confirmPendingMovement, discardPendingMovement } from '@/lib/firestore'
import { PERSONAL_CATEGORIES, formatCOP } from '@/shared'
import type { PendingMovement, PendingKind } from '@/shared'

type Filter = 'all' | PendingKind
type Account = { id: string; name: string; balance: number }

const KIND = {
  income: { label: 'Ingreso', plural: 'Ingresos', icon: Wallet, border: 'border-l-emerald-400', iconBox: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', chip: 'text-emerald-300', sign: '+' },
  fixed: { label: 'Gasto fijo', plural: 'Gastos fijos', icon: CalendarClock, border: 'border-l-sky-400', iconBox: 'border-sky-400/30 bg-sky-400/10 text-sky-300', chip: 'text-sky-300', sign: '-' },
  occasional: { label: 'Gasto adicional', plural: 'Gastos adicionales', icon: ShoppingBag, border: 'border-l-amber-400', iconBox: 'border-amber-400/30 bg-amber-400/10 text-amber-300', chip: 'text-amber-300', sign: '-' },
  abono: { label: 'Abono al hogar', plural: 'Abonos al hogar', icon: Home, border: 'border-l-violet-400', iconBox: 'border-violet-400/30 bg-violet-400/10 text-violet-300', chip: 'text-violet-300', sign: '-' },
} as const

const FILTERS: { id: Filter; label: string; icon: typeof Layers }[] = [
  { id: 'all', label: 'Todos', icon: Layers },
  { id: 'income', label: KIND.income.plural, icon: Wallet },
  { id: 'fixed', label: KIND.fixed.plural, icon: CalendarClock },
  { id: 'occasional', label: KIND.occasional.plural, icon: ShoppingBag },
  { id: 'abono', label: KIND.abono.plural, icon: Home },
]

const GROUPS: DateGroup[] = ['Hoy', 'Esta semana', 'Antes']
const dateOf = (d: unknown) => (d instanceof Date ? d : new Date(d as string))

const EMPTY_TEXT: Record<Filter, string> = {
  all: 'Envía una captura de un pago o ingreso al bot de Telegram y aparecerá aquí para que lo confirmes.',
  income: 'No hay ingresos por confirmar.',
  fixed: 'No hay gastos fijos por confirmar.',
  occasional: 'No hay gastos adicionales por confirmar.',
  abono: 'No hay abonos al hogar por confirmar.',
}

/** One movement prepared in Telegram: its details, the account it will move, and Confirmar / Descartar. */
function PendingCard({ pm, accounts, onDone }: { pm: PendingMovement; accounts: Account[]; onDone: () => void }) {
  const { showToast } = useToast()
  const ask = useConfirm()
  // the account chosen in Telegram, unless it no longer exists
  const [accountId, setAccountId] = useState(pm.accountId && accounts.some((a) => a.id === pm.accountId) ? pm.accountId : '')
  const [busy, setBusy] = useState<'confirm' | 'discard' | null>(null)
  const k = KIND[pm.kind]
  const Icon = k.icon
  const category = pm.category ? PERSONAL_CATEGORIES.find((c) => c.id === pm.category)?.label : null

  async function confirm() {
    setBusy('confirm')
    try {
      await confirmPendingMovement(pm, accountId)
      showToast(`${k.label} registrado`, 'success')
      window.dispatchEvent(new Event(PENDING_CHANGED))
      onDone()
    } catch (e: any) {
      showToast(e?.message ?? 'No se pudo registrar', 'error')
    } finally { setBusy(null) }
  }

  async function discard() {
    if (!(await ask(`¿Descartar "${pm.concept || k.label}" de ${formatCOP(pm.amount)}? No se registrará.`, { title: 'Descartar movimiento', confirmLabel: 'Descartar' }))) return
    setBusy('discard')
    try {
      await discardPendingMovement(pm)
      showToast('Movimiento descartado', 'delete')
      window.dispatchEvent(new Event(PENDING_CHANGED))
      onDone()
    } catch { showToast('No se pudo descartar', 'error') } finally { setBusy(null) }
  }

  return (
    <article aria-label={`${k.label}: ${pm.concept}`} className={clsx('rounded-2xl border border-white/10 border-l-4 bg-[#0d263a]', k.border)}>
      <div className="flex items-start gap-3 p-3">
        <span className={clsx('flex h-9 w-9 flex-shrink-0 items-center justify-center notch-sm border', k.iconBox)} aria-hidden="true"><Icon size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="break-words sm:truncate text-sm font-bold leading-snug text-[#f3f5f6]">{pm.concept || 'Sin concepto'}</p>
            <p className={clsx('flex-shrink-0 font-mono text-sm font-bold tabular-nums', pm.kind === 'income' ? 'text-emerald-300' : 'text-rose-300')}>{k.sign}{formatCOP(pm.amount)}</p>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[#8a929a]">
            {pm.attachmentId && <AttachmentButton compact attachmentId={pm.attachmentId} />}
            <span className={clsx('font-semibold uppercase tracking-wider', k.chip)}>{k.label}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={dateOf(pm.date).toISOString()} className="font-mono">{format(dateOf(pm.date), "d MMM yyyy", { locale: es })}</time>
            {pm.kind === 'fixed' && pm.occMonth && (<><span aria-hidden="true">·</span><span>pago de {format(new Date(`${pm.occMonth}-01T12:00:00`), 'MMMM yyyy', { locale: es })}</span></>)}
            {category && (<><span aria-hidden="true">·</span><span>{category}</span></>)}
            {pm.kind === 'abono' && (<><span aria-hidden="true">·</span><span>{pm.targetDebtId ? 'a una deuda elegida' : 'se reparte entre sus deudas, la más antigua primero'}</span></>)}
          </p>
          {pm.comment && <p className="mt-2 rounded-lg border border-white/10 bg-[#0a1f2f] px-2.5 py-1.5 text-xs text-[#c7ccd1]">💬 {pm.comment}</p>}
        </div>
      </div>

      <div className="space-y-3 px-3 pb-3 sm:pl-[3.75rem]">
        <AccountSelect
          label={pm.kind === 'income' ? 'Cuenta donde entra el dinero' : 'Cuenta de la que sale el dinero'}
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          noneLabel="Sin cuenta (no mueve saldos)"
          outflow={pm.kind === 'income' ? 0 : pm.amount}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={discard}>
              {busy === 'discard' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Descartar
            </Button>
          </div>
          <Button type="button" size="sm" notched disabled={!!busy} onClick={confirm}>
            {busy === 'confirm' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Confirmar y registrar
          </Button>
        </div>
      </div>
    </article>
  )
}

/** The movements prepared in Telegram: each one is confirmed (it becomes a real record) or discarded here. */
export default function PendingMovementsPage() {
  const { items, counts, loading, refresh } = usePendingMovements()
  const { showToast } = useToast()
  const ask = useConfirm()
  const salary = useSalary()
  const accounts = salary.accounts as Account[]
  const [filter, setFilter] = useState<Filter>('all')
  const [bulk, setBulk] = useState(false)

  const visible = useMemo(
    () => items.filter((p) => filter === 'all' || p.kind === filter).sort((a, b) => dateOf(b.createdAt).getTime() - dateOf(a.createdAt).getTime()),
    [items, filter],
  )
  const grouped = useMemo(() => {
    const out: Record<DateGroup, PendingMovement[]> = { Hoy: [], 'Esta semana': [], Antes: [] }
    for (const p of visible) out[dateGroup(dateOf(p.createdAt))].push(p)
    return out
  }, [visible])

  const countOf = (f: Filter) => (f === 'all' ? counts.total : counts[f])

  // every visible one, with the account chosen in Telegram; the ones that fail stay in the list
  async function confirmAll() {
    const ok = await ask(`Se registrarán ${visible.length} movimiento${visible.length === 1 ? '' : 's'} con la cuenta que elegiste en Telegram. ¿Continuar?`, { title: 'Confirmar todos', confirmLabel: 'Registrar todos' })
    if (!ok) return
    setBulk(true)
    let done = 0
    const failed: string[] = []
    for (const pm of visible) {
      try { await confirmPendingMovement(pm); done++ } catch (e: any) { failed.push(`${pm.concept}: ${e?.message ?? 'error'}`) }
    }
    setBulk(false)
    window.dispatchEvent(new Event(PENDING_CHANGED))
    refresh()
    if (failed.length === 0) showToast(`${done} movimiento${done === 1 ? '' : 's'} registrado${done === 1 ? '' : 's'}`, 'success')
    else showToast(`${done} registrados; ${failed.length} no se pudieron registrar (${failed[0]})`, 'error')
  }

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      <CurvedScrollContainer
        className="lg:w-[32%] lg:min-w-[300px] lg:max-w-[420px] lg:flex-shrink-0 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50"
        contentClassName="max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6"
        corners="both"
        borderRadius={24}
        offset={7}
        variant="plain"
        themeColor="brand"
      >
        <div>
          <div className="mb-1 inline-flex items-center gap-1.5 border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 notch-sm">
            <Send size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] uppercase tracking-widest text-brand-400">Telegram</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Pendientes</h1>
          <p className="mt-1 text-xs text-[#8a929a]" aria-live="polite">
            {counts.total > 0 ? `${counts.total} por confirmar` : 'Estás al día'}
          </p>
        </div>

        <nav aria-label="Filtrar por tipo" className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {FILTERS.map(({ id, label, icon: Icon }) => {
            const active = filter === id
            const count = countOf(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={active}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2.5 notch-sm border text-sm text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
                  id === 'all' && 'col-span-2 lg:col-span-1',
                  active ? 'bg-brand-500/15 border-brand-500/40 text-brand-300 font-bold' : 'bg-[#0d263a] border-white/[0.06] text-[#c7ccd1] hover:text-white hover:bg-white/5',
                )}
              >
                <Icon size={15} className={active ? 'text-brand-400' : 'text-[#8a929a]'} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count > 0 && (
                  <span className="min-w-[20px] rounded-full bg-sky-500 px-1.5 text-center font-mono text-[10px] font-bold leading-5 text-[#04141f]" aria-label={`${count} pendientes`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={visible.length === 0 || bulk} onClick={confirmAll}>
            {bulk ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Confirmar {filter === 'all' ? 'todos' : 'los de este tipo'}
          </Button>
        </div>

        <p className="rounded-xl border border-white/[0.06] bg-[#0d263a] p-3 text-[11px] leading-relaxed text-[#8a929a]">
          Nada de esto está registrado todavía. Los preparaste enviando capturas al bot de Telegram; al confirmar se crea el ingreso o gasto y se mueve el saldo de la cuenta.
        </p>
      </CurvedScrollContainer>

      <CurvedScrollContainer
        className="lg:flex-1 lg:min-h-0"
        contentClassName="max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6"
        corners="both"
        borderRadius={24}
        offset={7}
        variant="plain"
        themeColor="brand"
      >
        {loading && items.length === 0 ? (
          <SkeletonList count={3} />
        ) : visible.length === 0 ? (
          <div className="notch border border-white/10 bg-[#0a1f2f] px-6 py-12 text-center">
            <Inbox size={34} className="mx-auto mb-3 text-[#6f7a83]" aria-hidden="true" />
            <p className="text-sm font-bold text-[#f0fae8]">{filter === 'all' ? 'No tienes nada pendiente' : `Sin ${KIND[filter].plural.toLowerCase()} pendientes`}</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#8a929a]">{EMPTY_TEXT[filter]}</p>
          </div>
        ) : (
          GROUPS.filter((g) => grouped[g].length > 0).map((g) => (
            <section key={g} aria-label={g} className="space-y-2">
              <h2 className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">{g}</h2>
              {grouped[g].map((pm) => <PendingCard key={pm.id} pm={pm} accounts={accounts} onDone={refresh} />)}
            </section>
          ))
        )}
      </CurvedScrollContainer>
    </div>
  )
}
