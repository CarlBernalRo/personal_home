import { useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { NotebookText, PauseCircle } from 'lucide-react'
import { isPaused, monthKey } from '@/shared'

interface Props {
  expenses: any[]
  onManage: () => void
}

const monthName = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return format(new Date(y, mo - 1, 1), 'MMM yyyy', { locale: es })
}

/** Expenses switched off (now or from a coming month) and the notes left on them. */
export function PausedNotesCard({ expenses, onManage }: Props) {
  const current = monthKey(new Date())

  const paused = useMemo(
    () => expenses.flatMap((e) => {
      const ranges: { from: string; until?: string }[] = e.pauses ?? []
      // the range that is active now, else the next one that starts later
      const range = ranges.find((r) => r.from <= current && (!r.until || current < r.until))
        ?? [...ranges].filter((r) => r.from > current).sort((a, b) => a.from.localeCompare(b.from))[0]
      return range ? [{ e, range, now: isPaused(e, current) }] : []
    }),
    [expenses, current],
  )
  const noted = useMemo(() => expenses.filter((e) => (e.notes ?? '').trim()), [expenses])

  if (paused.length === 0 && noted.length === 0) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#9aa4ac]">Pausados y anotaciones</p>
        <button type="button" onClick={onManage} className="text-[11px] font-semibold text-brand-300 hover:text-brand-200 transition">
          Administrar
        </button>
      </div>

      {paused.length > 0 && (
        <div className="space-y-1.5">
          {paused.map(({ e, range, now }) => (
            <div key={e.id} className="flex items-start gap-2 text-xs">
              <PauseCircle size={14} className={now ? 'text-amber-300 mt-0.5 flex-shrink-0' : 'text-[#8a929a] mt-0.5 flex-shrink-0'} />
              <div className="min-w-0">
                <p className="text-[#f0fae8] truncate">{e.concept}</p>
                <p className="text-[#8a929a]">
                  {now ? 'Pausado' : 'Se pausa'} desde {monthName(range.from)}
                  {range.until ? ` hasta ${monthName(range.until)}` : ' (sin fecha de fin)'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {noted.length > 0 && (
        <div className="space-y-1.5 border-t border-white/10 pt-2">
          {noted.map((e) => (
            <div key={e.id} className="flex items-start gap-2 text-xs">
              <NotebookText size={14} className="text-brand-400 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[#f0fae8] truncate">{e.concept}</p>
                <p className="text-[#9aa4ac] whitespace-pre-line line-clamp-3">{e.notes.trim()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
