import { describe, it, expect } from 'vitest'
import { balanceBreakdown, buildLedger, splitByMonth, statusOf } from './ledger'

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)

const ME = 'me'
const AL = 'ale'

const debt = (id: string, debtor: string, amount: number, date: Date, extra: object = {}) => ({
  id, debtor, amount, date, concept: id, tipo: 'Deuda', crossedAmount: 0, ...extra,
})
const abono = (id: string, debtor: string, amount: number, date: Date) => ({ id, debtor, amount, date, concept: id, tipo: 'Abono' })

/** The net balance of a person the way the app has always computed it (debts - crossed - abonos - counterpart crossings). */
function net(debts: any[], uid: string, crossings: any[]) {
  let b = debts.reduce((acc, x) => {
    if (x.debtor !== uid) return acc
    return x.tipo === 'Deuda' ? acc + (x.amount - (x.crossedAmount || 0)) : acc - x.amount
  }, 0)
  b -= crossings.filter((c) => c.debt2PersonId === uid && !c.debt2Id).reduce((s, c) => s + c.amount, 0)
  return b
}

describe('balanceBreakdown', () => {
  it('is debts minus abonos minus crossed', () => {
    const debts = [debt('a', ME, 100, d(2026, 10, 1), { crossedAmount: 20 }), abono('p', ME, 30, d(2026, 10, 5))]
    expect(balanceBreakdown(debts, [], ME)).toEqual({ deuda: 100, abono: 30, cruzado: 20, saldo: 50 })
  })

  it('counts a crossing made in your favour against the total balance', () => {
    const debts = [debt('a', AL, 50, d(2026, 10, 1))]
    const crossings = [{ id: 'c', debt1Id: 'x', debt2PersonId: AL, amount: 30 }]
    expect(balanceBreakdown(debts, crossings, AL).saldo).toBe(20)
  })

  it('is empty without a person', () => {
    expect(balanceBreakdown([], [], undefined)).toEqual({ deuda: 0, abono: 0, cruzado: 0, saldo: 0 })
  })
})

describe('buildLedger', () => {
  it('orders every movement by date and keeps a running total per person', () => {
    const debts = [
      abono('p', ME, 30, d(2026, 10, 10)),
      debt('a', ME, 100, d(2026, 10, 1)),
      debt('b', AL, 40, d(2026, 10, 5)),
    ]
    const { rows, finalDiff } = buildLedger(debts, [], ME, AL)
    expect(rows.map((r) => r.concept)).toEqual(['a', 'b', 'p'])
    expect(rows[2]).toMatchObject({ myTotal: 70, partnerTotal: 40, diffAfter: 30 })
    expect(finalDiff).toBe(30)
  })

  it('matches the balances of both people with a crossing between two debts', () => {
    // I owe 100 and Ale 60; 40 of each were crossed
    const debts = [
      debt('a', ME, 100, d(2026, 10, 1), { crossedAmount: 40 }),
      debt('b', AL, 60, d(2026, 10, 2), { crossedAmount: 40 }),
    ]
    const crossings = [{ id: 'c', debt1Id: 'a', debt2Id: 'b', amount: 40, createdAt: d(2026, 10, 8) }]
    const { finalDiff } = buildLedger(debts, crossings, ME, AL)
    expect(finalDiff).toBe(net(debts, ME, crossings) - net(debts, AL, crossings))
    expect(finalDiff).toBe(40)
  })

  it('matches the balances with a crossing against the total balance (no counterpart debt)', () => {
    const debts = [debt('a', ME, 100, d(2026, 10, 1), { crossedAmount: 30 }), debt('b', AL, 50, d(2026, 10, 2))]
    const crossings = [{ id: 'c', debt1Id: 'a', debt2PersonId: AL, amount: 30, createdAt: d(2026, 10, 8) }]
    const { finalDiff } = buildLedger(debts, crossings, ME, AL)
    expect(finalDiff).toBe(net(debts, ME, crossings) - net(debts, AL, crossings))
    expect(finalDiff).toBe(50)
  })

  it('ignores a crossing whose debt no longer exists', () => {
    const debts = [debt('a', ME, 100, d(2026, 10, 1))]
    const { rows } = buildLedger(debts, [{ id: 'c', debt1Id: 'gone', amount: 10, createdAt: d(2026, 10, 2) }], ME, AL)
    expect(rows).toHaveLength(1)
  })

  it('works for a household without a partner', () => {
    const { rows, finalDiff } = buildLedger([debt('a', ME, 100, d(2026, 10, 1))], [], ME, null)
    expect(rows[0].partnerTotal).toBe(0)
    expect(finalDiff).toBe(100)
  })
})

describe('splitByMonth', () => {
  const debts = [debt('a', ME, 100, d(2026, 9, 20)), debt('b', AL, 40, d(2026, 10, 5)), abono('p', ME, 10, d(2026, 11, 2))]
  const { rows } = buildLedger(debts, [], ME, AL)

  it('takes the month and carries in the balance left by the earlier ones', () => {
    const oct = splitByMonth(rows, d(2026, 10, 1))
    expect(oct.monthRows.map((r) => r.concept)).toEqual(['b'])
    expect(oct.carryIn).toBe(100) // I owed 100 at the end of September
  })

  it('has no carry-in for the first month with movements', () => {
    const sep = splitByMonth(rows, d(2026, 9, 1))
    expect(sep.carryIn).toBeNull()
    expect(sep.monthRows).toHaveLength(1)
  })

  it('includes the last day of the month', () => {
    const late = buildLedger([debt('z', ME, 5, new Date(2026, 9, 31, 23, 30))], [], ME, AL).rows
    expect(splitByMonth(late, d(2026, 10, 1)).monthRows).toHaveLength(1)
  })
})

describe('statusOf', () => {
  it('reads the state of a debt from what is left to pay', () => {
    expect(statusOf({ kind: 'deuda', debt: debt('a', ME, 100, d(2026, 10, 1)) })).toBe('pending')
    expect(statusOf({ kind: 'deuda', debt: debt('a', ME, 100, d(2026, 10, 1), { paidAbono: 40 }) })).toBe('partial')
    expect(statusOf({ kind: 'deuda', debt: debt('a', ME, 100, d(2026, 10, 1), { paidAbono: 100 }) })).toBe('settled')
  })

  it('marks fully crossed debts and the movement kinds', () => {
    expect(statusOf({ kind: 'deuda', debt: debt('a', ME, 100, d(2026, 10, 1), { crossedAmount: 100, cruzado: true }) })).toBe('crossed')
    expect(statusOf({ kind: 'abono' })).toBe('abono')
    expect(statusOf({ kind: 'cruce' })).toBe('crossed')
  })
})
