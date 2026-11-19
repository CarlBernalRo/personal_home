import { describe, expect, it } from 'vitest'
import { requestAlive, sameList, viewersOf } from './family'

const family = { members: ['carlos', 'ale', 'mama'], shares: {} as any }

describe('viewersOf (who may read one of my fixed expenses)', () => {
  it('nobody, when nothing is shared', () => {
    expect(viewersOf({ id: 'e1', category: 'servicios' }, family, 'carlos')).toEqual([])
  })
  it('a shared category opens its expenses to the whole family (without me)', () => {
    const f = { ...family, shares: { carlos: { categories: ['servicios'], expenseIds: [] as string[], with: 'all' as const } } }
    expect(viewersOf({ id: 'e1', category: 'servicios' }, f, 'carlos')).toEqual(['ale', 'mama'])
    expect(viewersOf({ id: 'e2', category: 'arriendo' }, f, 'carlos')).toEqual([])
  })
  it('a single expense, only with the chosen people still in the family', () => {
    const f = { ...family, shares: { carlos: { categories: [] as string[], expenseIds: ['e2'], with: ['ale', 'gone'] } } }
    expect(viewersOf({ id: 'e2', category: 'arriendo' }, f, 'carlos')).toEqual(['ale'])
  })
  it('nothing once I am no longer a member, or without a family', () => {
    const f = { members: ['ale'], shares: { carlos: { categories: ['servicios'], expenseIds: [] as string[], with: 'all' as const } } } as any
    expect(viewersOf({ id: 'e1', category: 'servicios' }, f, 'carlos')).toEqual([])
    expect(viewersOf({ id: 'e1', category: 'servicios' }, null, 'carlos')).toEqual([])
  })
})

describe('helpers', () => {
  it('a request expires after 7 days', () => {
    const now = new Date('2026-11-20T12:00:00Z')
    expect(requestAlive({ name: 'A', photo: null, at: '2026-11-15T12:00:00Z' }, now)).toBe(true)
    expect(requestAlive({ name: 'A', photo: null, at: '2026-11-12T12:00:00Z' }, now)).toBe(false)
  })
  it('compares lists in any order', () => {
    expect(sameList(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(sameList(['a'], ['a', 'b'])).toBe(false)
  })
})
