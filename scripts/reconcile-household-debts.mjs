/**
 * Checks that every household debt matches the movements that touch it, and fixes the ones that do not.
 * The movements are the truth: a debt's `paidAbono` is the sum of the abonos that point to it (`saldaId`), its
 * `crossedAmount` is the sum of its crossings, and its `estado` is "Saldado" when nothing is left to pay.
 * The app computes all this from the movements on screen; this keeps what is STORED equal to it.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS the differences; nothing is
 * written until you pass --apply.
 *
 *   node scripts/reconcile-household-debts.mjs           (dry run)
 *   node scripts/reconcile-household-debts.mjs --apply   (writes)
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
const num = (v) => Number(v?.integerValue ?? v?.doubleValue ?? 0)
const str = (v) => v?.stringValue ?? ''

const docs = await all('householdDebts')
const crossings = await all('householdCrossings')

const abonadoTo = new Map()
for (const d of docs) {
  if (str(d.fields.tipo) === 'Abono' && str(d.fields.saldaId)) {
    abonadoTo.set(str(d.fields.saldaId), (abonadoTo.get(str(d.fields.saldaId)) ?? 0) + num(d.fields.amount))
  }
}
// crossedAmount: a crossing adds its amount to the debt it starts from (debt1) and to each debt it settles (debt2)
const crossedOf = new Map()
for (const c of crossings) {
  const amount = num(c.fields.amount)
  for (const id of [str(c.fields.debt1Id), str(c.fields.debt2Id)]) if (id) crossedOf.set(id, (crossedOf.get(id) ?? 0) + amount)
}

const writes = []
let checked = 0
for (const d of docs) {
  if (str(d.fields.tipo) !== 'Deuda') continue
  checked++
  const id = d.name.split('/').pop()
  const amount = num(d.fields.amount)
  const paid = abonadoTo.get(id) ?? 0
  const crossed = crossedOf.get(id) ?? 0
  const remaining = amount - crossed - paid
  const want = { paidAbono: paid, crossedAmount: crossed, estado: remaining <= 0 ? 'Saldado' : '', cruzado: crossed >= amount && amount > 0 }
  const have = { paidAbono: num(d.fields.paidAbono), crossedAmount: num(d.fields.crossedAmount), estado: str(d.fields.estado), cruzado: d.fields.cruzado?.booleanValue === true }
  const diffs = Object.keys(want).filter((k) => want[k] !== have[k])
  if (diffs.length === 0) continue
  console.log(`  · ${str(d.fields.concept)} (${amount}): ${diffs.map((k) => `${k} ${have[k]} → ${want[k]}`).join(', ')}`)
  const fields = {
    paidAbono: { integerValue: String(paid) },
    crossedAmount: { integerValue: String(crossed) },
    estado: { stringValue: want.estado },
    cruzado: { booleanValue: want.cruzado },
  }
  writes.push({ update: { name: d.name, fields }, updateMask: { fieldPaths: Object.keys(fields) } })
}
console.log(`${checked} deuda(s) revisadas; ${writes.length} no coinciden con sus movimientos.`)
if (writes.length === 0) process.exit(0)
if (!APPLY) { console.log('\nSimulación: no se escribió nada. Agrega --apply para corregirlas.'); process.exit(0) }
for (let i = 0; i < writes.length; i += 400) {
  await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }) })
}
console.log(`\n✓ ${writes.length} deuda(s) corregidas.`)
