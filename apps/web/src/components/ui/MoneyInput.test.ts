import { describe, it, expect } from 'vitest'
import { groupThousands } from './MoneyInput'

describe('groupThousands', () => {
  it('puts a dot every three digits', () => {
    expect(groupThousands('')).toBe('')
    expect(groupThousands('0')).toBe('0')
    expect(groupThousands('999')).toBe('999')
    expect(groupThousands('1000')).toBe('1.000')
    expect(groupThousands('1726200')).toBe('1.726.200')
    expect(groupThousands('-2895169')).toBe('-2.895.169')
  })
})
