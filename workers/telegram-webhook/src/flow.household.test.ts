import { describe, expect, it } from 'vitest'
import { onCallback, onText, startFromImage, type FlowDeps } from './flow'
import type { Db, Doc, Filter } from './db'
import type { Keyboard, Telegram } from './telegram'
import { EMPTY_EXTRACTED } from './vision'

/** In-memory Firestore with just what the flow uses. */
function memoryDb(seed: Record<string, Record<string, any>>): Db & { all: (c: string) => Doc[] } {
  const store = new Map<string, Record<string, any>>()
  for (const [path, data] of Object.entries(seed)) store.set(path, data)
  let n = 0
  const match = (d: any, f: Filter) => (f.op === 'EQUAL' ? d[f.field] === f.value : f.op === 'ARRAY_CONTAINS' ? (d[f.field] ?? []).includes(f.value) : true)
  const all = (c: string) => [...store.entries()].filter(([p]) => p.startsWith(`${c}/`) && p.split('/').length === 2).map(([p, d]) => ({ id: p.split('/')[1], ...d }))
  return {
    all,
    async query(c, filters = []) { return all(c).filter((d) => filters.every((f) => match(d, f))) },
    async get(p) { const d = store.get(p); return d ? { id: p.split('/').pop()!, ...d } : null },
    async set(p, data) { store.set(p, JSON.parse(JSON.stringify(data))) },
    async patch(p, data) { store.set(p, { ...(store.get(p) ?? {}), ...data }) },
    async add(c, data) { const id = `id${++n}`; store.set(`${c}/${id}`, JSON.parse(JSON.stringify(data))); return id },
    async remove(p) { store.delete(p) },
    async batch() {},
  }
}

function fakeTelegram() {
  const last = { text: '', kb: [] as Keyboard, sent: [] as string[] }
  const tg: Telegram = {
    async send(_c, text, kb) { last.text = text; last.kb = kb ?? []; last.sent.push(text); return 1 },
    async edit(_c, _m, text, kb) { last.text = text; last.kb = kb ?? [] },
    async answer() {},
    async download() { return { bytes: new Uint8Array(), mime: 'image/jpeg' } },
  }
  return { tg, last }
}

const ME = 'carlos'
const ALE = 'ale'
const GUEST = 'guest_abc'
const seed = {
  [`households/h1`]: { name: 'Casa', members: [ME, ALE, GUEST], guestIds: [GUEST], memberNames: { [ME]: 'Carlos', [ALE]: 'Ale', [GUEST]: 'Pepe' } },
  // Pepe (guest) owes Carlos 30.000
  [`householdDebts/d1`]: { householdId: 'h1', tipo: 'Deuda', debtor: GUEST, creditor: ME, amount: 30000, concept: 'Mercado', date: '2026-11-01', cruzado: false, crossedAmount: 0 },
  [`accounts/a1`]: { userId: ME, name: 'Nequi', balance: 100000 },
  [`users/${ME}`]: {},
}

async function setup(amount: number) {
  const db = memoryDb(seed)
  const { tg, last } = fakeTelegram()
  const d: FlowDeps = { db, tg, now: () => new Date('2026-11-24T15:00:00Z').getTime() }
  await startFromImage(d, ME, 7, { extract: async () => ({ ...EMPTY_EXTRACTED, is_payment_proof: true, amount, date: '2026-11-24', direction: 'income', counterparty: 'Pepe Pérez' }), keep: async () => null })
  const press = async (data: string) => {
    const flow = await db.get('telegramFlows/7')
    await onCallback(d, ME, { id: 'cb', chatId: 7, messageId: flow!.messageId, data })
  }
  const type = (t: string) => onText(d, ME, 7, t)
  return { db, last, press, type }
}

describe('Telegram: household movements from a screenshot', () => {
  it('a guest paid me: their abono to me, into my account', async () => {
    const { db, last, press } = await setup(20000)
    await press('f:ok'); await press('f:ok')
    expect(last.text).toContain('Pepe</b> (invitado)')
    await press('f:k:received')
    await press('f:hh:h1')
    expect(last.text).toContain('Quién paga')
    expect(last.kb.flat().some((b) => b.text.includes('Pepe (invitado) · debe $30.000'))).toBe(true)
    await press(`f:db:${GUEST}`)
    expect(last.text).toContain('¿A quién le pagó <b>Pepe (invitado)</b>?')
    await press(`f:cr:${ME}`)
    expect(last.text).toContain('le debe <b>$30.000</b> a ti')
    await press('f:rt:d1')
    await press('f:acc:a1')
    await press('f:skip')
    expect(last.text).toContain('queda como tu ingreso')
    await press('f:send')
    const pm = db.all('pendingMovements')[0]
    expect(pm).toMatchObject({ kind: 'received', amount: 20000, householdId: 'h1', debtorId: GUEST, creditorId: ME, targetDebtId: 'd1', accountId: 'a1', concept: 'Pago de Pepe (invitado) · Casa' })
  })

  it('a guest paid someone else: no account of mine moves', async () => {
    const { db, last, press } = await setup(15000)
    await press('f:ok'); await press('f:ok')
    await press('f:k:received')
    await press('f:hh:h1')
    await press(`f:db:${GUEST}`)
    await press(`f:cr:${ALE}`)
    expect(last.text).toContain('Pepe (invitado) no le debe nada registrado a Ale')
    await press('f:rt:auto')
    // straight to the comment: the account is not asked
    expect(last.text).toContain('comentario')
    expect(last.text).not.toContain('Cuenta:')
    await press('f:skip')
    expect(last.text).toContain('Ninguna de tus cuentas se mueve')
    await press('f:send')
    const pm = db.all('pendingMovements')[0]
    expect(pm).toMatchObject({ kind: 'received', debtorId: GUEST, creditorId: ALE, concept: 'Pago de Pepe (invitado) a Ale · Casa' })
    expect(pm.accountId).toBeUndefined()
    expect(pm.targetDebtId).toBeUndefined()
  })

  it('I pay: it is my own abono, as always', async () => {
    const { db, press } = await setup(10000)
    await press('f:ok'); await press('f:ok')
    await press('f:k:received')
    await press('f:hh:h1')
    await press(`f:db:${ME}`)
    await press(`f:cr:${ALE}`)
    await press('f:rt:auto')
    await press('f:acc:a1')
    await press('f:skip')
    await press('f:send')
    const pm = db.all('pendingMovements')[0]
    expect(pm).toMatchObject({ kind: 'abono', creditorId: ALE, accountId: 'a1', concept: 'Abono a Ale · Casa' })
    expect(pm.debtorId).toBeUndefined()
  })

  it('a shared expense a guest paid, split in percentages', async () => {
    const { db, last, press, type } = await setup(90000)
    await press('f:ok'); await press('f:ok')
    await press('f:k:shared')
    await press('f:hh:h1')
    await type('Asado')
    await press('f:hc:alimentacion')
    expect(last.text).toContain('¿Entre quiénes')
    await press('f:pt:done')
    await press('f:sp:percentage')
    await type('50 30')
    expect(last.sent.at(-1)).toContain('Escribe 3 valores')
    await type('50 30 20')
    // the guest paid it all: Carlos is not a payer, so no account is asked
    await press('f:py:0') // remove Carlos
    await press('f:py:2') // add Pepe
    await press('f:py:done')
    expect(last.text).toContain('fecha acordada')
    await press('f:due:none')
    await press('f:skip')
    expect(last.text).not.toContain("Cuenta:")
    expect(last.text).toContain('Tú le debes $45.000 a Pepe')
    expect(last.text).toContain('Ale le debe $27.000 a Pepe')
    await press('f:send')
    const pm = db.all('pendingMovements')[0]
    expect(pm).toMatchObject({
      kind: 'shared', amount: 90000, concept: 'Asado', category: 'alimentacion', householdId: 'h1', dueDate: null,
      split: { mode: 'percentage', shares: [{ memberId: ME, value: 50 }, { memberId: ALE, value: 30 }, { memberId: GUEST, value: 20 }] },
      payers: [{ memberId: GUEST, amount: 90000 }],
    })
  })

  it('a shared expense two people paid, equal parts, my part from my account', async () => {
    const { db, last, press, type } = await setup(60000)
    await press('f:ok'); await press('f:ok')
    await press('f:k:shared')
    await press('f:hh:h1')
    await type('Gasolina')
    await press('f:hc:transporte')
    await press('f:pt:done')
    await press('f:sp:equal')
    await press('f:py:1') // Ale also paid
    await press('f:py:done')
    await type('10000 20000')
    expect(last.sent.at(-1)).toContain('deben coincidir')
    await type('40000 20000')
    expect(last.text).toContain('salió tu parte ($40.000)')
    await press('f:acc:a1')
    await type('30/11/2026')
    await press('f:skip')
    expect(last.text).toContain('El aporte de Ale queda por confirmar')
    await press('f:send')
    const pm = db.all('pendingMovements')[0]
    expect(pm).toMatchObject({ kind: 'shared', payers: [{ memberId: ME, amount: 40000 }, { memberId: ALE, amount: 20000 }], accountId: 'a1', split: { mode: 'equal' } })
    expect(pm.dueDate).toBe('2026-11-30T17:00:00.000Z')
  })
})
