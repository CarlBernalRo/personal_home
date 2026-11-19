import { describe, expect, it } from 'vitest'
import { nextReminderDate, reminderDates } from './reminder'

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)

describe('reminderDates', () => {
  it('a one-off reminder only on its day', () => {
    expect(reminderDates({ date: '2026-11-20', every: 0 }, d(2026, 11, 1), d(2026, 12, 1))).toEqual(['2026-11-20'])
    expect(reminderDates({ date: '2026-11-20', every: 0 }, d(2026, 12, 1), d(2027, 1, 1))).toEqual([])
  })
  it('every 3 months, found far from the first date', () => {
    expect(reminderDates({ date: '2026-01-15', every: 3 }, d(2027, 1, 1), d(2028, 1, 1))).toEqual(['2027-01-15', '2027-04-15', '2027-07-15', '2027-10-15'])
  })
  it('on the 31st it falls on the last day of shorter months', () => {
    expect(reminderDates({ date: '2026-01-31', every: 1 }, d(2026, 2, 1), d(2026, 5, 1))).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('nothing before its first date', () => {
    expect(reminderDates({ date: '2026-06-10', every: 1 }, d(2026, 1, 1), d(2026, 7, 1))).toEqual(['2026-06-10'])
  })
})

describe('nextReminderDate', () => {
  it('skips the dates already done', () => {
    const r = { date: '2026-11-01', every: 1, done: { '2026-12-01': { by: 'u', name: 'U', at: '' } } }
    expect(nextReminderDate(r, d(2026, 11, 20))).toBe('2027-01-01')
  })
})
