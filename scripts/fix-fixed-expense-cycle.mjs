/**
 * Corrects the payment cycle of ONE fixed expense: sets its start month, the month one of its bills falls in
 * and how often it is paid, and clears its configuration history (which keeps the old, wrong cycle for the
 * months before a change). Payments already registered are not touched.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only SHOWS the expense and what would change;
 * nothing is written until you pass --apply.
 *
 * Run with:
 *   node scripts/fix-fixed-expense-cycle.mjs <expenseId> <startMonth> <cycleStart> <everyMonths>           (dry run)
 *   node scripts/fix-fixed-expense-cycle.mjs <expenseId> <startMonth> <cycleStart> <everyMonths> --apply   (writes)
 *   e.g. node scripts/fix-fixed-expense-cycle.mjs <idGasto> 2026-11 2026-09 2 --apply
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const [id, startMonth, cycleStart, every, ...flags] = process.argv.slice(2)
const APPLY = flags.includes('--apply')
if (!id || !/^\d{4}-\d{2}$/.test(startMonth ?? '') || !/^\d{4}-\d{2}$/.test(cycleStart ?? '') || !(Number(every) >= 1)) {
  console.error('Uso: node scripts/fix-fixed-expense-cycle.mjs <idGasto> <mesInicio yyyy-MM> <mesDeUnaFactura yyyy-MM> <cadaNMeses> [--apply]')
  process.exit(1)
}

const DB = 'projects/personalhome-3ee06/databases/(default)'
const configPath = resolve(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
if (!existsSync(configPath)) throw new Error('No hay sesión de Firebase CLI. Ejecuta "firebase login".')
const token = JSON.parse(readFileSync(configPath, 'utf8')).tokens?.access_token
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const name = `${DB}/documents/fixedExpenses/${id}`

const res = await fetch(`https://firestore.googleapis.com/v1/${name}`, { headers })
const doc = await res.json()
if (doc.error) throw new Error(`Firestore [${doc.error.code}]: ${doc.error.message}`)
const f = doc.fields ?? {}
const show = (v) => (v?.stringValue ?? v?.integerValue ?? (v?.arrayValue ? `${v.arrayValue.values?.length ?? 0} revisión(es)` : v === undefined ? '(sin valor)' : JSON.stringify(v)))

console.log(`Gasto: ${f.concept?.stringValue} (usuario ${f.userId?.stringValue})`)
console.log(`  startMonth : ${show(f.startMonth)}  →  ${startMonth}`)
console.log(`  cycleStart : ${show(f.cycleStart)}  →  ${cycleStart}`)
console.log(`  everyMonths: ${show(f.everyMonths)}  →  ${every}`)
console.log(`  history    : ${show(f.history)}  →  (se borra)`)

if (!APPLY) {
  console.log('\nSimulación: no se escribió nada. Agrega --apply para aplicar el cambio.')
  process.exit(0)
}

const out = await fetch(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    writes: [{
      update: { name, fields: { startMonth: { stringValue: startMonth }, cycleStart: { stringValue: cycleStart }, everyMonths: { integerValue: String(Number(every)) } } },
      updateMask: { fieldPaths: ['startMonth', 'cycleStart', 'everyMonths', 'history'] },
    }],
  }),
})
const body = await out.json()
if (body.error) throw new Error(`Firestore [${body.error.code}]: ${body.error.message}`)
console.log('\n✓ Ciclo corregido.')
