import { debtLines, type DebtLine } from '@/shared'
import { buildHouseholdReport, type FrozenPlan } from './report'
import { toDate, type Rec } from './ledger'

export interface HouseholdStanding {
  householdId: string
  /** What the user still has to pay in this household (their payments in the plan). */
  owes: number
  /** What the others still have to pay the user. */
  owedToMe: number
  /** The household pays only by the plan (its accounts were crossed). */
  crossed: boolean
  /** What the user has to pay, one by one: plan payments when crossed, the pending debts otherwise. */
  lines: DebtLine[]
}

const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()

/**
 * Where the user stands in one household, worked out exactly like the household screen's report
 * (what each one put and paid against their share, and the shared plan once the accounts were crossed),
 * so the dashboard and Fijos never say something the household itself contradicts.
 * With `asOf`, only the expenses and payments that exist by the end of that day count.
 */
export function householdStanding(
  household: Rec,
  expenses: Rec[],
  debts: Rec[],
  uid: string,
  asOf?: Date,
): HouseholdStanding {
  const householdId = household.id as string
  const limit = asOf ? endOfDay(asOf) : Infinity
  const exp = asOf ? expenses.filter((e) => toDate(e.date).getTime() <= limit) : expenses
  const dbt = asOf ? debts.filter((d) => toDate(d.date).getTime() <= limit) : debts
  const memberNames = (household.memberNames as Record<string, string> | undefined) ?? {}
  const nameOf = (u?: string | null) => (u && memberNames[u]?.split(' ')[0]) || 'Integrante'
  const frozen = (household.settlementPlan as FrozenPlan | undefined) ?? null
  const crossed = !!frozen || household.payMode === 'plan'
  // before the plan was shared, the plan didn't exist yet
  const frozenPlan = frozen && frozen.atMs <= limit ? frozen : null

  const report = buildHouseholdReport({
    name: (household.name as string) ?? '',
    members: (household.members as string[] | undefined) ?? [],
    guestIds: (household.guestIds as string[] | undefined) ?? [],
    nameOf,
    expenses: exp,
    debts: dbt,
    frozenPlan,
  })
  const me = report.people.find((p) => p.uid === uid)
  const owes = Math.round(me?.pays.reduce((s, p) => s + p.amount, 0) ?? 0)
  const owedToMe = Math.round(me?.receives.reduce((s, p) => s + p.amount, 0) ?? 0)

  const lines: DebtLine[] = crossed
    ? (me?.pays ?? []).map((p) => ({
        id: `plan|${householdId}|${p.to}`,
        concept: `Pago a ${p.name} (plan del hogar)`,
        householdId,
        date: frozen ? new Date(frozen.atMs) : new Date(),
        dueDate: null,
        remaining: Math.round(p.amount),
      }))
    // paying debt by debt: the debts still count, but never for more than the user really owes overall
    : debtLines(dbt as any[], uid, householdId, owes)

  return { householdId, owes, owedToMe, crossed, lines }
}
