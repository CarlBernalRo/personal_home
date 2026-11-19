/**
 * Deletes ONE shared expense (householdExpenses/<id>) with what hangs from it: the debts it generated (and the
 * abonos that point at them), and the personal expenses born from it — giving back to their account the money
 * they took out (abonos included). Same effect as "Eliminar gasto compartido" in the app, for a duplicate or a test.
 *
 * Needs a Firebase CLI session ("firebase login"). Dry run by default; add --apply to really delete.
 *
 *   node scripts/seed-delete-household-expense.mjs <expenseId>            (dry run)
 *   node scripts/seed-delete-household-expense.mjs <expenseId> --apply    (delete)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const expenseId = args.find((a) => !a.startsWith('--'))
if (!expenseId) {
  console.error('Uso: node scripts/seed-delete-household-expense.mjs <expenseId> [--apply]')
  process.exit(1)
}

const PROJECT_ID = 'personalhome-3ee06'
const DB = `projects/${PROJECT_ID}/databases/(default)`
const BASE = `https://firestore.googleapis.com/v1/${DB}/documents`

function getToken() {
  const configPath = resolve(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!existsSync(configPath)) throw new Error('No hay sesión de Firebase CLI. Ejecuta "firebase login".')
  const token = JSON.parse(readFileSync(configPath, 'utf8')).tokens?.access_token
  if (!token) throw new Error('Sin access_token. Ejecuta "firebase login --reauth".')
  return token
}
const headers = { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' }

async function api(url, options = {}) {
  const res = await fetch(url, { headers, ...options })
  const data = await res.json()
  const failed = Array.isArray(data) ? data.find((r) => r.error)?.error : data.error
  if (failed) throw new Error(`Firestore [${failed.code}]: ${failed.message}`)
  return data
}

async function where(collectionId, field, value) {
  const rows = await api(`${BASE}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
      },
    }),
  })
  return rows.filter((r) => r.document).map((r) => r.document)
}

const str = (f) => f?.stringValue
const num = (f) => (f?.integerValue !== undefined ? Number(f.integerValue) : f?.doubleValue !== undefined ? Number(f.doubleValue) : 0)

const expense = await api(`${BASE}/householdExpenses/${expenseId}`)
console.log(`Gasto "${str(expense.fields.description)}" (${expenseId}) · ${num(expense.fields.amount)} · categoría ${str(expense.fields.category)} · ${APPLY ? 'BORRANDO' : 'simulacro, no se borra nada'}`)

const householdId = str(expense.fields.householdId)
const debts = (await where('householdDebts', 'expenseId', expenseId)).filter((d) => str(d.fields.householdId) === householdId)
const debtIds = new Set(debts.map((d) => d.name.split('/').pop()))
// abonos that pay those debts
const abonos = (await Promise.all([...debtIds].map((id) => where('householdDebts', 'saldaId', id)))).flat().filter((d) => !debtIds.has(d.name.split('/').pop()))
const personal = await where('expenses', 'householdExpenseId', expenseId)

const refunds = new Map()
const addRefund = (accountId, amount) => { if (accountId && amount) refunds.set(accountId, (refunds.get(accountId) ?? 0) + amount) }
for (const d of abonos) if (str(d.fields.tipo) === 'Abono') addRefund(str(d.fields.accountId), num(d.fields.amount))
for (const e of personal) addRefund(str(e.fields.accountId), num(e.fields.amount))

console.log(`  deudas:            ${debts.length}`)
console.log(`  abonos a ellas:    ${abonos.length}`)
console.log(`  gastos personales: ${personal.length}`)
for (const [accountId, amount] of refunds) console.log(`  devolver a cuenta ${accountId}: ${amount}`)

if (!APPLY) {
  console.log('\nSimulacro terminado. Para borrar de verdad: agrega --apply')
  process.exit(0)
}

const COMMIT = `https://firestore.googleapis.com/v1/${DB}/documents:commit`
const commit = (writes) => api(COMMIT, { method: 'POST', body: JSON.stringify({ writes }) })

for (const [accountId, amount] of refunds) {
  const name = `${DB}/documents/accounts/${accountId}`
  const res = await fetch(`https://firestore.googleapis.com/v1/${name}`, { headers })
  if (!res.ok) { console.log(`  (la cuenta ${accountId} ya no existe, se omite su devolución)`); continue }
  await commit([{ transform: { document: name, fieldTransforms: [{ fieldPath: 'balance', increment: { doubleValue: amount } }] } }])
  console.log(`✓ devuelto ${amount} a la cuenta ${accountId}`)
}

const toDelete = [...debts, ...abonos, ...personal, expense].map((d) => d.name)
await commit(toDelete.map((name) => ({ delete: name })))
console.log(`✓ ${toDelete.length} documentos borrados.`)
