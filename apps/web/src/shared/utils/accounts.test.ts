import { describe, it, expect } from 'vitest'
import { withPockets, topAccounts } from './accounts'

describe('pockets (cuentas hijas)', () => {
  const accounts = [
    { id: 'dav', balance: 1951616 },
    { id: 'mami', balance: -395716, parentId: 'dav' },
    { id: 'banco', balance: 3294952 },
  ]
  it('the parent shows what the bank holds: its own plus its pockets', () => {
    const r = withPockets(accounts)
    expect(r.find((a) => a.id === 'dav')!.balance).toBe(1555900)
    expect(r.find((a) => a.id === 'dav')!.ownBalance).toBe(1951616)
    expect(r.find((a) => a.id === 'mami')!.balance).toBe(-395716)
    expect(r.find((a) => a.id === 'banco')!.balance).toBe(3294952)
  })
  it('totals leave the pockets out so nothing counts twice', () => {
    const total = topAccounts(withPockets(accounts)).reduce((s, a) => s + a.balance, 0)
    expect(total).toBe(1555900 + 3294952)
  })
  it('a pocket whose parent is gone stands alone', () => {
    const r = withPockets([{ id: 'x', balance: 5, parentId: 'gone' }])
    expect(r[0].parentId).toBeUndefined()
    expect(topAccounts(r)).toHaveLength(1)
  })
})
