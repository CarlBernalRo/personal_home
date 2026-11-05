import { describe, it, expect } from 'vitest'
import { resolveExpenseShares, sharesToDebtors, SplitValidationError } from '@/shared/utils/householdSplit'

// ACA1-QA · Prueba funcional: división automática de gastos compartidos del hogar (RF: "división automática")
describe('ACA1 - Prueba funcional: resolveExpenseShares', () => {
  it('CP-F-01 división equitativa de $100.001 COP entre 3; el sobrante (2 pesos) se reparte empezando por quien pagó', () => {
    const shares = resolveExpenseShares(100001, 'ana', 'equal', [
      { memberId: 'ana' }, { memberId: 'carlos' }, { memberId: 'luis' },
    ] as any)
    console.log('CP-F-01 entrada: monto=100001, paga=ana, modo=equal, 3 miembros')
    console.log('CP-F-01 obtenido:', JSON.stringify(shares))
    expect(shares.map((s) => s.amount)).toEqual([33334, 33334, 33333])
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(100001)
    expect(sharesToDebtors(shares).map((s) => s.memberId)).toEqual(['carlos', 'luis'])
  })

  it('CP-F-02 validaciones: porcentajes != 100, monto <= 0, pagador ausente, miembro duplicado', () => {
    const two = [{ memberId: 'ana', percentage: 70 }, { memberId: 'carlos', percentage: 20 }] as any
    const casos: Array<[string, () => unknown]> = [
      ['porcentajes suman 90', () => resolveExpenseShares(50000, 'ana', 'percentage', two)],
      ['monto 0', () => resolveExpenseShares(0, 'ana', 'equal', [{ memberId: 'ana' }] as any)],
      ['pagador fuera de la división', () => resolveExpenseShares(1000, 'zoe', 'equal', [{ memberId: 'ana' }, { memberId: 'carlos' }] as any)],
      ['miembro duplicado', () => resolveExpenseShares(1000, 'ana', 'equal', [{ memberId: 'ana' }, { memberId: 'ana' }] as any)],
      ['montos fijos no suman el total', () => resolveExpenseShares(1000, 'ana', 'fixed' as any, [{ memberId: 'ana', fixedAmount: 400 }, { memberId: 'carlos', fixedAmount: 500 }] as any)],
    ]
    for (const [nombre, fn] of casos) {
      let msg = ''
      try { fn() } catch (e) { expect(e).toBeInstanceOf(SplitValidationError); msg = (e as Error).message }
      console.log(`CP-F-02 [${nombre}] ->`, msg || 'NO LANZÓ ERROR')
      expect(msg).not.toBe('')
    }
  })
})
