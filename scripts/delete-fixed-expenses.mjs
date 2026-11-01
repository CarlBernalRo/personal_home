/**
 * Deletes ALL the fixed expenses configured for one user (archived ones included).
 * Their registered payments are NOT touched: they are real money movements and keep counting in
 * the user's cash. The script says how many payments belong to the expenses it removes.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would delete;
 * nothing is removed until you pass --apply.
 *
 * Run with:
 *   node scripts/delete-fixed-expenses.mjs <email>            (dry run)
 *   node scripts/delete-fixed-expenses.mjs <email> --apply    (deletes)
 *   node scripts/delete-fixed-expenses.mjs otro@correo.com --apply
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const [emailArg, ...flags] = process.argv.slice(2)
if (!emailArg) {
  console.error('Uso: node scripts/delete-fixed-expenses.mjs <correo> [--apply]')
  process.exit(1)
}
const EMAIL = emailArg.toLowerCase()
const APPLY = flags.includes('--apply')

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
  return rows.filter((r) => r.document).map((r) => r.document)
}

const users = await where('users', 'email', EMAIL)
if (users.length !== 1) throw new Error(`Esperaba un perfil en /users con el correo ${EMAIL} y encontré ${users.length}.`)
const uid = users[0].name.split('/').pop()

const expenses = await where('fixedExpenses', 'userId', uid)
const payments = await where('fixedExpensePayments', 'userId', uid)
const ids = new Set(expenses.map((d) => d.name.split('/').pop()))
const linked = payments.filter((p) => ids.has(p.fields.fixedExpenseId?.stringValue)).length

console.log(`Usuario ${EMAIL} (${uid}): ${expenses.length} gasto(s) fijo(s) configurado(s).`)
for (const d of expenses) {
  const f = d.fields
  console.log(`  · ${f.concept?.stringValue}  (${f.active?.booleanValue ? 'activo' : 'archivado'})`)
}
console.log(`Pagos registrados de esos gastos: ${linked} (no se tocan).`)

if (expenses.length === 0) {
  console.log('Nada que eliminar.')
  process.exit(0)
}
if (!APPLY) {
  console.log('\nSimulación: no se eliminó nada. Agrega --apply para eliminarlos.')
  process.exit(0)
}

await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
  method: 'POST',
  body: JSON.stringify({ writes: expenses.map((d) => ({ delete: d.name })) }),
})
console.log(`\n✓ ${expenses.length} gasto(s) fijo(s) eliminado(s).`)
