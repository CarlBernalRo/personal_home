/**
 * Marks every fixed expense that has no payment frequency yet as monthly (`everyMonths: 1`).
 * Expenses are monthly by default, so nothing changes in what the app shows: this only makes the
 * frequency explicit for the records that existed before the selector. Expenses that already have a
 * frequency are left alone.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would change;
 * nothing is written until you pass --apply.
 *
 * Run with:
 *   node scripts/set-fixed-frequency.mjs           (dry run)
 *   node scripts/set-fixed-frequency.mjs --apply   (writes)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const APPLY = process.argv.includes('--apply')

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
  const err = Array.isArray(data) ? data.find((r) => r.error)?.error : data.error
  if (err) throw new Error(`Firestore [${err.code}]: ${err.message}`)
  return data
}

const rows = await api(`${BASE}:runQuery`, {
  method: 'POST',
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'fixedExpenses' }] } }),
})
const expenses = rows.filter((r) => r.document).map((r) => r.document)
const pending = expenses.filter((d) => !d.fields.everyMonths)

console.log(`${expenses.length} gasto(s) fijo(s); ${pending.length} sin frecuencia (pasarán a mensual).`)
for (const d of pending) {
  console.log(`  · ${d.fields.userId?.stringValue}  ${d.fields.concept?.stringValue}`)
}

if (pending.length === 0) {
  console.log('Nada que cambiar.')
  process.exit(0)
}
if (!APPLY) {
  console.log('\nSimulación: no se escribió nada. Agrega --apply para marcarlos como mensuales.')
  process.exit(0)
}

for (let i = 0; i < pending.length; i += 400) {
  await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({
      writes: pending.slice(i, i + 400).map((d) => ({
        update: { name: d.name, fields: { everyMonths: { integerValue: '1' } } },
        updateMask: { fieldPaths: ['everyMonths'] },
      })),
    }),
  })
}
console.log(`\n✓ ${pending.length} gasto(s) fijo(s) marcados como mensuales.`)
