import { describe, expect, it } from 'vitest';
import { planAbono } from './householdAbono';

const members = ['carlos', 'ale', 'sofi'];
const debt = (id: string, over: any = {}) => ({
  id, tipo: 'Deuda', debtor: 'carlos', creditor: 'ale', concept: id, amount: 100000, category: 'mercado', paidAbono: 0, crossedAmount: 0,
  date: new Date(2026, 9, Number(id.replace(/\D/g, '')) || 1), ...over,
});

describe('planAbono', () => {
  it('pays a chosen debt in one row linked to it, to that debt\'s creditor', () => {
    const debts = [debt('d1'), debt('d2', { creditor: 'sofi' })];
    const p = planAbono({ debts, members, debtor: 'carlos', targetDebtId: 'd2', amount: 30000, category: 'otros' });
    expect(p.kind).toBe('target');
    expect(p.rows).toEqual([{ concept: 'Abono: d2', amount: 30000, creditor: 'sofi', category: 'mercado', saldaId: 'd2' }]);
    expect(p.paidTo).toBe('sofi');
    expect(p.remainingAfter).toBe(70000);
    expect(p.paidLines).toEqual([{ concept: 'd2', amount: 30000 }]);
  });

  it('spreads a general payment over the debts owed to the creditor, oldest first, ignoring other creditors', () => {
    const debts = [debt('d1', { amount: 40000 }), debt('d2', { amount: 100000 }), debt('d3', { creditor: 'sofi', amount: 500000 })];
    const p = planAbono({ debts, members, debtor: 'carlos', creditor: 'ale', amount: 90000, category: 'otros' });
    expect(p.kind).toBe('allocated');
    expect(p.rows.map((r) => [r.saldaId, r.amount])).toEqual([['d1', 40000], ['d2', 50000]]);
    expect(p.rows.every((r) => r.creditor === 'ale')).toBe(true);
    expect(p.allocations).toBe(2);
  });

  it('records what is left over as a general abono row', () => {
    const debts = [debt('d1', { amount: 40000 })];
    const p = planAbono({ debts, members, debtor: 'carlos', creditor: 'ale', amount: 100000, concept: 'Para lo que falte', category: 'otros' });
    expect(p.rows.map((r) => [r.saldaId, r.amount])).toEqual([['d1', 40000], [null, 60000]]);
    expect(p.paidLines.map((l) => l.amount)).toEqual([40000, 60000]);
    expect(p.rows[1].concept).toBe('Para lo que falte');
  });

  it('is a general abono when nothing is owed', () => {
    const p = planAbono({ debts: [], members, debtor: 'carlos', creditor: 'ale', amount: 25000, category: 'otros' });
    expect(p.kind).toBe('general');
    expect(p.rows).toEqual([{ concept: 'Abono al hogar', amount: 25000, creditor: 'ale', category: 'otros', saldaId: null }]);
    expect(p.paidTo).toBe('ale');
  });

  it('takes the only creditor when none is given, but never guesses between several', () => {
    const one = planAbono({ debts: [debt('d1')], members, debtor: 'carlos', amount: 10000, category: 'otros' });
    expect(one.paidTo).toBe('ale');
    const several = planAbono({ debts: [debt('d1'), debt('d2', { creditor: 'sofi' })], members, debtor: 'carlos', amount: 10000, category: 'otros' });
    expect(several.paidTo).toBeNull();
  });

  it('ignores a target that no longer exists and falls back to spreading it', () => {
    const p = planAbono({ debts: [debt('d1')], members, debtor: 'carlos', creditor: 'ale', targetDebtId: 'gone', amount: 10000, category: 'otros' });
    expect(p.kind).toBe('allocated');
  });
});
