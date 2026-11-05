import { describe, it, expect } from 'vitest'
import { buildLedger } from '@/components/household/ledger'
import { resolveExpenseShares } from '@/shared/utils/householdSplit'

// ACA1-QA · Prueba de rendimiento: tiempo de cómputo del libro de deudas con volumen creciente
function datos(n: number) {
  const debts: any[] = []
  for (let i = 0; i < n; i++) {
    debts.push({
      id: `d${i}`, debtor: i % 2 ? 'u1' : 'u2', amount: 10000 + (i % 50) * 1000,
      concept: `Gasto ${i}`, tipo: i % 5 === 4 ? 'Abono' : 'Deuda',
      date: new Date(2026, 0, 1 + (i % 300)), createdAt: new Date(2026, 0, 1, 0, 0, i % 60),
    })
  }
  return debts
}
const ms = (f: () => void, reps = 5) => {
  const t: number[] = []
  for (let i = 0; i < reps; i++) { const a = performance.now(); f(); t.push(performance.now() - a) }
  return t.sort((a, b) => a - b)[Math.floor(reps / 2)]
}

describe('ACA1 - Prueba de rendimiento', () => {
  it('CP-R-01 buildLedger con 100 / 1.000 / 5.000 / 10.000 movimientos', () => {
    const lim: Record<number, number> = { 100: 50, 1000: 200, 5000: 1000, 10000: 2000 }
    for (const n of [100, 1000, 5000, 10000]) {
      const d = datos(n)
      const t = ms(() => buildLedger(d, [], 'u1', 'u2'))
      console.log(`CP-R-01 n=${n} mediana=${t.toFixed(2)} ms (límite ${lim[n]} ms)`)
      expect(t).toBeLessThan(lim[n])
    }
  })
  it('CP-R-02 resolveExpenseShares: 100.000 divisiones', () => {
    const m = [{ memberId: 'a' }, { memberId: 'b' }, { memberId: 'c' }] as any
    const t = ms(() => { for (let i = 1; i <= 100000; i++) resolveExpenseShares(10000 + i, 'a', 'equal', m) }, 3)
    console.log(`CP-R-02 100000 divisiones = ${t.toFixed(2)} ms -> ${(t * 1000 / 100000).toFixed(3)} µs/op`)
    expect(t).toBeLessThan(1000)
  })
})
