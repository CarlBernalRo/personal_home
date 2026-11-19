/**
 * Deletes a (test) household with everything that hangs from it:
 *   householdDebts (deudas y abonos), householdCrossings, householdExpenses, householdInvites,
 *   its notifications, the personal `expenses` created from its shared expenses, the household doc itself,
 *   and the id on every member's profile (householdIds).
 * Money that the deleted records had taken out of an account (abonos, personal expenses) is given back to that
 * account, so balances end up as if the test never happened.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would do (dry run);
 * add --apply to really delete. Refuses to continue if the name matches more than one household.
 *
 * Run with:
 *   node scripts/seed-delete-household.mjs "<household name>"            (dry run)
 *   node scripts/seed-delete-household.mjs "<household name>" --apply    (delete)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const householdName = args.find((a) => !a.startsWith('--'))
if (!householdName) {
  console.error('Uso: node scripts/seed-delete-household.mjs "<hogar>" [--apply]')
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
  if (data.error) throw new Error(`Firestore [${data.error.code}]: ${data.error.message}`)
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
  // a failed runQuery answers with an array holding the error, not with an error object
  const failed = Array.isArray(rows) ? rows.find((r) => r.error)?.error : rows.error
  if (failed) throw new Error(`Firestore [${failed.code}]: ${failed.message}`)
  return rows.filter((r) => r.document).map((r) => r.document)
}

const idOf = (doc) => doc.name.split('/').pop()
const str = (f) => f?.stringValue
const num = (f) => (f?.integerValue !== undefined ? Number(f.integerValue) : f?.doubleValue !== undefined ? Number(f.doubleValue) : 0)
const strings = (f) => (f?.arrayValue?.values ?? []).map((v) => v.stringValue)

// ── find the household (exactly one) ────────────────────────────────────────
const matches = await where('households', 'name', householdName)
if (matches.length === 0) throw new Error(`No existe un hogar llamado "${householdName}".`)
if (matches.length > 1) throw new Error(`Hay ${matches.length} hogares llamados "${householdName}"; no sé cuál borrar.`)
const household = matches[0]
const householdId = idOf(household)
const members = strings(household.fields.members)
console.log(`Hogar "${householdName}" (${householdId}) · ${members.length} miembros · ${APPLY ? 'BORRANDO' : 'simulacro, no se borra nada'}`)

// ── everything that hangs from it ───────────────────────────────────────────
const debts = await where('householdDebts', 'householdId', householdId)
const crossings = await where('householdCrossings', 'householdId', householdId)
const expenses = await where('householdExpenses', 'householdId', householdId)
const invites = await where('householdInvites', 'householdId', householdId)
const notifications = await where('notifications', 'link', `/hogar?id=${householdId}`)
// the personal expenses born from this household's shared expenses
const personal = (await Promise.all(expenses.map((e) => where('expenses', 'householdExpenseId', idOf(e))))).flat()

// money taken out of an account by those records, to give back
const refunds = new Map()
const addRefund = (accountId, amount) => { if (accountId && amount) refunds.set(accountId, (refunds.get(accountId) ?? 0) + amount) }
for (const d of debts) if (str(d.fields.tipo) === 'Abono') addRefund(str(d.fields.accountId), num(d.fields.amount))
for (const e of personal) addRefund(str(e.fields.accountId), num(e.fields.amount))

console.log(`  deudas y abonos:        ${debts.length} (abonos: ${debts.filter((d) => str(d.fields.tipo) === 'Abono').length})`)
console.log(`  cruces:                 ${crossings.length}`)
console.log(`  gastos compartidos:     ${expenses.length}`)
console.log(`  gastos personales:      ${personal.length}`)
console.log(`  invitaciones:           ${invites.length}`)
console.log(`  notificaciones:         ${notifications.length}`)
console.log(`  perfiles a desvincular: ${members.length}`)
for (const [accountId, amount] of refunds) console.log(`  devolver a cuenta ${accountId}: ${amount}`)

if (!APPLY) {
  console.log('\nSimulacro terminado. Para borrar de verdad: agrega --apply')
  process.exit(0)
}

// ── apply: refunds, unlink, deletes ─────────────────────────────────────────
const COMMIT = `https://firestore.googleapis.com/v1/${DB}/documents:commit`
const commit = (writes) => api(COMMIT, { method: 'POST', body: JSON.stringify({ writes }) })

for (const [accountId, amount] of refunds) {
  const name = `${DB}/documents/accounts/${accountId}`
  const res = await fetch(`https://firestore.googleapis.com/v1/${name}`, { headers })
  if (!res.ok) { console.log(`  (la cuenta ${accountId} ya no existe, se omite su devolución)`); continue }
  await commit([{ transform: { document: name, fieldTransforms: [{ fieldPath: 'balance', increment: { doubleValue: amount } }] } }])
  console.log(`✓ devuelto ${amount} a la cuenta ${accountId}`)
}

for (const uid of members) {
  const name = `${DB}/documents/users/${uid}`
  const res = await fetch(`https://firestore.googleapis.com/v1/${name}`, { headers })
  if (!res.ok) continue
  await commit([{ transform: { document: name, fieldTransforms: [{ fieldPath: 'householdIds', removeAllFromArray: { values: [{ stringValue: householdId }] } }] } }])
}
console.log('✓ perfiles desvinculados')

const toDelete = [...debts, ...crossings, ...expenses, ...invites, ...notifications, ...personal, household].map((d) => d.name)
for (let i = 0; i < toDelete.length; i += 400) {
  await commit(toDelete.slice(i, i + 400).map((name) => ({ delete: name })))
}
console.log(`✓ ${toDelete.length} documentos borrados, hogar "${householdName}" eliminado.`)
