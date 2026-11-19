import { describe, expect, it } from 'vitest'
import { buildHouseholdReport, groupMessage, personMessage } from './report'

const members = ['ale', 'lenin', 'isabel']
const names: Record<string, string> = { ale: 'Ale', lenin: 'Lenin', isabel: 'Isabel' }
const nameOf = (u?: string | null) => (u ? names[u] ?? u : '?')
const d = (day: number) => new Date(2026, 10, day)

const expense = {
  id: 'e1', description: 'Hospedaje', amount: 300, date: d(8),
  shares: [{ memberId: 'ale', amount: 100, paid: 300 }, { memberId: 'lenin', amount: 100, paid: 0 }, { memberId: 'isabel', amount: 100, paid: 0 }],
  contributions: [{ memberId: 'ale', amount: 300, status: 'confirmed', edges: [] }],
}
const abono = (id: string, debtor: string, creditor: string | null, amount: number) => ({ id, tipo: 'Abono', debtor, creditor, amount })

function report(debts: any[], expenses: any[] = [expense], guests = ['lenin', 'isabel']) {
  return buildHouseholdReport({ name: 'Viaje', members, guestIds: guests, nameOf, expenses, debts, generatedAt: d(10) })
}

describe('buildHouseholdReport', () => {
  it('works out where each person stands from what they put in, their part and what already moved', () => {
    const r = report([])
    expect(r.total).toBe(300)
    expect(r.people.find((p) => p.uid === 'ale')).toMatchObject({ share: 100, put: 300, position: 200 })
    expect(r.people.find((p) => p.uid === 'lenin')).toMatchObject({ share: 100, put: 0, position: -100 })
    expect(r.plan.map((x) => [x.fromName, x.toName, x.amount])).toEqual([['Isabel', 'Ale', 100], ['Lenin', 'Ale', 100]])
    expect(r.toMove).toBe(200)
    expect(r.balanced).toBe(true)
  })

  it('counts a payment already made on both sides', () => {
    const r = report([abono('p1', 'lenin', 'ale', 100)])
    expect(r.people.find((p) => p.uid === 'lenin')).toMatchObject({ paid: 100, position: 0 })
    expect(r.people.find((p) => p.uid === 'ale')).toMatchObject({ received: 100, position: 100 })
    expect(r.plan).toEqual([{ from: 'isabel', fromName: 'Isabel', to: 'ale', toName: 'Ale', amount: 100 }])
  })

  it('treats paying more than owed as paying in advance: the payment can go to anyone', () => {
    // Lenin pays Isabel 150 although it is Ale who fronted everything: the books still close
    const r = report([abono('p1', 'lenin', 'isabel', 150)])
    expect(r.people.find((p) => p.uid === 'lenin')!.position).toBe(50)
    expect(r.people.find((p) => p.uid === 'isabel')!.position).toBe(-250)
    expect(r.balanced).toBe(true)
  })

  describe('a plan that was already shared', () => {
    // three people, Ale fronted 300: Lenin and Isabel each pay her 100. Shared at t=1000.
    const frozen = { atMs: 1000, payments: [{ from: 'lenin', to: 'ale', amount: 100 }, { from: 'isabel', to: 'ale', amount: 100 }] }
    const build = (debts: any[], expenses: any[] = [expense]) =>
      buildHouseholdReport({ name: 'Viaje', members, guestIds: [], nameOf, expenses, debts, frozenPlan: frozen })
    const plan = (r: ReturnType<typeof build>) => r.plan.map((x) => [x.fromName, x.toName, x.amount])
    const at = (ms: number, a: any) => ({ ...a, createdAt: new Date(ms) })

    it('stays as it was shared, and each payment only goes down as it is paid', () => {
      const r = build([at(5000, abono('p1', 'isabel', 'ale', 60))])
      expect(plan(r)).toEqual([['Lenin', 'Ale', 100], ['Isabel', 'Ale', 40]])
      expect(r.adjusted).toBe(0)
      expect(r.frozenAt).toEqual(new Date(1000))
    })

    it('is adjusted, not broken, when someone pays a person the plan did not say', () => {
      // Isabel pays Lenin 30 on a debt of her own: Lenin now holds 30 of hers, so he gives them back through the plan
      const r = build([at(5000, abono('p1', 'isabel', 'lenin', 30))])
      expect(plan(r)).toEqual([['Lenin', 'Ale', 100], ['Isabel', 'Ale', 100], ['Lenin', 'Isabel', 30]])
      expect(r.adjusted).toBe(30)
      // whatever is paid, the plan still leaves every single person even
      for (const p of r.people) expect(p.position + p.pays.reduce((n, x) => n + x.amount, 0) - p.receives.reduce((n, x) => n + x.amount, 0)).toBe(0)
    })

    it('settles paying more than a line said', () => {
      // Lenin pays Ale 130 although the plan said 100: his line is done and Ale gives the 30 back
      const r = build([at(5000, abono('p1', 'lenin', 'ale', 130))])
      expect(plan(r)).toEqual([['Isabel', 'Ale', 100], ['Ale', 'Lenin', 30]])
    })

    it('nets an adjustment against a line between the same two people', () => {
      // Ale pays Lenin 30 (say, she owed him for something): Lenin's line to her simply grows by 30
      const r = build([at(5000, abono('p1', 'ale', 'lenin', 30))])
      expect(plan(r)).toEqual([['Lenin', 'Ale', 130], ['Isabel', 'Ale', 100]])
    })

    it('takes in a new shared expense without touching what was shared', () => {
      // after sharing, Lenin fronts 90 for something the three split (30 each)
      const extra = {
        id: 'e2', description: 'Taxi', amount: 90, date: d(9),
        shares: [{ memberId: 'ale', amount: 30, paid: 0 }, { memberId: 'lenin', amount: 30, paid: 90 }, { memberId: 'isabel', amount: 30, paid: 0 }],
        contributions: [{ memberId: 'lenin', amount: 90, status: 'confirmed', edges: [] }],
      }
      const r = build([], [expense, extra])
      expect(r.adjusted).toBe(60)
      expect(plan(r)).toEqual([['Lenin', 'Ale', 70], ['Isabel', 'Ale', 100], ['Isabel', 'Lenin', 30]])
      for (const p of r.people) expect(p.position + p.pays.reduce((n, x) => n + x.amount, 0) - p.receives.reduce((n, x) => n + x.amount, 0)).toBe(0)
    })

    it('follows a corrected expense', () => {
      // the 300 was really 360: everybody's part goes up by 20
      const fixed = { ...expense, amount: 360, shares: expense.shares.map((s) => ({ ...s, amount: 120, paid: s.memberId === 'ale' ? 360 : 0 })), contributions: [{ memberId: 'ale', amount: 360, status: 'confirmed', edges: [] }] }
      const r = build([], [fixed])
      expect(plan(r)).toEqual([['Lenin', 'Ale', 120], ['Isabel', 'Ale', 120]])
      expect(r.adjusted).toBe(40)
    })
  })

  it('does not count a contribution nobody confirmed yet, and flags it', () => {
    const unconfirmed = { ...expense, contributions: [{ memberId: 'ale', amount: 300, status: 'pending', edges: [] }] }
    const r = report([], [unconfirmed], [])
    expect(r.people.find((p) => p.uid === 'ale')).toMatchObject({ put: 0, putPending: 300 })
    expect(r.unconfirmed).toBe(1)
  })

  it('nets someone who owes some people and is owed by others into ONE amount', () => {
    // Jhon fronted 300 for something shared by Jhon, Ana and Ben (100 each), and owes Cris 60 for something else
    const members3 = ['jhon', 'ana', 'ben', 'cris']
    const nm: Record<string, string> = { jhon: 'Jhon', ana: 'Ana', ben: 'Ben', cris: 'Cris' }
    const mine = { id: 'm', description: 'Mio', amount: 300, date: d(1), shares: [{ memberId: 'jhon', amount: 100, paid: 300 }, { memberId: 'ana', amount: 100, paid: 0 }, { memberId: 'ben', amount: 100, paid: 0 }], contributions: [{ memberId: 'jhon', amount: 300, status: 'confirmed', edges: [] }] }
    const crisPaid = { id: 'c', description: 'De Cris', amount: 120, date: d(2), shares: [{ memberId: 'jhon', amount: 60, paid: 0 }, { memberId: 'cris', amount: 60, paid: 120 }], contributions: [{ memberId: 'cris', amount: 120, status: 'confirmed', edges: [] }] }
    const r = buildHouseholdReport({ name: 'X', members: members3, guestIds: [], nameOf: (u) => nm[u as string], expenses: [mine, crisPaid], debts: [] })
    const jhon = r.people.find((p) => p.uid === 'jhon')!
    // he is owed 200 by Ana and Ben, and owes 60 to Cris: net +140
    expect(jhon.position).toBe(140)
    expect(r.plan.filter((x) => x.from === 'jhon')).toEqual([])
    expect(r.plan.filter((x) => x.to === 'jhon').reduce((s, x) => s + x.amount, 0)).toBe(140)
  })
})

describe('messages and summaries', () => {
  it('says why in plain words, with the arithmetic', () => {
    const r = report([])
    const lenin = r.people.find((p) => p.uid === 'lenin')!
    expect(lenin.summary).toContain('− Su parte de los gastos (1 gasto): $100')
    expect(lenin.summary).toContain('= Saldo: −$100 (le faltan $100 por pagar)')
    expect(r.people.find((p) => p.uid === 'ale')!.summary).toContain('(le deben $200)')
  })

  it('writes one message for the group and one for a person, naming who pays whom', () => {
    const r = report([])
    expect(groupMessage(r)).toContain('Lenin paga *$100* a Ale')
    const lenin = r.people.find((p) => p.uid === 'lenin')!
    const msg = personMessage(r, lenin)
    expect(msg).toContain('Hola Lenin')
    expect(msg).toContain('*Te toca pagar $100* a Ale')
    expect(personMessage(r, r.people.find((p) => p.uid === 'ale')!)).toContain('*Te deben $200*')
  })

  it('says everything is even when nobody owes anything', () => {
    const r = report([abono('p1', 'lenin', 'ale', 100), abono('p2', 'isabel', 'ale', 100)])
    expect(r.plan).toEqual([])
    expect(groupMessage(r)).toContain('al día')
  })
})
