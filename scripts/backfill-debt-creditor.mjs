/**
 * Gives every household debt and abono a `creditor` (whom it is owed to), which a household with more than two
 * people needs to know who an abono is paid to. Old records only imply it:
 *  - a loan is owed to its lender,
 *  - a debt from a shared expense is owed to whoever paid that expense,
 *  - an abono goes to the creditor of the debt it settles,
 *  - anything else, in a household of exactly two, is owed to the other person.
 * What cannot be told (several people and no clue) is only listed, never guessed.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would write.
 *
 *   node scripts/backfill-debt-creditor.mjs           (dry run)
 *   node scripts/backfill-debt-creditor.mjs --apply   (writes)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const APPLY = process.argv.includes('--apply')
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
async function all(collectionId) {
  const rows = await api(`https://firestore.googleapis.com/v1/${DB}/documents:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }) })
  return rows.filter((r) => r.document).map((r) => r.document)
}
const str = (v) => v?.stringValue ?? ''
const idOf = (d) => d.name.split('/').pop()

const households = new Map((await all('households')).map((h) => [idOf(h), (h.fields.members?.arrayValue?.values ?? []).map((v) => v.stringValue)]))
const expenses = new Map((await all('householdExpenses')).map((e) => [idOf(e), str(e.fields.paidBy)]))
const debts = await all('householdDebts')
const byId = new Map(debts.map((d) => [idOf(d), d]))

function creditorFor(d, seen = new Set()) {
  const own = str(d.fields.creditor)
  if (own) return own
  const lender = str(d.fields.lender)
  if (lender) return lender
  const expenseId = str(d.fields.expenseId)
  if (expenseId && expenses.get(expenseId)) return expenses.get(expenseId)
  const target = str(d.fields.saldaId)
  if (target && byId.has(target) && !seen.has(target)) return creditorFor(byId.get(target), new Set([...seen, target]))
  const others = (households.get(str(d.fields.householdId)) ?? []).filter((m) => m !== str(d.fields.debtor))
  return others.length === 1 ? others[0] : ''
}

const writes = []
let unknown = 0
for (const d of debts) {
  if (str(d.fields.creditor)) continue
  const creditor = creditorFor(d)
  if (!creditor) { unknown++; console.log(`  ? sin poder saber a quién se le debe: ${str(d.fields.concept)} (${idOf(d)})`); continue }
  console.log(`  · ${str(d.fields.tipo)} "${str(d.fields.concept)}" → acreedor ${creditor}`)
  writes.push({ update: { name: d.name, fields: { creditor: { stringValue: creditor } } }, updateMask: { fieldPaths: ['creditor'] } })
}
console.log(`${debts.length} registro(s) revisados; ${writes.length} por completar; ${unknown} sin poder definirse.`)
if (writes.length === 0) process.exit(0)
if (!APPLY) { console.log('\nSimulación: no se escribió nada. Agrega --apply para escribir.'); process.exit(0) }
for (let i = 0; i < writes.length; i += 400) {
  await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }) })
}
console.log(`\n✓ ${writes.length} registro(s) completados.`)
