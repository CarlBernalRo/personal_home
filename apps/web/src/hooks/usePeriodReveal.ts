import { useMemo, useState } from 'react'
import { buildCalendarPeriods, buildSalaryPeriods, isScheduleUsable, periodAt, periodModeOf } from '@/shared'
import type { PaySchedule } from '@/shared'

/**
 * Keeps a long, ever-growing history (incomes, movements…) short by default: only the current salary period shows at
 * first, and each `loadMore()` reveals one more period back. Falls back to no cutoff (everything shows, like before)
 * when there is no usable pay schedule or no salary income yet to build periods from.
 */
export function usePeriodReveal(salaries: { id: string; date: Date; amount: number }[], schedule: PaySchedule | null) {
  const [extra, setExtra] = useState(0)

  const periods = useMemo(
    () => (!isScheduleUsable(schedule) ? [] : periodModeOf(schedule) === 'calendar' ? buildCalendarPeriods(salaries) : buildSalaryPeriods(salaries, schedule)),
    [schedule, salaries],
  )
  const sorted = useMemo(() => [...periods].sort((a, b) => a.start.getTime() - b.start.getTime()), [periods])
  const currentIdx = useMemo(() => {
    const cp = periodAt(sorted, new Date())
    return cp ? sorted.indexOf(cp) : sorted.length - 1
  }, [sorted])

  const visibleFromIdx = Math.max(0, currentIdx - extra)
  const cutoff = currentIdx >= 0 && sorted[visibleFromIdx] ? sorted[visibleFromIdx].start : null
  const canLoadMore = cutoff !== null && visibleFromIdx > 0

  return {
    /** Oldest date still shown (inclusive); null means no limit (show everything). */
    cutoff,
    canLoadMore,
    loadMore: () => setExtra((e) => e + 1),
    reset: () => setExtra(0),
  }
}
