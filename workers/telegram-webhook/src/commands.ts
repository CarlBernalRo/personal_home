/**
 * Read-only commands for the bot: /saldo, /proximos, /debo, /medeben, /resumen.
 * The numbers come from the app's own shared code (apps/web/src/shared), so the chat says what the screen says.
 */
import {
  indexPayments, monthEntries, monthKey, relativeDay, shiftMonth, withAutoPayments,
  owedByCreditor,
} from '../../../apps/web/src/shared/index'
import type { Db } from './db'

export const COMMANDS: { command: string; description: string }[] = [
  { command: 'saldo', description: 'Tus cuentas y cuánto tienes en cada una' },
  { command: 'proximos', description: 'Pagos que vencen en los próximos 7 días' },
  { command: 'debo', description: 'Lo que debes en tus hogares' },
  { command: 'medeben', description: 'Lo que te deben en tus hogares' },
  { command: 'resumen', description: 'Cómo vas este mes' },
  { command: 'cancelar', description: 'Cancelar el registro en curso' },
  { command: 'ayuda', description: 'Ver los comandos' },
]

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cop = (n: number) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

/** Today in Colombia (UTC-5) as a local-midnight Date, whatever the clock of the machine running this. */
export function bogotaToday(now = Date.now()): Date {
  const d = new Date(now - 5 * 3600_000)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export const HELP =
  '<b>Comandos</b>\n' + COMMANDS.filter((c) => c.command !== 'ayuda').map((c) => `/${c.command} — ${esc(c.description)}`).join('\n') +
  '\n\n📸 <b>Envíame una captura</b> de un pago o ingreso y te ayudo a registrarlo paso a paso. Queda pendiente: lo confirmas en la app. <i>La lectura corre dentro de tu cuenta de Cloudflare: la imagen no se envía a otras empresas.</i>' +
  '\n\nTambién recibes aquí tus avisos de la app. /stop para dejar de recibirlos.'

// ── /saldo ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function saldo(db: Db, uid: string) {
  const accounts = (await db.query('accounts', [{ field: 'userId', op: 'EQUAL', value: uid }])).sort((a, b) => b.balance - a.balance)
  if (accounts.length === 0) return 'Aún no tienes cuentas. Se crean en Finanzas, dentro de la app.'
  const total = accounts.reduce((s, a) => s + (a.balance || 0), 0)
  return `<b>💰 Tus cuentas</b>\n${accounts.map((a) => `• ${esc(a.name)}: <b>${cop(a.balance || 0)}</b>`).join('\n')}\n\n<b>Total: ${cop(total)}</b>`
}

// ── fixed expenses (shared by /proximos and /resumen) ───────────────────────────────────────────────────────────
export async function fixedFor(db: Db, uid: string, today: Date) {
  const [all, payments] = await Promise.all([
    db.query('fixedExpenses', [{ field: 'userId', op: 'EQUAL', value: uid }]),
    db.query('fixedExpensePayments', [{ field: 'userId', op: 'EQUAL', value: uid }]),
  ])
  const expenses = all.filter((e) => e.active !== false) as any[]
  const index = indexPayments(withAutoPayments(expenses, payments as any[], today) as any[])
  const month = monthKey(today)
  return { month, entries: monthEntries(expenses, month, index as any, today), next: monthEntries(expenses, shiftMonth(month, 1), index as any, today) }
}

async function proximos(db: Db, uid: string, today: Date) {
  const { entries, next } = await fixedFor(db, uid, today)
  const horizon = new Date(today.getTime() + 7 * 86_400_000)
  const rows = [...entries, ...next]
    .filter((e) => e.owed.length > 0 && (!e.due || e.due <= horizon))
    .sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0))
  if (rows.length === 0) return '✅ No tienes pagos pendientes en los próximos 7 días.'
  const icon = (s: string) => (s === 'overdue' ? '🔴' : s === 'due-soon' ? '🟠' : '🔵')
  const total = rows.reduce((s, e) => s + e.total, 0)
  const lines = rows.map((e) => `${icon(e.status)} ${esc((e.fe as any).concept)} · <b>${cop(e.total)}</b>${e.due ? ` · ${relativeDay(e.due, today)}` : ''}${e.arrears.length ? ' · incluye meses atrasados' : ''}`)
  return `<b>📅 Próximos 7 días</b>\n${lines.join('\n')}\n\n<b>Total: ${cop(total)}</b>`
}

// ── households ───────────────────────────────────────────────────────────────────────────────────────────────────
async function households(db: Db, uid: string) {
  const list = await db.query('households', [{ field: 'members', op: 'ARRAY_CONTAINS', value: uid }])
  return Promise.all(list.map(async (h) => {
    const raw = await db.query('householdDebts', [{ field: 'householdId', op: 'EQUAL', value: h.id }])
    // an abono is linked to its debt through saldaId: the debt's paid part is worked out from them (same as the app)
    const paid = new Map<string, number>()
    for (const d of raw) if (d.tipo === 'Abono' && d.saldaId) paid.set(d.saldaId, (paid.get(d.saldaId) || 0) + d.amount)
    const debts = raw.map((d) => (d.tipo === 'Deuda' ? { ...d, paidAbono: paid.get(d.id) || 0 } : d))
    const members: string[] = h.members ?? []
    const names: Record<string, string> = h.memberNames ?? {}
    return { h, debts, members, name: (u: string | null) => (u ? (u === uid ? 'ti' : names[u] || 'alguien') : 'alguien sin definir') }
  }))
}

async function debo(db: Db, uid: string) {
  const hhs = await households(db, uid)
  if (hhs.length === 0) return 'No perteneces a ningún hogar todavía.'
  let any = false
  const blocks = hhs.map(({ h, debts, members, name }) => {
    const lines = owedByCreditor(debts as any[], uid, members).filter((l) => l.owed > 0)
    if (lines.length === 0) return ''
    any = true
    return `<b>${esc(h.name)}</b>\n${lines.map((l) => `• a ${esc(name(l.creditor))}: <b>${cop(l.owed)}</b>`).join('\n')}`
  }).filter(Boolean)
  return any ? `<b>💸 Lo que debes</b>\n\n${blocks.join('\n\n')}` : '🎉 No debes nada en tus hogares.'
}

async function medeben(db: Db, uid: string) {
  const hhs = await households(db, uid)
  if (hhs.length === 0) return 'No perteneces a ningún hogar todavía.'
  let any = false
  const blocks = hhs.map(({ h, debts, members, name }) => {
    const lines = members.filter((m) => m !== uid)
      .map((m) => ({ who: m, owed: owedByCreditor(debts as any[], m, members).filter((l) => l.creditor === uid).reduce((s, l) => s + l.owed, 0) }))
      .filter((l) => l.owed > 0)
    if (lines.length === 0) return ''
    any = true
    return `<b>${esc(h.name)}</b>\n${lines.map((l) => `• ${esc(name(l.who))}: <b>${cop(l.owed)}</b>`).join('\n')}`
  }).filter(Boolean)
  return any ? `<b>🤝 Lo que te deben</b>\n\n${blocks.join('\n\n')}` : 'Nadie te debe nada por ahora.'
}

// ── /resumen ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function resumen(db: Db, uid: string, today: Date) {
  const [accounts, fixed, hhs] = await Promise.all([
    db.query('accounts', [{ field: 'userId', op: 'EQUAL', value: uid }]),
    fixedFor(db, uid, today),
    households(db, uid),
  ])
  const total = accounts.reduce((s, a) => s + (a.balance || 0), 0)
  const paid = fixed.entries.filter((e) => e.payment)
  const pending = fixed.entries.filter((e) => e.owed.length > 0)
  const overdue = pending.filter((e) => e.status === 'overdue')
  let owe = 0
  let owed = 0
  for (const { debts, members } of hhs) {
    owe += owedByCreditor(debts as any[], uid, members).reduce((s, l) => s + l.owed, 0)
    for (const m of members.filter((x) => x !== uid)) owed += owedByCreditor(debts as any[], m, members).filter((l) => l.creditor === uid).reduce((s, l) => s + l.owed, 0)
  }
  const month = today.toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return [
    `<b>📊 Resumen · ${esc(month)}</b>`,
    `💰 En cuentas: <b>${cop(total)}</b>`,
    `✅ Fijos pagados: ${paid.length} · ${cop(paid.reduce((s, e) => s + (e.payment?.paidAmount || 0), 0))}`,
    `⏳ Fijos por pagar: ${pending.length} · <b>${cop(pending.reduce((s, e) => s + e.total, 0))}</b>${overdue.length ? `\n🔴 Vencidos: ${overdue.length} · ${cop(overdue.reduce((s, e) => s + e.total, 0))}` : ''}`,
    hhs.length ? `💸 Debes: ${cop(owe)} · 🤝 Te deben: ${cop(owed)}` : '',
    `\nTras pagar lo pendiente te quedarían <b>${cop(total - pending.reduce((s, e) => s + e.total, 0))}</b> en cuentas.`,
  ].filter(Boolean).join('\n')
}

/** Answers one command for the user `uid`; null when the text is not one of ours. */
export async function runCommand(db: Db, uid: string, text: string, now = Date.now()): Promise<string | null> {
  const cmd = text.trim().split(/\s+/)[0].toLowerCase().replace(/^\//, '').replace(/@\w+$/, '')
  const today = bogotaToday(now)
  switch (cmd) {
    case 'saldo': return saldo(db, uid)
    case 'proximos': case 'próximos': return proximos(db, uid, today)
    case 'debo': return debo(db, uid)
    case 'medeben': case 'me_deben': return medeben(db, uid)
    case 'resumen': return resumen(db, uid, today)
    case 'ayuda': case 'help': return HELP
    default: return null
  }
}

