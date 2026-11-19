import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getHouseholdIds, getHouseholds, subscribePendingReceiptRows } from '@/lib/firestore'

/** Money a household member paid ME that I still have to confirm — and say in which account it landed. */
export interface PendingReceipt {
  key: string
  householdId: string
  householdName: string
  paymentId: string
  fromUid: string
  fromName: string
  amount: number
  date: Date
  lines: { concept: string; amount: number }[]
  attachmentId?: string
}

const toDate = (d: unknown): Date => {
  if (d instanceof Date) return d
  const ts = d as { toDate?: () => Date } | null
  return ts?.toDate ? ts.toDate() : new Date(d as string)
}

/**
 * The payments other people of my households made to me and that are waiting for my confirmation, live: as soon as
 * someone registers one it is here (and in the pending-to-confirm count), and it leaves when I confirm it.
 */
export function usePendingReceipts() {
  const { user, profile } = useAuth()
  const ids = getHouseholdIds(profile as any)
  const idsKey = JSON.stringify(ids)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [households, setHouseholds] = useState<Record<string, any>>({})

  useEffect(() => {
    if (!user || ids.length === 0) { setRows([]); return }
    return subscribePendingReceiptRows(ids, user.uid, setRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, idsKey])

  // names of who paid, from each household's own member list
  useEffect(() => {
    if (ids.length === 0) return
    let live = true
    getHouseholds(ids).then((hhs) => { if (live) setHouseholds(Object.fromEntries((hhs as any[]).map((h) => [h.id, h]))) }).catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, rows.length])

  const receipts = useMemo<PendingReceipt[]>(() => {
    const groups = new Map<string, PendingReceipt>()
    for (const r of rows as any[]) {
      if (!r.paymentId) continue
      const key = `${r.householdId}:${r.paymentId}`
      const hh = households[r.householdId as string]
      const g = groups.get(key) ?? {
        key, householdId: r.householdId as string, householdName: (hh?.name as string) ?? 'Hogar', paymentId: r.paymentId as string,
        fromUid: r.debtor as string, fromName: (hh?.memberNames?.[r.debtor as string] as string) ?? 'Alguien',
        amount: 0, date: toDate(r.date), lines: [], attachmentId: r.attachmentId as string | undefined,
      }
      g.amount += r.amount as number
      g.lines.push({ concept: String(r.concept ?? 'Abono').replace(/^Abono: /, ''), amount: r.amount as number })
      if (!g.attachmentId && r.attachmentId) g.attachmentId = r.attachmentId as string
      groups.set(key, g)
    }
    return [...groups.values()].sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [rows, households])

  return { receipts }
}
