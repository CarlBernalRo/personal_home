/**
 * Fills each household's `memberPhotos` with the Google profile photo of every member whose profile has one.
 * A household only stored the photo of whoever created it or joined through the app at that moment; the
 * others were drawn with their initials. Photos already stored are not replaced.
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would change;
 * nothing is written until you pass --apply.
 *
 * Run with:
 *   node scripts/sync-household-photos.mjs           (dry run)
 *   node scripts/sync-household-photos.mjs --apply   (writes)
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

const photoOf = new Map()
for (const u of await all('users')) {
  const url = u.fields?.photoURL?.stringValue
  if (url) photoOf.set(u.name.split('/').pop(), url)
}

const writes = []
for (const h of await all('households')) {
  const members = (h.fields?.members?.arrayValue?.values ?? []).map((v) => v.stringValue)
  const current = h.fields?.memberPhotos?.mapValue?.fields ?? {}
  const merged = { ...current }
  let changed = 0
  for (const uid of members) {
    if (current[uid]?.stringValue) continue // already has its photo
    const url = photoOf.get(uid)
    if (!url) continue
    merged[uid] = { stringValue: url }
    changed++
    console.log(`  · ${h.fields?.name?.stringValue}: foto de ${uid.slice(0, 5)}…`)
  }
  if (changed > 0) writes.push({ update: { name: h.name, fields: { memberPhotos: { mapValue: { fields: merged } } } }, updateMask: { fieldPaths: ['memberPhotos'] } })
}

if (writes.length === 0) { console.log('Nada que completar.'); process.exit(0) }
if (!APPLY) { console.log(`\nSimulación: ${writes.length} hogar(es) se actualizarían. Agrega --apply para escribirlos.`); process.exit(0) }
await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) })
console.log(`\n✓ ${writes.length} hogar(es) actualizados.`)
