import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronRight, Clock, GitMerge } from 'lucide-react'
import { clsx } from 'clsx'
import { calcNetBalance } from '@/lib/firestore'
import { formatCOP, remainingOf } from '@/shared'

// Colors beyond "me" follow the app's established identity (purple-600 for the
// partner), then fall back to the dataviz categorical ramp for a 3rd+ member —
// this household model is built for two people, but shouldn't hard-crash past that.
const OTHER_COLORS = ['#7c3aed', '#2a78d6', '#eb6834', '#1baf7a']
const ME_COLOR = '#111827'

type Scene = 'home' | 'member' | 'history'

interface Member { uid: string; name: string; photoURL?: string | null }

/** A person's profile photo as the bubble/card fill, with a bottom-weighted
 *  dark gradient so white text stays readable over any photo. Falls back to
 *  the flat identity color when there's no photo. */
function personFill(photoURL: string | null | undefined, color: string): React.CSSProperties {
  if (!photoURL) return { backgroundColor: color }
  return {
    backgroundColor: color,
    backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.6)), url(${photoURL})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}

/** A soft neon halo in the person's own identity color — can't be a static
 *  CSS class since the color varies per member, so it's computed inline. */
function personGlow(color: string): React.CSSProperties {
  return {
    boxShadow: `0 0 0 1px color-mix(in oklab, ${color}, transparent 35%), 0 0 18px color-mix(in oklab, ${color}, transparent 60%)`,
  }
}

interface MemberStat extends Member {
  net: number
  deuda: number
  abono: number
  cruzado: number
  color: string
}

interface FinanceExplorerProps {
  householdName: string
  members: Member[]
  currentUserUid: string
  debts: any[]
  crossings: any[]
  onOpenDebt: (debt: any) => void
}

/** Wraps a scene change in the native View Transitions API when available, so
 *  bubbles with a matching viewTransitionName morph in place instead of jump-cutting.
 *  Falls back to an instant update on browsers that don't support it. */
function goTo(fn: () => void) {
  const anyDoc = document as any
  if (typeof anyDoc.startViewTransition === 'function') anyDoc.startViewTransition(fn)
  else fn()
}

function vt(name: string): React.CSSProperties {
  return { viewTransitionName: name } as React.CSSProperties
}

export function FinanceExplorer({ householdName, members, currentUserUid, debts, crossings, onOpenDebt }: FinanceExplorerProps) {
  const [scene, setScene]       = useState<Scene>('home')
  const [activeUid, setActiveUid] = useState<string | null>(null)

  const memberStats: MemberStat[] = useMemo(() => {
    let otherIdx = 0
    return members.map((m) => {
      const isMe = m.uid === currentUserUid
      const own  = debts.filter((d: any) => d.debtor === m.uid)
      const deuda = own.filter((d: any) => d.tipo === 'Deuda').reduce((s: number, d: any) => s + d.amount, 0)
      const abono = own.filter((d: any) => d.tipo === 'Abono').reduce((s: number, d: any) => s + d.amount, 0)
      const crossedOwn     = own.filter((d: any) => d.tipo === 'Deuda').reduce((s: number, d: any) => s + ((d.crossedAmount as number) || 0), 0)
      const crossedInFavor = crossings.filter((c: any) => c.debt2PersonId === m.uid && !c.debt2Id).reduce((s: number, c: any) => s + (c.amount as number), 0)
      const cruzado = crossedOwn + crossedInFavor
      const color = isMe ? ME_COLOR : OTHER_COLORS[otherIdx++ % OTHER_COLORS.length]
      return { ...m, net: calcNetBalance(debts, m.uid, crossings), deuda, abono, cruzado, color }
    })
  }, [members, currentUserUid, debts, crossings])

  const active = memberStats.find((m) => m.uid === activeUid) ?? null
  const siblings = memberStats.filter((m) => m.uid !== activeUid)
  const maxNet = Math.max(1, ...memberStats.map((m) => Math.max(0, m.net)))
  const totalPendiente = memberStats.reduce((s, m) => s + Math.max(0, m.net), 0)

  function diameterFor(net: number) {
    const MIN = 92, MAX = 168
    const t = Math.sqrt(Math.max(0, net) / maxNet)
    return Math.round(MIN + t * (MAX - MIN))
  }

  function openMember(uid: string) {
    goTo(() => { setActiveUid(uid); setScene('member') })
  }
  function openHistory() {
    goTo(() => setScene('history'))
  }
  function backToHome() {
    goTo(() => { setScene('home'); setActiveUid(null) })
  }
  function backToMember() {
    goTo(() => setScene('member'))
  }

  const memberDebts = active
    ? debts
        .filter((d: any) => d.debtor === active.uid)
        .slice()
        .sort((a: any, b: any) => {
          const da = a.date instanceof Date ? a.date : new Date(a.date)
          const db = b.date instanceof Date ? b.date : new Date(b.date)
          return db.getTime() - da.getTime()
        })
    : []

  return (
    <div className="notch-lg bg-white border border-gray-100 p-5 md:p-8 min-h-[520px] flex flex-col">
      {/* Breadcrumb — always reflects where you are, always lets you jump back */}
      <div className="flex items-center gap-1.5 text-xs font-semibold mb-6 flex-shrink-0">
        <button onClick={backToHome} className={clsx('px-2 py-1 rounded-lg transition', scene === 'home' ? 'text-gray-900 bg-gray-100' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50')}>
          {householdName}
        </button>
        {active && (
          <>
            <ChevronRight size={12} className="text-gray-300" />
            <button onClick={backToMember} className={clsx('px-2 py-1 rounded-lg transition', scene === 'member' ? 'text-gray-900 bg-gray-100' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50')}>
              {active.name}
            </button>
          </>
        )}
        {scene === 'history' && (
          <>
            <ChevronRight size={12} className="text-gray-300" />
            <span className="px-2 py-1 text-gray-900 bg-gray-100 rounded-lg">Historial</span>
          </>
        )}
      </div>

      {/* ── Home: the household, with its members floating beside it ──────── */}
      {scene === 'home' && (
        <div className="flex-1 flex items-center justify-center flex-wrap gap-10 md:gap-16">
          <div
            style={vt('vt-hogar')}
            className="glow-brand w-44 h-44 md:w-52 md:h-52 rounded-full bg-brand-600 text-white flex flex-col items-center justify-center text-center p-4 shadow-lg flex-shrink-0"
          >
            <p className="font-pixel text-[9px] uppercase tracking-wider opacity-80">Hogar</p>
            <p className="text-sm font-bold mt-1 px-2 leading-tight">{householdName}</p>
            <p className="text-lg font-black mt-2 tabular-nums">
              {totalPendiente > 0 ? formatCOP(totalPendiente) : 'Al día'}
            </p>
            {totalPendiente > 0 && <p className="text-[10px] opacity-80 mt-0.5">pendiente</p>}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6">
            {memberStats.map((m) => {
              const d = diameterFor(m.net)
              return (
                <button
                  key={m.uid}
                  onClick={() => openMember(m.uid)}
                  style={{ ...vt(`vt-member-${m.uid}`), width: d, height: d, ...personFill(m.photoURL, m.color), ...personGlow(m.color) }}
                  className="rounded-full text-white flex flex-col items-center justify-center text-center p-2 hover:scale-105 transition-transform flex-shrink-0"
                >
                  <span className="text-xs font-bold truncate px-1 max-w-full">{m.name}</span>
                  <span className="text-[11px] font-semibold tabular-nums opacity-90 mt-0.5">
                    {m.net > 0 ? formatCOP(m.net) : 'Al día'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Member: the clicked bubble expands into its breakdown ──────────── */}
      {scene === 'member' && active && (
        <div className="flex-1 flex items-start gap-5">
          <button onClick={backToHome} style={vt('vt-hogar')}
            className="glow-brand-sm w-16 h-16 rounded-full bg-brand-600 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0 hover:scale-105 transition-transform">
            {householdName.slice(0, 2).toUpperCase()}
          </button>

          <div
            style={{ ...vt(`vt-member-${active.uid}`), ...personFill(active.photoURL, active.color), ...personGlow(active.color) }}
            className="notch-lg flex-1 text-white p-6 min-w-0"
          >
            <p className="font-pixel text-[9px] uppercase tracking-wider opacity-80">Integrante</p>
            <p className="text-2xl font-black mt-1">{active.name}</p>
            <p className="text-sm font-semibold mt-0.5 opacity-90">
              {active.net > 0 ? `Debe ${formatCOP(active.net)}` : 'Al día'}
            </p>

            <div className="grid grid-cols-3 gap-3 mt-5">
              <StatBlock label="Deudas" value={active.deuda} />
              <StatBlock label="Abonos" value={active.abono} />
              <StatBlock label="Cruzado" value={active.cruzado} />
            </div>

            <button
              onClick={openHistory}
              style={vt(`vt-history-${active.uid}`)}
              className="notch-sm mt-6 w-full md:w-auto px-5 py-2.5 bg-white/15 hover:bg-white/25 text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              Ver historial <ChevronRight size={14} />
            </button>
          </div>

          {siblings.length > 0 && (
            <div className="flex flex-col gap-3 flex-shrink-0">
              {siblings.map((m) => {
                const d = Math.max(64, diameterFor(m.net) * 0.55)
                return (
                  <button
                    key={m.uid}
                    onClick={() => openMember(m.uid)}
                    style={{ ...vt(`vt-member-${m.uid}`), width: d, height: d, ...personFill(m.photoURL, m.color), ...personGlow(m.color) }}
                    className="rounded-full text-white flex flex-col items-center justify-center text-center p-1.5 hover:scale-105 transition-transform opacity-80 hover:opacity-100"
                  >
                    <span className="text-[10px] font-bold truncate px-1 max-w-full">{m.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── History: the member's movements, one level deeper ──────────────── */}
      {scene === 'history' && active && (
        <div className="flex-1 flex flex-col min-w-0">
          <div
            style={{ ...vt(`vt-member-${active.uid}`), ...personFill(active.photoURL, active.color), ...personGlow(active.color) }}
            className="notch text-white p-4 flex items-center justify-between flex-shrink-0"
          >
            <div>
              <p className="font-pixel text-[9px] uppercase tracking-wider opacity-80">Historial de</p>
              <p className="text-lg font-black">{active.name}</p>
            </div>
            <p className="text-sm font-semibold opacity-90">{memberDebts.length} movimientos</p>
          </div>

          <div className="flex-1 overflow-y-auto mt-4 pr-1">
            {memberDebts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">Sin movimientos registrados.</p>
            ) : (
              <div className="relative">
                <div className="absolute left-[11px] top-1 bottom-1 w-px bg-gray-100" />
                {memberDebts.map((d: any) => {
                  const remaining = Math.max(0, remainingOf(d))
                  const dueDate   = d.dueDate ? (d.dueDate instanceof Date ? d.dueDate : new Date(d.dueDate)) : null
                  const overdue   = dueDate ? dueDate < new Date() : false
                  const settled   = d.tipo === 'Abono' || d.cruzado || (d.tipo === 'Deuda' && remaining <= 0)
                  return (
                    <button
                      key={d.id}
                      onClick={() => onOpenDebt(d)}
                      className="relative flex gap-3 pb-4 last:pb-0 w-full text-left group"
                    >
                      <div
                        className="relative z-10 flex-shrink-0 mt-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center ring-2 ring-white shadow-sm"
                        style={{ backgroundColor: active.color }}
                      >
                        {d.tipo === 'Abono' ? <span className="text-white text-[10px]">✓</span> : <GitMerge size={10} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0 border-b border-gray-50 pb-3 group-last:border-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-gray-600 transition">{d.concept}</p>
                          <p className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">{formatCOP(remaining)}</p>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {format(d.date instanceof Date ? d.date : new Date(d.date), 'dd MMM yyyy', { locale: es })}
                          {' · '}
                          <span className={clsx(settled ? 'text-brand-600' : 'text-amber-600')}>
                            {d.tipo === 'Abono' ? 'Abonado' : d.cruzado ? 'Cruzado' : 'Pendiente'}
                          </span>
                        </p>
                        {dueDate && (
                          <p className={clsx('text-[11px] mt-0.5 flex items-center gap-1', overdue ? 'text-red-500 font-semibold' : 'text-gray-400')}>
                            <Clock size={10} /> {overdue ? 'Venció el' : 'Vence el'} {format(dueDate, 'dd MMM yyyy', { locale: es })}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="notch-sm bg-white/10 p-2.5">
      <p className="font-pixel text-[9px] opacity-75">{label}</p>
      <p className="text-sm font-bold tabular-nums mt-0.5">{formatCOP(value)}</p>
    </div>
  )
}
