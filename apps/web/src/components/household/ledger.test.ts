import { describe, it, expect } from 'vitest'
import { balanceBreakdown, buildLedger, nestByDebt, splitByMonth, statusOf } from './ledger'

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
    expect(statusOf({ kind: 'deuda', debt: debt('a', ME, 100, d(2026, 10, 1), { paidAbono: 40 }) })).toBe('pending') // partly paid keeps the state of what is left
    expect(statusOf({ kind: 'deuda', debt: debt('a', ME, 100, d(2026, 10, 1), { paidAbono: 100 }) })).toBe('settled')
  })

  it('marks fully crossed debts and the movement kinds', () => {
    expect(statusOf({ kind: 'deuda', debt: debt('a', ME, 100, d(2026, 10, 1), { crossedAmount: 100, cruzado: true }) })).toBe('crossed')
    expect(statusOf({ kind: 'abono' })).toBe('abono')
    expect(statusOf({ kind: 'cruce' })).toBe('crossed')
  })
})

describe('same-day order and several people', () => {
  it('keeps the order things happened in within one day: debts (by installment) before the abonos that pay them', () => {
    const day = d(2026, 11, 2)
    const t = (n: number) => new Date(2026, 10, 2, 9, 0, n)
    const rows = buildLedger([
      abono('ab1', AL, 100, day),
      debt('c3', AL, 300, day, { installment: 3, createdAt: t(1) }),
      debt('c1', AL, 300, day, { installment: 1, createdAt: t(1) }),
      debt('c2', AL, 300, day, { installment: 2, createdAt: t(1) }),
    ], [], ME, AL).rows
    expect(rows.map((r) => r.concept)).toEqual(['c1', 'c2', 'c3', 'ab1'])
    expect(rows.map((r) => r.totals[AL])).toEqual([300, 600, 900, 800])
  })

  it('tracks each person of a household of five on their own', () => {
    const day = d(2026, 11, 2)
    const rows = buildLedger([
      debt('x', 'b', 100, day, { createdAt: new Date(2026, 10, 2, 9) }),
      debt('y', 'c', 50, day, { createdAt: new Date(2026, 10, 2, 10) }),
      abono('p', 'b', 40, day),
    ], [], ME, 'b').rows
    const last = rows[rows.length - 1]
    expect(last.totals).toEqual({ b: 60, c: 50 })
    expect(last.totalOwed).toBe(110)
  })
})

describe('one row per debt and per payment', () => {
  const day = d(2026, 11, 2)
  const t = (n: number) => new Date(2026, 10, 2, 9, 0, n)
  const debts = (): any[] => [
    debt('c1', AL, 333_333, day, { installment: 1, createdAt: t(0) }),
    debt('c2', AL, 333_333, day, { installment: 2, createdAt: t(0) }),
    { ...abono('a1', AL, 333_333, d(2026, 11, 3)), saldaId: 'c1', paymentId: 'p1', createdAt: t(30) },
    { ...abono('a2', AL, 166_667, d(2026, 11, 3)), saldaId: 'c2', paymentId: 'p1', createdAt: t(31) },
  ]

  it('a payment split across debts is one row with the total and its distribution', () => {
    const top = nestByDebt(buildLedger(debts(), [], ME, AL).rows)
    const pays = top.filter((r) => r.kind === 'abono')
    expect(pays).toHaveLength(1)
    expect(pays[0].delta).toBe(-500_000)
    expect(pays[0].children?.map((k) => [k.target?.id, Math.abs(k.delta)])).toEqual([['c1', 333_333], ['c2', 166_667]])
  })

  it('each debt keeps its own abono inside, knowing it was part of the bigger payment', () => {
    const top = nestByDebt(buildLedger(debts(), [], ME, AL).rows)
    const c1 = top.find((r) => r.debt?.id === 'c1')!
    expect(c1.children).toHaveLength(1)
    expect(c1.children![0].payTotal).toBe(500_000)
    expect(top.filter((r) => r.kind === 'deuda')).toHaveLength(2)
  })

  it('abonos written without a payment id are grouped when made together', () => {
    const list = debts().map((x: any) => { const { paymentId, ...rest } = x; return rest })
    const top = nestByDebt(buildLedger(list, [], ME, AL).rows)
    expect(top.filter((r) => r.kind === 'abono')).toHaveLength(1)
  })
})

describe('state by due date, like Gastos fijos', () => {
  const today = d(2026, 11, 2)
  const st = (dueDate: Date | null, extra: object = {}) => statusOf({ kind: 'deuda', debt: debt('a', AL, 100, d(2026, 10, 1), { dueDate, ...extra }) }, today)

  it('is red only after the date has passed', () => {
    expect(st(d(2026, 11, 1))).toBe('overdue')
    expect(st(d(2026, 11, 2))).toBe('due-soon') // due today is not overdue yet
  })
  it('is amber within three days and pending beyond that or without a date', () => {
    expect(st(d(2026, 11, 5))).toBe('due-soon')
    expect(st(d(2026, 11, 6))).toBe('pending')
    expect(st(null)).toBe('pending')
  })
  it('a paid debt is never overdue', () => {
    expect(st(d(2026, 10, 1), { paidAbono: 100 })).toBe('settled')
  })
})
