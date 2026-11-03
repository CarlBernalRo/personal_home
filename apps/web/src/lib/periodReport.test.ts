import { describe, it, expect } from 'vitest'
import { buildPeriodReport, type PeriodReportData } from './periodReport'

const d = (m: number, day: number) => new Date(2026, m - 1, day)

const sample: PeriodReportData = {
  userName: 'Ana',
  generatedAt: d(11, 1),
  start: d(10, 30),
  end: d(11, 29),
  salary: 2_895_169,
  extras: [{ concept: 'Ahorro INNCA', date: d(10, 30), amount: 1_526_959 }],
  extraTotal: 1_526_959,
  carryIn: 0,
  available: 4_422_128,
  totals: { fixed: 1_758_100, additional: 99_600, occasional: 0, reserved: 230_000 },
  remaining: 2_334_428,
  fixed: [
    { concept: 'Pago Claude', category: 'Suscripciones y apps', due: d(11, 1), amount: 32_200, state: 'Pagado', paidOn: d(10, 30) },
    { concept: 'Pago internet', category: 'Internet y telefonía', due: d(11, 9), amount: 75_000, state: 'Por pagar', paidOn: null },
    { concept: 'Agua', category: 'Servicios públicos', due: d(11, 15), amount: 60_000, state: 'Vencido', paidOn: null },
  ],
  additional: [{ concept: 'Desayuno', category: 'Comidas y restaurantes', date: d(10, 31), amount: 29_800, account: 'Cuenta Davivienda' }],
  occasional: [],
  accounts: [{ name: 'Cuenta Davivienda', balance: 2_832_228 }, { name: 'Nequi', balance: 8_455 }],
}

describe('buildPeriodReport', () => {
  it('produces a PDF file', async () => {
    const blob = await buildPeriodReport(sample)
    expect(blob.size).toBeGreaterThan(3_000)
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))
    expect(head).toBe('%PDF-')
  })

  it('copes with an empty period and a shortfall', async () => {
    const blob = await buildPeriodReport({ ...sample, extras: [], extraTotal: 0, fixed: [], additional: [], accounts: [], remaining: -50_000, totals: { fixed: 0, additional: 0, occasional: 0, reserved: 0 } })
    expect(blob.size).toBeGreaterThan(2_000)
  })
})
