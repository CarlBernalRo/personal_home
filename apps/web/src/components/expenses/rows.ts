/** One personal spend of a period, as Mi dinero lists it. */
export interface ExpenseRow {
  id: string
  description: string
  amount: number
  category: string
  date: Date
  /** Lowers the money on hand and the period's leftover. Older records are history only. */
  counted: boolean
  /** Paid from a household (an abono): shown for completeness, managed in Hogar. */
  household: boolean
  /** Registered against an occasional expense (gasoline, card…). */
  budget: boolean
  /** Account the money came out of. */
  accountId?: string
  /** Screenshot of the spend, when it came from Telegram. */
  attachmentId?: string
  /** Observation left on the spend. */
  notes?: string
}

const toDate = (d: unknown) => (d instanceof Date ? d : new Date(d as string))

/**
 * The additional spends of a period, newest first. Only what belongs to this zone: the spends registered
 * against an occasional expense live with the fixed expenses, and a household's abonos with the household.
 * Records from before spends counted toward the balance stay as history ("no cuenta").
 */
export function buildExpenseRows(personal: any[], bounds: { start: Date; end: Date }): ExpenseRow[] {
  return personal
    .filter((e) => !e.variableBudgetId)
    .map((e): ExpenseRow => ({
      id: e.id,
      description: e.description,
      amount: e.amount,
      category: e.category,
      date: toDate(e.date),
      counted: Boolean(e.tracked),
      household: false,
      budget: false,
      accountId: e.accountId as string | undefined,
      attachmentId: e.attachmentId as string | undefined,
      notes: (e.notes as string | undefined) || undefined,
    }))
    .filter((r) => r.date >= bounds.start && r.date < bounds.end)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
}
