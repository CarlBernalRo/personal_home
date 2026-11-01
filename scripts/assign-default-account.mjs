/**
 * Associates what was already registered (incomes, fixed-expense payments and the spends that count) with its owner's "Cuenta default".
 * The default account was created holding the money the user had at that moment, and that money already
 * includes all of this, so the records are only TAGGED: no account balance changes. From then on, undoing a
 * payment or deleting a spend gives the money back to that account.
 *
 * Users without a default account yet are listed and skipped: the account is created (and their records
 * tagged) by the app itself the first time they open Inicio or Fijos.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would change;
 * nothing is written until you pass --apply.
 *
 * Run with:
 *   node scripts/assign-incomes-to-default-account.mjs           (dry run)
 *   node scripts/assign-incomes-to-default-account.mjs --apply   (writes)
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

async function query(collectionId, where) {
  const rows = await api(`${BASE}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], ...(where ? { where } : {}) } }),
  })
  return rows.filter((r) => r.document).map((r) => r.document)
}

const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value } })

const defaults = await query('accounts', eq('isDefault', { booleanValue: true }))

// What was already counted in the user's money: every income, every fixed payment, and the spends that count
// (registered from Gastos or against an occasional budget; older records are history only, so they stay out).
const SOURCES = [
  { collection: 'incomes', label: 'ingreso(s)', counts: () => true },
  { collection: 'fixedExpensePayments', label: 'pago(s) de gastos fijos', counts: () => true },
  { collection: 'expenses', label: 'gasto(s) adicionales/ocasionales', counts: (d) => d.fields.tracked?.booleanValue === true || !!d.fields.variableBudgetId?.stringValue },
]

const writes = []
const pendingUsers = new Set()
for (const src of SOURCES) {
  const docs = (await query(src.collection)).filter(src.counts)
  const byUser = new Map()
  for (const d of docs) {
    const uid = d.fields.userId?.stringValue
    if (uid) byUser.set(uid, [...(byUser.get(uid) ?? []), d])
  }
  for (const [uid, items] of byUser) {
    const account = defaults.find((a) => a.fields.userId?.stringValue === uid)
    if (!account) { pendingUsers.add(uid); continue }
    const accountId = account.name.split('/').pop()
    const untagged = items.filter((d) => !d.fields.accountId?.stringValue)
    console.log(`· ${uid}: ${untagged.length} de ${items.length} ${src.label} por asociar a ${accountId}.`)
    for (const d of untagged) {
      writes.push({ update: { name: d.name, fields: { accountId: { stringValue: accountId } } }, updateMask: { fieldPaths: ['accountId'] } })
    }
  }
}
for (const uid of pendingUsers) {
  console.log(`· ${uid}: sin Cuenta default todavía; se asociarán al crearla (al abrir Inicio o Fijos).`)
}

if (writes.length === 0) {
  console.log('\nNada que asociar.')
  process.exit(0)
}
if (!APPLY) {
  console.log(`\nSimulación: ${writes.length} registro(s) se asociarían. Agrega --apply para escribirlos.`)
  process.exit(0)
}

for (let i = 0; i < writes.length; i += 400) {
  await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
  })
}
console.log(`\n✓ ${writes.length} registro(s) asociado(s) a su Cuenta default.`)
