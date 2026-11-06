import { useMemo, useState } from 'react'
import { Bell, BellOff, CheckCheck, Trash2, Undo2 } from 'lucide-react'
import { clsx } from 'clsx'
import type { AppNotification, NotificationZone } from '@/shared/types/notification'
import { useNotifications } from '@/hooks/useNotifications'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { SkeletonList } from '@/components/ui/Skeleton'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { NotificationCard } from '@/components/notifications/NotificationCard'
import { ZONE_ICON, ZONE_LABEL, dateGroup, type DateGroup } from '@/components/notifications/meta'
import { useLayoutStore } from '@/store/layout'

type Filter = 'all' | NotificationZone

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'sueldo', label: ZONE_LABEL.sueldo },
  { id: 'fijos', label: ZONE_LABEL.fijos },
  { id: 'gastos', label: ZONE_LABEL.gastos },
  { id: 'hogar', label: ZONE_LABEL.hogar },
]

const GROUPS: DateGroup[] = ['Hoy', 'Esta semana', 'Antes']

const EMPTY_TEXT: Record<Filter, string> = {
  all: 'Cuando haya algo que revisar (pagos por vencer, invitaciones, movimientos del hogar) lo verás aquí.',
  sueldo: 'No hay avisos sobre tu sueldo o tu día de pago.',
  fijos: 'No tienes pagos fijos vencidos ni por vencer.',
  gastos: 'Tus gastos adicionales están dentro de lo esperado.',
  hogar: 'No hay movimientos ni invitaciones del hogar.',
}

export default function NotificationsPage() {
  const leftCollapsed = useLayoutStore((s) => s.leftCollapsed)
  const { notifications, history, unread, unreadByZone, loading, markAllRead, clearAll, hiddenCount, restoreHidden } = useNotifications()
  const { showToast } = useToast()
  const ask = useConfirm()
  const [filter, setFilter] = useState<Filter>('all')
  // what is active now, or everything that was ever generated
  const [view, setView] = useState<'active' | 'history'>('active')
  const source = view === 'history' ? history : notifications

  const visible = useMemo(
    () => source
      .filter((n) => filter === 'all' || n.zone === filter)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [source, filter],
  )

  const grouped = useMemo(() => {
    const out: Record<DateGroup, AppNotification[]> = { Hoy: [], 'Esta semana': [], Antes: [] }
    for (const n of visible) out[dateGroup(n.createdAt)].push(n)
    return out
  }, [visible])

  async function handleMarkAll() {
    await markAllRead()
    showToast('Todo marcado como leído', 'success')
  }

  async function handleClear() {
    const ok = await ask('Se descartarán todas tus notificaciones activas (las invitaciones pendientes se conservan y todo queda en el Historial). ¿Continuar?', {
      title: 'Limpiar notificaciones', confirmLabel: 'Limpiar',
    })
    if (!ok) return
    await clearAll()
    showToast('Notificaciones eliminadas', 'delete')
  }

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      <CurvedScrollContainer
        className={clsx('lg:w-[32%] lg:min-w-[300px] lg:max-w-[420px] lg:flex-shrink-0 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50', leftCollapsed && 'lg:hidden')}
        contentClassName="max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6"
        corners="both"
        borderRadius={24}
        offset={7}
        variant="plain"
        themeColor="brand"
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <Bell size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Avisos</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Notificaciones</h1>
          <p className="text-xs text-[#8a929a] mt-1" aria-live="polite">
            {view === 'history' ? `${history.length} en el historial` : unread > 0 ? `${unread} sin leer` : 'Estás al día'}
          </p>
        </div>

        <div role="tablist" aria-label="Vista" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0d263a] border border-white/10">
          {([['active', 'Activas'], ['history', 'Historial']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={clsx('rounded-lg py-1.5 text-xs font-bold transition', view === id ? 'bg-brand-500/20 text-brand-300' : 'text-[#9aa4ac] hover:text-white')}
            >{label}</button>
          ))}
        </div>

        <nav aria-label="Filtrar por zona" className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {FILTERS.map(({ id, label }) => {
            const count = view === 'history' ? 0 : id === 'all' ? unread : unreadByZone[id]
            const Icon = id === 'all' ? Bell : ZONE_ICON[id]
            const active = filter === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={active}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2.5 notch-sm border text-sm text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
                  id === 'all' && 'col-span-2 lg:col-span-1',
                  active
                    ? 'bg-brand-500/15 border-brand-500/40 text-brand-300 font-bold'
                    : 'bg-[#0d263a] border-white/[0.06] text-[#c7ccd1] hover:text-white hover:bg-white/5',
                )}
              >
                <Icon size={15} className={active ? 'text-brand-400' : 'text-[#8a929a]'} aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate">{label}</span>
                {count > 0 && (
                  <span className="min-w-[20px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold font-mono text-center leading-5" aria-label={`${count} sin leer`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {view === 'active' && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={unread === 0} onClick={handleMarkAll}>
            <CheckCheck size={14} /> Marcar todo como leído
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={notifications.length === 0} onClick={handleClear}>
            <Trash2 size={14} /> Limpiar
          </Button>
          {hiddenCount > 0 && (
            <Button type="button" variant="secondary" size="sm" onClick={restoreHidden}>
              <Undo2 size={14} /> Restaurar {hiddenCount} descartada{hiddenCount > 1 ? 's' : ''}
            </Button>
          )}
        </div>
        )}
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
        {loading && notifications.length === 0 ? (
          <SkeletonList count={4} />
        ) : visible.length === 0 ? (
          <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
            <BellOff size={34} className="mx-auto text-[#6f7a83] mb-3" aria-hidden="true" />
            <p className="text-sm font-bold text-[#f0fae8]">
              {view === 'history' ? 'Aún no hay historial' : filter === 'all' ? 'Todo en orden' : `Sin avisos de ${ZONE_LABEL[filter]}`}
            </p>
            <p className="text-xs text-[#8a929a] mt-1 max-w-sm mx-auto">{EMPTY_TEXT[filter]}</p>
          </div>
        ) : (
          GROUPS.filter((g) => grouped[g].length > 0).map((g) => (
            <section key={g} aria-label={g} className="space-y-2">
              <h2 className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">{g}</h2>
              {grouped[g].map((n) => <NotificationCard key={n.key} n={n} historical={view === 'history'} />)}
            </section>
          ))
        )}
      </CurvedScrollContainer>
    </div>
  )
}
