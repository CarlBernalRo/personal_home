import { describe, expect, it } from 'vitest'
import { settleExpenseContributions } from '@/shared'
import { householdStanding } from './standing'

const d = (day: number) => new Date(2026, 10, day)
const household = { id: 'h1', name: 'Viaje', members: ['ale', 'lenin', 'isabel'], guestIds: [], memberNames: { ale: 'Ale', lenin: 'Lenin', isabel: 'Isabel' } }
// Ale fronted 300 split in three
const expense = {
  id: 'e1', description: 'Hospedaje', amount: 300, date: d(8),
  shares: [{ memberId: 'ale', amount: 100, paid: 300 }, { memberId: 'lenin', amount: 100, paid: 0 }, { memberId: 'isabel', amount: 100, paid: 0 }],
  contributions: [{ memberId: 'ale', amount: 300, status: 'confirmed', edges: [] }],
}
// a smaller expense Lenin fronted: Ale's debt to Lenin (30) is covered by what she is owed
const small = {
  id: 'e2', description: 'Taxi', amount: 90, date: d(9),
  shares: [{ memberId: 'ale', amount: 30, paid: 0 }, { memberId: 'lenin', amount: 30, paid: 90 }, { memberId: 'isabel', amount: 30, paid: 0 }],
  contributions: [{ memberId: 'lenin', amount: 90, status: 'confirmed', edges: [] }],
}
/** The debts the app writes for each expense. */
const edgesFor = (exps: any[]) => exps.flatMap((e) => settleExpenseContributions(e.shares, e.contributions)
  .map((x, i) => ({ id: `${e.id}-${i}`, tipo: 'Deuda', debtor: x.debtor, creditor: x.creditor, amount: x.amount, expenseId: e.id, concept: e.description, date: e.date })))
const debts = edgesFor([expense, small])

describe('householdStanding', () => {
  it('does not show as a debt what the person is owed overall', () => {
    const s = householdStanding(household, [expense, small], debts, 'ale')
    expect(s.owes).toBe(0)
    expect(s.owedToMe).toBe(170)
    expect(s.lines).toEqual([])
  })

  it('pays debt by debt while the accounts are not crossed', () => {
    const s = householdStanding(household, [expense, small], debts, 'isabel')
    expect(s.owes).toBe(130)
    expect(s.lines.map((l) => [l.concept, l.remaining])).toEqual([['Hospedaje', 100], ['Taxi', 30]])
  })

  it('once crossed, what is owed is the shared plan, one line per payment', () => {
    const crossed = { ...household, settlementPlan: { atMs: d(10).getTime(), payments: [{ from: 'isabel', to: 'ale', amount: 130 }, { from: 'lenin', to: 'ale', amount: 40 }] }, payMode: 'plan' }
    const s = householdStanding(crossed, [expense, small], debts, 'isabel')
    expect(s.crossed).toBe(true)
    expect(s.owes).toBe(130)
    expect(s.lines.map((l) => [l.concept, l.remaining])).toEqual([['Pago a Ale (plan del hogar)', 130]])
  })

  it('only counts what existed on a given day', () => {
    expect(householdStanding(household, [expense, small], debts, 'isabel', d(8)).owes).toBe(100)
  })

  it('shows nothing pending once everyone paid the plan, however they paid', () => {
    const paid = [
      { id: 'p1', tipo: 'Abono', debtor: 'isabel', creditor: 'ale', amount: 130, date: d(11) },
      { id: 'p2', tipo: 'Abono', debtor: 'lenin', creditor: 'ale', amount: 40, date: d(11) },
    ]
    for (const uid of ['ale', 'lenin', 'isabel']) {
      const s = householdStanding(household, [expense, small], [...debts, ...paid], uid)
      expect([s.owes, s.owedToMe, s.lines.length]).toEqual([0, 0, 0])
    }
  })
})
