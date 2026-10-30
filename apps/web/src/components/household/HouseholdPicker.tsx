import { useEffect, useState } from 'react'
import { PlusCircle, LogIn, ArrowRight, Users } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { SkeletonList } from '@/components/ui/Skeleton'
import { getHouseholdDebts, getHouseholdCrossings, calcNetBalance } from '@/lib/firestore'
import { formatCOP } from '@/shared'

const OTHER_COLORS = ['#7c3aed', '#2a78d6', '#eb6834', '#1baf7a']
const ME_COLOR = '#111827'

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

export function HouseholdPicker({ households, currentUserUid, onSelect, onCreateNew, onJoin }: {
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
    <div className="fade-in space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#0f172a]">¿A cuál hogar quieres entrar?</h1>
        <p className="text-sm text-[#64748b]">Un vistazo rápido antes de entrar en el detalle.</p>
      </div>

      {households.length === 0 && !loading && (
        <Card className="text-center py-14 space-y-4">
          <Users size={48} className="mx-auto text-gray-200" />
          <div>
            <p className="text-sm font-semibold text-gray-700">Sin hogares configurados</p>
            <p className="text-xs text-gray-400 mt-1">Crea un hogar o únete con un código</p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={onCreateNew} size="sm"><PlusCircle size={15} /> Crear hogar</Button>
            <Button onClick={onJoin} variant="secondary" size="sm"><LogIn size={15} /> Unirme</Button>
          </div>
        </Card>
      )}

      {loading && households.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {households.map((h) => <div key={h.id} className="h-40 bg-gray-100 rounded-2xl skeleton" />)}
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
                className="group text-left bg-white border border-gray-100 rounded-3xl p-5 shadow-sm hover:shadow-lg hover:border-brand-200 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900 truncate">{h.name as string}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {s ? (s.pending > 0 ? `${formatCOP(s.pending)} pendiente` : 'Cuentas al día') : '—'}
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-brand-50 flex items-center justify-center flex-shrink-0 transition-colors">
                    <ArrowRight size={14} className="text-gray-400 group-hover:text-brand-600 transition-colors" />
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-4">
                  {s?.members.map((m) => (
                    <div key={m.uid} className="flex flex-col items-center gap-1.5 min-w-0">
                      <Avatar name={m.name} photoURL={m.photoURL} size={44} color={m.color} />
                      <span className="text-[10px] text-gray-500 font-semibold truncate max-w-[56px]">{m.name}</span>
                      <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full', m.net > 0 ? 'text-red-600 bg-red-50' : 'text-brand-600 bg-brand-50')}>
                        {m.net > 0 ? formatCOP(m.net) : 'Al día'}
                      </span>
                    </div>
                  ))}
                  {s && s.members.length < 2 && (
                    <div className="flex flex-col items-center gap-1.5 opacity-40">
                      <div className="w-11 h-11 rounded-full border-2 border-dashed border-gray-300" />
                      <span className="text-[10px] text-gray-400">Sin pareja</span>
                    </div>
                  )}
                </div>
              </button>
            )
          })}

          <div className="bg-gray-50/60 border border-dashed border-gray-200 rounded-3xl p-5 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-xs text-gray-400">¿Otro hogar?</p>
            <div className="flex gap-2">
              <Button onClick={onCreateNew} variant="secondary" size="sm"><PlusCircle size={14} /> Crear</Button>
              <Button onClick={onJoin} variant="ghost" size="sm"><LogIn size={14} /> Unirme</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
