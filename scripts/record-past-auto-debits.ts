/**
 * Saves, as historical records, the automatic debits that fell due BEFORE their account existed. The app shows them as
 * "pagado automáticamente" but never stored them (their money was already inside the account's opening balance), so the
 * screen had a payment the database did not. Each one is stored with its date and amount, WITHOUT an account and without
 * touching any balance: deleting it later cannot refund anything either.
 *
 * Needs a Firebase CLI session. Lists what it would write unless --apply is passed.
 *
 *   cd apps/web && npx vite-node ../scripts/record-past-auto-debits.ts           (dry run)
 *   cd apps/web && npx vite-node ../scripts/record-past-auto-debits.ts --apply   (writes)
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import os from 'os'
import { planAutoPayments, withAutoPayments } from '../apps/web/src/shared/utils/fixedExpenses'

process.env.TZ ||= 'America/Bogota'
const APPLY = process.argv.includes('--apply')
const token = JSON.parse(readFileSync(resolve(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8')).tokens?.access_token
const DB = 'projects/personalhome-3ee06/databases/(default)'
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

function dec(v: any): any {
  if (v == null) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('timestampValue' in v) return new Date(v.timestampValue)
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(dec)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, dec(x)]))
  return null
}
async function all(c: string) {
  const res = await fetch(`https://firestore.googleapis.com/v1/${DB}/documents:runQuery`, { method: 'POST', headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: c }] } }) })
  const rows: any[] = await res.json()
  if (!Array.isArray(rows)) throw new Error(JSON.stringify(rows))
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...Object.fromEntries(Object.entries(r.document.fields ?? {}).map(([k, v]) => [k, dec(v)])) }))
}

const today = new Date()
const [expenses, payments, accounts] = await Promise.all([all('fixedExpenses'), all('fixedExpensePayments'), all('accounts')])
const userIds = [...new Set(expenses.filter((e: any) => Array.isArray(e.autoDebit) && e.autoDebit.length > 0).map((e: any) => e.userId as string))]

const writes: any[] = []
for (const uid of userIds) {
  const mine = expenses.filter((e: any) => e.userId === uid)
  const pays = payments.filter((p: any) => p.userId === uid)
  const accs = accounts.filter((a: any) => a.userId === uid)
  // due and unstored, minus what the planner would charge to an account = the ones that predate their account
  const planned = new Set(planAutoPayments(mine as any, pays as any, accs as any, today, uid).map((p) => p.docId))
  const generated = withAutoPayments(mine as any, pays as any, today).filter((p: any) => String(p.id).startsWith('auto|')) as any[]
  for (const p of generated) {
    const docId = `auto_${p.fixedExpenseId}_${p.month}`
    if (planned.has(docId)) continue
    console.log(`  · ${uid.slice(0, 6)}… ${p.concept} ${p.month} (${p.paymentDate.toDateString()}) $${p.paidAmount} → registro histórico, sin cuenta y sin tocar saldos`)
    writes.push({
      update: {
        name: `${DB}/documents/fixedExpensePayments/${docId}`,
        fields: {
          fixedExpenseId: { stringValue: p.fixedExpenseId },
          userId: { stringValue: uid },
          concept: { stringValue: p.concept ?? '' },
          paidAmount: { integerValue: String(p.paidAmount) },
          month: { stringValue: p.month },
          paymentDate: { timestampValue: p.paymentDate.toISOString() },
          notes: { stringValue: 'Registro histórico: venció antes de crear la cuenta y ya estaba incluido en su saldo inicial.' },
          auto: { booleanValue: true },
          historical: { booleanValue: true },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      },
      currentDocument: { exists: false }, // never overwrites a payment that is already there
    })
  }
}
console.log(`${writes.length} registro(s) histórico(s) por guardar.`)
if (writes.length === 0) process.exit(0)
if (!APPLY) { console.log('\nSimulación: no se escribió nada. Agrega --apply.'); process.exit(0) }
const res = await fetch(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, { method: 'POST', headers, body: JSON.stringify({ writes }) })
const out: any = await res.json()
if (out.error) throw new Error(out.error.message)
console.log(`\n✓ ${writes.length} registro(s) guardados.`)
