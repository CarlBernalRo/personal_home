/**
 * Moves what is already registered to the new, more descriptive categories: fixed expenses, additional
 * and occasional expenses, the occasional budgets (stored in each user's profile) and the households'
 * expenses and debts. The category is decided from the concept (rules below); a record whose concept
 * matches no rule keeps its category, except the old "otros" typo, which becomes "otro".
 *
 * Needs a Firebase CLI session ("firebase login"). By default it only LISTS what it would change;
 * nothing is written until you pass --apply.
 *
 * Run with:
 *   node scripts/recategorize.mjs           (dry run)
 *   node scripts/recategorize.mjs --apply   (writes)
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

async function all(collectionId) {
  const rows = await api(`${BASE}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }),
  })
  return rows.filter((r) => r.document).map((r) => r.document)
}

// ── Rules: the first one that matches the concept decides the category ───────

/** Day-to-day spends and occasional budgets (the "personal" categories). */
const PERSONAL_RULES = [
  [/^compra con llave/i, 'otro'],
  [/e-?shop|videojuego|steam|playstation|nintendo|xbox|\bjuego\b/i, 'videojuegos'],
  [/gasolina|\beds\b|combustible|peaje/i, 'combustible'],
  [/lavada|mec[aá]nic|taller|repuesto|soat|tecnomec|llanta|moto\b.*(mantenim|revisi)/i, 'vehiculo'],
  [/uber|taxi|didi|cabify|transmilenio|metro\b|pasaje|bus\b/i, 'transporte'],
  [/retiro|cajero/i, 'efectivo'],
  [/transferencia|cruce de cuentas|nequi|daviplata/i, 'transferencias'],
  [/cerveza|licor|trago|fiesta|cumplea[nñ]os|halloween|celebraci|reuni[oó]n/i, 'social'],
  [/cargador|celular|iphone|aud[ií]fono|computador|teclado|mouse|cable/i, 'tecnologia'],
  [/mueble|colch[oó]n|electrodom[eé]stic|decoraci/i, 'hogar'],
  [/pollo|mercado|supermercado|verdura|fruta|carne|huevo|leche/i, 'mercado'],
  [/tarjeta de cr[eé]dito|deuda|cr[eé]dito\b/i, 'deuda'],
  [/ropa|chaqueta|camisa|zapato|tenis|pantal[oó]n/i, 'ropa'],
  [/peluquer|barber|cosm[eé]tic|maquillaje/i, 'cuidado'],
  [/medic|farmacia|droguer[ií]a|odontol/i, 'salud'],
  [/internet|plan de datos|claro|movistar|tigo/i, 'comunicaciones'],
  [/netflix|spotify|youtube|claude|chatgpt|disney|hbo|prime video|suscrip/i, 'suscripciones'],
  [/colegio|universidad|curso|matr[ií]cula/i, 'educacion'],
]

/** Fixed expenses (the "fixed" categories). */
const FIXED_RULES = [
  [/claude|youtube|netflix|spotify|chatgpt|disney|hbo|prime video|suscrip/i, 'suscripciones'],
  [/internet|plan de datos|claro|movistar|tigo|telefon/i, 'comunicaciones'],
  [/administraci[oó]n/i, 'administracion'],
  [/seguro|funerari|previsi[oó]n|exequial/i, 'seguros'],
  [/prepagada|\beps\b|medicina|odontol/i, 'salud'],
  [/\bluz\b|\bagua\b|\bgas\b|energ[ií]a|acueducto|alcantarillado|\baseo\b/i, 'servicios'],
  [/arriendo|hipoteca|aporte apartamento/i, 'arriendo'],
  [/moto\b|carro|parqueadero|soat|gasolina/i, 'transporte'],
  [/ahorro/i, 'ahorro'],
  [/tarjeta|cr[eé]dito|\bcuota\b|deuda|pr[eé]stamo/i, 'deuda'],
  [/colegio|universidad|curso|matr[ií]cula/i, 'educacion'],
  [/impuesto|predial/i, 'impuestos'],
]

/** What the households share (the "household" categories). */
const HOUSEHOLD_RULES = [
  [/mueble|colch[oó]n|electrodom[eé]stic|decoraci/i, 'hogar'],
  [/e-?shop|videojuego|steam|playstation|nintendo|xbox|\bjuego\b/i, 'videojuegos'],
  [/chaqueta|ropa|camisa|zapato|tenis/i, 'ropa'],
  [/mercado|supermercado|verdura|fruta|carne/i, 'mercado'],
  [/almuerzo|cena|restaurante|comida/i, 'alimentacion'],
  [/uber|taxi|gasolina|peaje/i, 'transporte'],
]

const decide = (rules, concept, current) => {
  const hit = rules.find(([re]) => re.test(concept ?? ''))
  if (hit) return hit[1]
  return current === 'otros' ? 'otro' : current
}

const str = (d, k) => d.fields?.[k]?.stringValue

const writes = []
const report = (what, concept, from, to) => console.log(`  ${what.padEnd(22)} ${(concept ?? '').padEnd(36)} ${String(from).padEnd(16)} → ${to}`)

function plan(what, docs, rules, conceptField) {
  for (const d of docs) {
    const concept = str(d, conceptField)
    const from = str(d, 'category')
    const to = decide(rules, concept, from)
    if (to === from) continue
    report(what, concept, from, to)
    writes.push({ update: { name: d.name, fields: { category: { stringValue: to } } }, updateMask: { fieldPaths: ['category'] } })
  }
}

plan('gasto fijo', await all('fixedExpenses'), FIXED_RULES, 'concept')
plan('gasto adicional', await all('expenses'), PERSONAL_RULES, 'description')
plan('gasto del hogar', await all('householdExpenses'), HOUSEHOLD_RULES, 'description')
plan('deuda del hogar', await all('householdDebts'), HOUSEHOLD_RULES, 'concept')

// Occasional budgets live in an array inside each user's profile: the array is sent back whole
for (const user of await all('users')) {
  const list = user.fields?.variableBudgets?.arrayValue?.values
  if (!list?.length) continue
  let changed = false
  for (const item of list) {
    const f = item.mapValue?.fields
    if (!f) continue
    const from = f.category?.stringValue
    const concept = f.concept?.stringValue
    // the household-debt budget stands for debts, whatever its concept says
    const to = f.source?.stringValue === 'household-debt' ? 'deuda' : decide(PERSONAL_RULES, concept, from)
    if (to === from) continue
    report('gasto ocasional', concept, from, to)
    f.category = { stringValue: to }
    changed = true
  }
  if (changed) {
    writes.push({
      update: { name: user.name, fields: { variableBudgets: { arrayValue: { values: list } } } },
      updateMask: { fieldPaths: ['variableBudgets'] },
    })
  }
}

if (writes.length === 0) {
  console.log('Nada que reclasificar.')
  process.exit(0)
}
if (!APPLY) {
  console.log(`\nSimulación: ${writes.length} documento(s) cambiarían de categoría. Agrega --apply para escribirlos.`)
  process.exit(0)
}

for (let i = 0; i < writes.length; i += 400) {
  await api(`https://firestore.googleapis.com/v1/${DB}/documents:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
  })
}
console.log(`\n✓ ${writes.length} documento(s) reclasificados.`)
