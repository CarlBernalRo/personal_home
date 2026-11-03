/**
 * Marks the fixed-expense payments of ONE user and ONE month that have no account as paid from a given account.
 * Only the payments' account changes: the account's balance is NOT touched (use it for money that already left
 * the account before it was tracked here).
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would change;
 * nothing is written until you pass --apply.
 *
 * Run with:
 *   node scripts/set-payment-account.mjs <userId> <accountId> <month yyyy-MM>           (dry run)
 *   node scripts/set-payment-account.mjs <userId> <accountId> <month yyyy-MM> --apply   (writes)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const [userId, accountId, month, ...flags] = process.argv.slice(2)
const APPLY = flags.includes('--apply')
if (!userId || !accountId || !/^\d{4}-\d{2}$/.test(month ?? '')) {
  console.error('Uso: node scripts/set-payment-account.mjs <idUsuario> <idCuenta> <mes yyyy-MM> [--apply]')
  process.exit(1)
}

const DB = 'projects/personalhome-3ee06/databases/(default)'
const configPath = resolve(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
if (!existsSync(configPath)) throw new Error('No hay sesión de Firebase CLI. Ejecuta "firebase login".')
const token = JSON.parse(readFileSync(configPath, 'utf8')).tokens?.access_token
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function api(url, options = {}) {
  const res = await fetch(url, { headers, ...options })
  const data = await res.json()
  const err = Array.isArray(data) ? data.find((r) => r.error)?.error : data.error
  if (err) throw new Error(`Firestore [${err.code}]: ${err.message}`)
  return data
}

// the account must exist and belong to the user
const account = await api(`https://firestore.googleapis.com/v1/${DB}/documents/accounts/${accountId}`)
if (account.fields?.userId?.stringValue !== userId) throw new Error('Esa cuenta no pertenece a ese usuario.')

const rows = await api(`https://firestore.googleapis.com/v1/${DB}/documents:runQuery`, {
  method: 'POST',
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'fixedExpensePayments' }], where: { compositeFilter: { op: 'AND', filters: [
    { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
    { fieldFilter: { field: { fieldPath: 'month' }, op: 'EQUAL', value: { stringValue: month } } },
  ] } } } }),
})
const pending = rows.filter((r) => r.document).map((r) => r.document).filter((d) => !d.fields.accountId?.stringValue)

console.log(`Cuenta: ${account.fields.name?.stringValue}. Pagos de ${month} sin cuenta: ${pending.length}`)
for (const d of pending) console.log(`  · ${d.fields.concept?.stringValue}  ${d.fields.paidAmount?.integerValue ?? d.fields.paidAmount?.doubleValue}`)

if (pending.length === 0) { console.log('Nada que asociar.'); process.exit(0) }
if (!APPLY) { console.log('\nSimulación: no se escribió nada. Agrega --apply para asociarlos.'); process.exit(0) }

await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
  method: 'POST',
  body: JSON.stringify({ writes: pending.map((d) => ({ update: { name: d.name, fields: { accountId: { stringValue: accountId } } }, updateMask: { fieldPaths: ['accountId'] } })) }),
})
console.log(`\n✓ ${pending.length} pago(s) asociados a la cuenta.`)
