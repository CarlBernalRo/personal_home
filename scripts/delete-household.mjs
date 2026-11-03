/**
 * Deletes a household and everything made in it: its debts and abonos, shared expenses, crossings, invitations and the
 * notifications that point to it; the household is also taken out of each member's profile (`householdIds`).
 * Lists what it would do unless --apply is passed. Refuses to run if the name matches more or less than one household.
 *
 *   node scripts/delete-household.mjs "Nombre exacto"           (dry run)
 *   node scripts/delete-household.mjs "Nombre exacto" --apply   (deletes)
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import os from 'os'

const name = process.argv[2]
const APPLY = process.argv.includes('--apply')
if (!name) throw new Error('Indica el nombre exacto del hogar.')
const token = JSON.parse(readFileSync(resolve(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8')).tokens?.access_token
const DB = 'projects/personalhome-3ee06/databases/(default)'
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const api = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await res.json()
  const err = Array.isArray(data) ? data.find((r) => r.error)?.error : data.error
  if (err) throw new Error(`Firestore [${err.code}]: ${err.message}`)
  return data
}
const all = async (c) => (await api(`https://firestore.googleapis.com/v1/${DB}/documents:runQuery`, { structuredQuery: { from: [{ collectionId: c }] } })).filter((r) => r.document).map((r) => r.document)
const str = (v) => v?.stringValue ?? ''
const idOf = (d) => d.name.split('/').pop()

const matches = (await all('households')).filter((h) => str(h.fields.name) === name)
if (matches.length !== 1) throw new Error(`Se esperaba 1 hogar llamado "${name}" y hay ${matches.length}.`)
const hh = matches[0]
const id = idOf(hh)
const members = (hh.fields.members?.arrayValue?.values ?? []).map((v) => v.stringValue)

const byHousehold = async (c) => (await all(c)).filter((d) => str(d.fields.householdId) === id)
const debts = await byHousehold('householdDebts')
const expenses = await byHousehold('householdExpenses')
const crossings = await byHousehold('householdCrossings')
const invites = await byHousehold('householdInvites')
const notices = (await all('notifications')).filter((n) => str(n.fields.link).includes(id))
// money an abono took from (or a confirmed payment put into) an account is NOT given back here: say so instead of guessing
const touchingAccounts = debts.filter((d) => str(d.fields.accountId) || str(d.fields.receivedAccountId))

console.log(`Hogar "${name}" (${id}); miembros: ${members.length}`)
console.log(`  deudas/abonos: ${debts.length} · gastos compartidos: ${expenses.length} · cruces: ${crossings.length} · invitaciones: ${invites.length} · avisos: ${notices.length}`)
console.log(`  registros que movieron una cuenta: ${touchingAccounts.length}`)
if (touchingAccounts.length) throw new Error('Hay abonos que movieron saldos de cuentas: revísalos antes de borrar.')

const profiles = (await all('users')).filter((u) => members.includes(idOf(u)))
const writes = []
for (const d of [...debts, ...expenses, ...crossings, ...invites, ...notices, hh]) writes.push({ delete: d.name })
for (const u of profiles) {
  const ids = (u.fields.householdIds?.arrayValue?.values ?? []).map((v) => v.stringValue).filter((x) => x !== id)
  writes.push({
    update: { name: u.name, fields: { householdIds: { arrayValue: { values: ids.map((x) => ({ stringValue: x })) } } } },
    updateMask: { fieldPaths: ['householdIds'] },
  })
  console.log(`  perfil ${idOf(u)}: householdIds → [${ids.join(', ')}]`)
}
if (!APPLY) { console.log('\nSimulación: no se borró nada. Agrega --apply.'); process.exit(0) }
for (let i = 0; i < writes.length; i += 400) {
  await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, { writes: writes.slice(i, i + 400) })
}
console.log(`\n✓ Hogar y ${writes.length - 1} registro(s) más procesados.`)
