import { useEffect, useState } from 'react'
import { PlusCircle, LogIn, ArrowRight, Users } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { getHouseholdDebts, getHouseholdCrossings, calcNetBalance } from '@/lib/firestore'
import { formatCOP } from '@/shared'

const OTHER_COLORS = ['#52b69a', '#76c893', '#d9ed92', '#1fb4e2']
const ME_COLOR = '#168aad'

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

export function HouseholdPicker({
  households,
  currentUserUid,
  onSelect,
  onCreateNew,
  onJoin,
}: {
  households: any[]
  currentUserUid: string
  onSelect: (id: string) => void
  onCreateNew: () => void
  onJoin: () => void
}) {
  const [summaries, setSummaries] = useState<Record<string, HouseholdSummary>>({})
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    let cancelled = false
    if (households.length === 0) { setLoading(false); return }
    setLoading(true)
    Promise.all(households.map(async (h) => {
      const [debts, crossings] = await Promise.all([
        getHouseholdDebts(h.id).catch(() => []),
        getHouseholdCrossings(h.id).catch(() => []),
      ])
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
          net: calcNetBalance(debts as any[], uid, crossings as any[]),
          color: isMe ? ME_COLOR : OTHER_COLORS[otherIdx++ % OTHER_COLORS.length],
        }
      })
      const pending = members.reduce((s, m) => s + Math.max(0, m.net), 0)
      return [h.id, { id: h.id, pending, members }] as const
    })).then((entries) => {
      if (cancelled) return
      setSummaries(Object.fromEntries(entries))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [households, currentUserUid])

  return (
    <div className="fade-in space-y-5 text-[#f3f5f6]">
      <div>
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
          <Users size={11} className="text-brand-400" />
          <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Hogar</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">¿A cuál hogar quieres entrar?</h1>
        <p className="text-xs text-[#9aa4ac] mt-1">Un vistazo rápido antes de entrar en el detalle.</p>
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

      {loading && households.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {households.map((h) => <div key={h.id} className="h-40 rounded-2xl skeleton" />)}
        </div>
      )}

      {!loading && households.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {households.map((h) => {
            const s = summaries[h.id]
            return (
              <button
                key={h.id}
                onClick={() => goTo(() => onSelect(h.id))}
                style={{ viewTransitionName: `vt-household-${h.id}` } as React.CSSProperties}
                className="notch glow-brand-hover group text-left bg-[#0a1f2f] border border-white/10 p-5 shadow-xl hover:border-brand-400/50 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-pixel text-[9px] text-brand-400 uppercase tracking-widest mb-1">Hogar</p>
                    <p className="text-base font-bold text-[#f3f5f6] truncate">{h.name as string}</p>
                    <p className="text-xs font-mono text-[#8a929a] mt-0.5">
                      {s ? (s.pending > 0 ? `${formatCOP(s.pending)} pendiente` : 'Cuentas al día') : '—'}
                    </p>
                  </div>
                  <div className="notch-sm w-8 h-8 bg-white/5 group-hover:bg-brand-500/20 flex items-center justify-center flex-shrink-0 transition-colors">
                    <ArrowRight size={14} className="text-[#8a929a] group-hover:text-brand-300 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-4">
                  {s?.members.map((m) => (
                    <div key={m.uid} className="flex flex-col items-center gap-1.5 min-w-0">
                      <Avatar name={m.name} photoURL={m.photoURL} size={44} color={m.color} className="!ring-white/20" />
                      <span className="text-[10px] text-[#c7ccd1] font-semibold truncate max-w-[56px]">{m.name}</span>
                      <span className={clsx(
                        'font-pixel text-[8px] font-bold px-1.5 py-0.5 rounded-md border',
                        m.net > 0 ? 'text-red-300 bg-red-500/15 border-red-500/30' : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
                      )}>
                        {m.net > 0 ? formatCOP(m.net) : 'Al día'}
                      </span>
                    </div>
                  ))}
                  {s && s.members.length < 2 && (
                    <div className="flex flex-col items-center gap-1.5 opacity-50">
                      <div className="w-11 h-11 rounded-full border-2 border-dashed border-white/30" />
                      <span className="text-[10px] text-[#8a929a]">Sin pareja</span>
                    </div>
                  )}
                </div>
              </button>
            )
          })}

          <div className="notch bg-white/[0.02] border border-dashed border-white/15 p-5 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-xs text-[#8a929a]">¿Otro hogar?</p>
            <div className="flex gap-2">
              <Button onClick={onCreateNew} variant="secondary" size="sm" notched><PlusCircle size={14} /> Crear</Button>
              <Button onClick={onJoin} variant="ghost" size="sm" notched><LogIn size={14} /> Unirme</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
