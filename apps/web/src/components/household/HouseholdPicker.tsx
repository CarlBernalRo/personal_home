import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlusCircle, LogIn, ArrowRight, Users, Archive, ArchiveRestore, Search, X } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { subscribeHouseholdDebts, subscribeHouseholdExpenses } from '@/lib/firestore'
import { householdStanding } from './standing'
import { toDate } from './ledger'
import { formatCOP } from '@/shared'

const OTHER_COLORS = ['#52b69a', '#76c893', '#d9ed92', '#1fb4e2']
const ME_COLOR = '#168aad'
/** Faces shown on a card; a bigger household folds the rest into a "+N" bubble so the card never overflows. */
const MAX_AVATARS = 6

/** Same morph-on-navigate trick as the Finance Explorer, so picking a
 *  household flows straight into its view instead of a hard cut. */
function goTo(fn: () => void) {
  const anyDoc = document as any
  if (typeof anyDoc.startViewTransition === 'function') anyDoc.startViewTransition(fn)
  else fn()
}

interface HouseholdSummary {
  id: string
  pending: number
  members: { uid: string; name: string; photoURL: string | null; net: number; color: string }[]
}

/** Me first, then who owes the most; only the first MAX_AVATARS get a face. */
function visibleMembers(members: HouseholdSummary['members'], me: string) {
  const sorted = [...members].sort((a, b) => (a.uid === me ? -1 : b.uid === me ? 1 : b.net - a.net))
  return members.length <= MAX_AVATARS
    ? { shown: members, hidden: [] as HouseholdSummary['members'] }
    : { shown: sorted.slice(0, MAX_AVATARS - 1), hidden: sorted.slice(MAX_AVATARS - 1) }
}

export function HouseholdPicker({
  households,
  currentUserUid,
  onSelect,
  onCreateNew,
  onJoin,
  onToggleArchive,
}: {
  households: any[]
  currentUserUid: string
  onSelect: (id: string) => void
  onCreateNew: () => void
  onJoin: () => void
  /** Puts a household away (true) or brings it back (false). */
  onToggleArchive?: (id: string, archive: boolean) => void
}) {
  const [tab, setTab] = useState<'active' | 'inactive'>('active')
  const [query, setQuery] = useState('')
  const [summaries, setSummaries] = useState<Record<string, HouseholdSummary>>({})
  const [loading, setLoading]     = useState(true)

  // Live: a payment or a new expense anywhere in a household changes its card without reloading
  const householdsRef = useRef(households)
  householdsRef.current = households
  const dataRef = useRef<Record<string, { debts?: any[]; expenses?: any[] }>>({})

  const rebuild = useCallback(() => {
    const next: Record<string, HouseholdSummary> = {}
    for (const h of householdsRef.current) {
      const d = dataRef.current[h.id]
      if (!d?.debts) continue
      const memberIds = (h.members as string[] | undefined) ?? []
      const names  = (h.memberNames as Record<string, string> | undefined) ?? {}
      const photos = (h.memberPhotos as Record<string, string | null> | undefined) ?? {}
      let otherIdx = 0
      const members = memberIds.map((uid) => {
        const isMe = uid === currentUserUid
        return {
          uid,
          name: names[uid]?.split(' ')[0] || (isMe ? 'Yo' : 'Integrante'),
          photoURL: photos[uid] ?? null,
          // the same standing the household's report shows (positive: still has to pay; negative: is owed)
          net: (() => { const st = householdStanding(h, d.expenses ?? [], d.debts as any[], uid); return st.owes - st.owedToMe })(),
          color: isMe ? ME_COLOR : OTHER_COLORS[otherIdx++ % OTHER_COLORS.length],
        }
      })
      const pending = members.reduce((sum, m) => sum + Math.max(0, m.net), 0)
      next[h.id] = { id: h.id, pending, members }
    }
    setSummaries(next)
    setLoading(householdsRef.current.some((h) => !dataRef.current[h.id]?.debts))
  }, [currentUserUid])

  // names, photos and members come with the household documents themselves
  useEffect(() => { rebuild() }, [households, rebuild])

  const idsKey = households.map((h) => h.id).join(',')
  useEffect(() => {
    if (households.length === 0) { setLoading(false); return }
    setLoading(true)
    const stops = households.flatMap((h) => [
      subscribeHouseholdDebts(h.id, (rows) => { dataRef.current[h.id] = { ...dataRef.current[h.id], debts: rows }; rebuild() },
        () => { dataRef.current[h.id] = { ...dataRef.current[h.id], debts: [] }; rebuild() }),
      subscribeHouseholdExpenses(h.id, (rows) => { dataRef.current[h.id] = { ...dataRef.current[h.id], expenses: rows }; rebuild() }, () => {}),
    ])
    return () => stops.forEach((stop) => stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, currentUserUid])

  const isArchived = (h: any) => !!h.archivedAt
  const activeList = households.filter((h) => !isArchived(h))
  const inactiveList = households.filter(isArchived)
  // the active/inactive tabs are always there; the search only once there are enough households to look for
  const showToolbar = households.length > 0
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = (tab === 'active' ? activeList : inactiveList).filter((h) => !q || String(h.name ?? '').toLowerCase().includes(q))
    // the ones with money still moving first (most pending on top), then the settled ones by name
    return [...base].sort((a, b) => {
      const pa = summaries[a.id]?.pending ?? 0
      const pb = summaries[b.id]?.pending ?? 0
      if ((pa > 0) !== (pb > 0)) return pa > 0 ? -1 : 1
      if (pa !== pb) return pb - pa
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [households, summaries, tab, query])

  const chipCls = (net: number) => net > 0
    ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
    : net < 0 ? 'text-sky-300 bg-sky-500/15 border-sky-500/30' : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
  const statusText = (net: number) => (net > 0 ? `Debe pagar ${formatCOP(net)}` : net < 0 ? `Le deben ${formatCOP(-net)}` : 'Al día')
  const ringOf = (net: number) => (net > 0 ? '#f59e0b' : net < 0 ? '#38bdf8' : '#34d399')

  return (
    <div className="fade-in space-y-5 text-[#f3f5f6]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <Users size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Hogar</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">¿A cuál hogar quieres entrar?</h1>
          <p className="text-xs text-[#9aa4ac] mt-1">Un vistazo rápido antes de entrar en el detalle.</p>
        </div>
        {households.length > 0 && (
          <div className="flex gap-2">
            <Button onClick={onCreateNew} variant="secondary" size="sm" notched><PlusCircle size={14} /> Crear</Button>
            <Button onClick={onJoin} variant="ghost" size="sm" notched><LogIn size={14} /> Unirme</Button>
          </div>
        )}
      </div>

      {households.length === 0 && !loading && (
        <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-14 px-6 space-y-4">
          <Users size={48} className="mx-auto text-brand-400/40" />
          <div>
            <p className="text-sm font-bold text-[#f0fae8]">Sin hogares configurados</p>
            <p className="text-xs text-[#8a929a] mt-1">Crea un hogar o únete con un código</p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={onCreateNew} size="sm" notched><PlusCircle size={15} /> Crear hogar</Button>
            <Button onClick={onJoin} variant="secondary" size="sm" notched><LogIn size={15} /> Unirme</Button>
          </div>
        </div>
      )}

      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-1 rounded-xl border border-white/[0.06] bg-[#0d263a] p-1 text-xs" role="group" aria-label="Hogares activos o inactivos">
            {([['active', 'Activos', activeList.length], ['inactive', 'Inactivos', inactiveList.length]] as const).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={clsx('rounded-lg px-3 py-1.5 font-medium transition', tab === id ? 'border border-white/10 bg-[#0a1f2f] font-semibold text-white' : 'text-[#8a929a] hover:text-white')}
              >
                {label} <span className="font-mono text-[10px] opacity-70">({n})</span>
              </button>
            ))}
          </div>
          {households.length > 3 && (
            <label className="relative flex-1 min-w-[180px] max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8a929a]" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar hogar"
                aria-label="Buscar hogar"
                className="w-full rounded-xl border px-8 py-1.5 text-xs outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a929a] hover:text-white" aria-label="Limpiar búsqueda">
                  <X size={13} />
                </button>
              )}
            </label>
          )}
        </div>
      )}

      {loading && households.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
          {households.slice(0, 6).map((h) => <div key={h.id} className="h-36 rounded-2xl skeleton" />)}
        </div>
      )}

      {!loading && households.length > 0 && (
        list.length === 0 ? (
          <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-10 px-6">
            <p className="text-sm font-bold text-[#f0fae8]">{query ? 'Ningún hogar coincide' : tab === 'inactive' ? 'No tienes hogares inactivos' : 'No tienes hogares activos'}</p>
            <p className="text-xs text-[#8a929a] mt-1">
              {query ? 'Prueba con otro nombre.' : tab === 'inactive' ? 'Un hogar sin deudas se puede inactivar para sacarlo de la lista principal.' : 'Revisa los inactivos o crea uno nuevo.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
            {list.map((h) => {
              const s = summaries[h.id]
              const archived = isArchived(h)
              const me = s?.members.find((m) => m.uid === currentUserUid)
              const { shown, hidden } = s ? visibleMembers(s.members, currentUserUid) : { shown: [], hidden: [] }
              const payers = s?.members.filter((m) => m.net > 0).sort((a, b) => b.net - a.net) ?? []
              const settled = !!s && s.members.every((m) => Math.abs(m.net) < 1)
              const archivedOn = archived ? toDate(h.archivedAt) : null
              return (
                <div
                  key={h.id}
                  style={{ viewTransitionName: `vt-household-${h.id}` } as React.CSSProperties}
                  className={clsx('notch group flex flex-col bg-[#0a1f2f] border shadow-xl transition-all', archived ? 'border-white/[0.06] opacity-75 hover:opacity-100' : 'border-white/10 hover:border-brand-400/50 glow-brand-hover')}
                >
                  <button type="button" onClick={() => goTo(() => onSelect(h.id))} className="flex-1 text-left p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-bold text-[#f3f5f6] truncate">{h.name as string}</p>
                        <p className="text-[11px] font-mono text-[#8a929a] mt-0.5">
                          {archived
                            ? `Inactivo${archivedOn && !isNaN(archivedOn.getTime()) ? ` desde el ${format(archivedOn, "d 'de' MMM yyyy", { locale: es })}` : ''}`
                            : s ? (s.pending > 0 ? `${formatCOP(s.pending)} pendiente` : 'Cuentas al día') : '—'}
                          {s && ` · ${s.members.length} ${s.members.length === 1 ? 'integrante' : 'integrantes'}`}
                        </p>
                      </div>
                      <span className="notch-sm w-8 h-8 bg-white/5 group-hover:bg-brand-500/20 flex items-center justify-center flex-shrink-0 transition-colors">
                        <ArrowRight size={14} className="text-[#8a929a] group-hover:text-brand-300 group-hover:translate-x-0.5 transition-all" />
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      {/* faces overlap; the ring says how each one stands (same colors as the household's statuses) */}
                      <div className="flex items-center -space-x-2">
                        {shown.map((m) => (
                          <span key={m.uid} className="rounded-full p-[2px]" style={{ backgroundColor: ringOf(m.net) }} title={`${m.uid === currentUserUid ? 'Tú' : m.name} · ${statusText(m.net)}`}>
                            <Avatar name={m.name} photoURL={m.photoURL} size={30} color={m.color} className="!ring-[#0a1f2f] !ring-2" />
                          </span>
                        ))}
                        {hidden.length > 0 && (
                          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/20 bg-[#0d263a] font-mono text-[10px] font-bold text-[#dcf1eb]" title={hidden.map((m) => `${m.name} · ${statusText(m.net)}`).join('\n')}>
                            +{hidden.length}
                          </span>
                        )}
                        {s && s.members.length < 2 && (
                          <span className="!ml-3 text-[10px] text-[#8a929a]">Sin pareja</span>
                        )}
                      </div>
                      {me && (
                        <span className={clsx('font-pixel text-[8px] font-bold px-1.5 py-1 rounded-md border whitespace-nowrap', chipCls(me.net))}>
                          Tú · {statusText(me.net)}
                        </span>
                      )}
                    </div>

                    {!archived && payers.length > 0 && (
                      <p className="text-[11px] text-[#9aa4ac] leading-relaxed">
                        <span className="text-[#8a929a]">Deben pagar: </span>
                        {payers.slice(0, 3).map((m, i) => (
                          <span key={m.uid}>
                            {i > 0 && ' · '}
                            <span className="text-[#dcf1eb] font-semibold">{m.uid === currentUserUid ? 'Tú' : m.name}</span>{' '}
                            <span className="font-mono text-amber-300">{formatCOP(m.net)}</span>
                          </span>
                        ))}
                        {payers.length > 3 && <span className="text-[#8a929a]"> · +{payers.length - 3} más</span>}
                      </p>
                    )}
                  </button>

                  {onToggleArchive && s && (
                    <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-4 py-2">
                      {archived ? (
                        <button type="button" onClick={() => onToggleArchive(h.id, false)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-300 hover:text-brand-200 transition">
                          <ArchiveRestore size={13} aria-hidden="true" /> Reactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!settled}
                          onClick={() => onToggleArchive(h.id, true)}
                          title={settled ? 'Sacarlo de la lista principal (se puede reactivar)' : 'Solo se puede inactivar cuando nadie debe nada en el hogar'}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#8a929a] enabled:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          <Archive size={13} aria-hidden="true" /> Inactivar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
