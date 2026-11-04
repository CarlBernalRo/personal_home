/**
 * Builds the Telegram message of each kind of notice, with the detail that is worth having at hand: amounts and dates,
 * which account pays and whether it has the money, how far a budget went, who owes what in a household…
 *
 * What it uses from Telegram: HTML text (bold, italic, code), quote blocks (collapsible when long), a progress bar made
 * of block characters, buttons that open the exact screen of the app, a "marcar como leída" button that calls back to
 * the bot, and silent delivery for what is only informative (only warnings, critical notices and payments to confirm
 * make the phone ring).
 *
 * Every number comes from the live data, not from the text the app saved when the notice was created, so a notice that
 * waited a few minutes still says what is true now. If anything fails, the plain version of the notice is sent.
 */
import {
  FIXED_EXPENSE_CATEGORIES, creditorOf, isAutoDebit, isPendingDebt, owedByCreditor, relativeDay, remainingOf,
} from '../../../apps/web/src/shared/index'
import { bogotaToday, fixedFor, households } from './commands'
import type { Db, Doc } from './db'
import type { Keyboard } from './telegram'

export interface Msg { text: string; keyboard: Keyboard; silent: boolean }
export interface FormatDeps { db: Db; appUrl: string; now: number }

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────────────────
export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const cop = (n: number) => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CO', { ...o, timeZone: 'UTC' }).format(d)
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** "mié 6 nov" for a calendar date held as UTC midnight (the Colombia frame the shared code works in). */
export const dayShort = (d: Date) => `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
export const dayLong = (d: Date) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
/** A bar of 10 blocks: ▰▰▰▰▱▱▱▱▱▱ */
export const bar = (ratio: number) => { const n = Math.max(0, Math.min(10, Math.round(ratio * 10))); return '▰'.repeat(n) + '▱'.repeat(10 - n) }
/** A block of lines as a quote; long ones start collapsed so the message stays short. */
const quote = (lines: string[]) => `<blockquote${lines.length > 4 ? ' expandable' : ''}>${lines.join('\n')}</blockquote>`
const rule = '━━━━━━━━━━━━━━'

const ZONE = {
  sueldo: { icon: '💼', label: 'Sueldo' },
  fijos: { icon: '📅', label: 'Gastos fijos' },
  gastos: { icon: '🛒', label: 'Gastos' },
  hogar: { icon: '🏠', label: 'Hogar' },
} as const
const SEVERITY = { critical: '🔴', warning: '🟠', info: '🔵', success: '🟢' } as const
const zoneOf = (z: unknown) => ZONE[z as keyof typeof ZONE] ?? { icon: '🔔', label: 'Aviso' }
const sevOf = (s: unknown) => SEVERITY[s as keyof typeof SEVERITY] ?? '🔵'

/** What the person already has loaded for this run: each thing is read once, and only if a notice needs it. */
class Ctx {
  private cache = new Map<string, Promise<any>>()
  readonly today: Date
  constructor(readonly d: FormatDeps, readonly user: Doc) { this.today = bogotaToday(d.now) }
  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, load())
    return this.cache.get(key)!
  }
  accounts = () => this.memo('accounts', async () => (await this.d.db.query('accounts', [{ field: 'userId', op: 'EQUAL', value: this.user.id }])).sort((a, b) => String(a.name).localeCompare(String(b.name))))
  fixed = () => this.memo('fixed', () => fixedFor(this.d.db, this.user.id, this.today))
  households = () => this.memo('households', () => households(this.d.db, this.user.id))
  pending = () => this.memo('pending', async () => (await this.d.db.query('pendingMovements', [{ field: 'userId', op: 'EQUAL', value: this.user.id }])).filter((p) => p.status === 'pending').sort((a, b) => a.createdAt - b.createdAt))
  /** The account a fixed expense is paid from: the one set on it, else the default one. */
  async accountFor(fe: Doc) {
    const accounts = await this.accounts()
    return accounts.find((a) => a.id === fe.accountId) ?? accounts.find((a) => a.isDefault) ?? null
  }
  async entry(feId: string, hostMonth: string) {
    const { entries, next } = await this.fixed()
    return [...entries, ...next].find((e) => (e.fe as any).id === feId && e.hostMonth === hostMonth) ?? null
  }
}

const url = (d: FormatDeps, path?: string) => `${d.appUrl}${path ?? '/notificaciones'}`
/** Open the exact screen; for a single notice also a button to mark it read from the chat. */
function buttons(d: FormatDeps, path: string | undefined, label: string, noticeId?: string): Keyboard {
  const rows: Keyboard = [[{ text: `📲 ${label}`, url: url(d, path) }]]
  if (noticeId) rows.push([{ text: '✓ Marcar como leída', data: `n:r:${noticeId}` }])
  return rows
}
const header = (n: Doc, title = n.title) => `${sevOf(n.severity)} <b>${esc(title)}</b>\n<i>${zoneOf(n.zone).icon} ${zoneOf(n.zone).label}</i>`

// ── fixed expenses ───────────────────────────────────────────────────────────────────────────────────────────────

/** "Saldo 4.568.154 → quedarían 4.466.154 ✅" for an account that has to pay `amount`. */
function balanceLine(acc: Doc, amount: number) {
  const after = (acc.balance ?? 0) - amount
  return `🏦 <b>${esc(acc.name)}</b> · saldo ${cop(acc.balance ?? 0)} → quedarían ${cop(after)} ${after >= 0 ? '✅' : '⚠️'}`
}

async function fixedSoon(c: Ctx, n: Doc, feId: string, hostMonth: string): Promise<Msg> {
  const e = await c.entry(feId, hostMonth)
  if (!e) throw new Error('entry not found')
  const fe = e.fe as any
  const acc = await c.accountFor(fe)
  const category = FIXED_EXPENSE_CATEGORIES.find((x) => x.id === fe.category)?.label
  const auto = isAutoDebit(fe, hostMonth)
  const lines = [
    header(n, `${fe.concept} vence ${e.due ? relativeDay(e.due, c.today) : 'pronto'}`),
    rule,
    `💵 <b>${cop(e.total)}</b>${e.due ? `   📅 ${dayShort(e.due)}` : ''}`,
  ]
  if (category) lines.push(`📂 ${esc(category)}${fe.everyMonths > 1 ? ` · cada ${fe.everyMonths} meses` : ' · mensual'}${fe.isVariable ? ' · monto variable' : ''}`)
  if (acc) lines.push(balanceLine(acc, e.total))
  lines.push(auto ? '\n🤖 <i>Se debita automáticamente ese día si la cuenta tiene el saldo.</i>' : '\n🕐 <i>No es automático: recuerda pagarlo.</i>')
  if (fe.notes) lines.push(`\n📝 <i>${esc(String(fe.notes).slice(0, 160))}</i>`)
  return { text: lines.join('\n'), keyboard: buttons(c.d, '/fijos', 'Abrir Fijos', n.id), silent: false }
}

/** Several "vence pronto" notices of one run become one message. */
export async function fixedDigest(d: FormatDeps, user: Doc, notices: Doc[]): Promise<Msg> {
  const c = new Ctx(d, user)
  const rows: { fe: any; e: any; acc: Doc | null }[] = []
  for (const n of notices) {
    const [, feId, month] = String(n.derivedKey).split('|')
    const e = await c.entry(feId, month)
    if (e) rows.push({ fe: e.fe, e, acc: await c.accountFor(e.fe) })
  }
  if (rows.length < 2) throw new Error('not enough live entries')
  rows.sort((a, b) => (a.e.due?.getTime() ?? 0) - (b.e.due?.getTime() ?? 0))
  const total = rows.reduce((s, r) => s + r.e.total, 0)
  const lines = rows.map((r) => `• <b>${esc(r.fe.concept)}</b> — ${cop(r.e.total)}\n   ${r.e.due ? `${relativeDay(r.e.due, c.today)} (${dayShort(r.e.due)})` : 'sin fecha'}${isAutoDebit(r.fe, r.e.hostMonth) ? ' · 🤖 automático' : ''}`)
  const out = [`🟠 <b>${rows.length} pagos por vencer</b>\n<i>📅 Gastos fijos</i>`, rule, quote(lines), `\n💵 Total: <b>${cop(total)}</b>`]
  // what each account would be left with after paying what comes out of it
  const byAccount = new Map<string, { acc: Doc; amount: number }>()
  for (const r of rows) if (r.acc) byAccount.set(r.acc.id, { acc: r.acc, amount: (byAccount.get(r.acc.id)?.amount ?? 0) + r.e.total })
  for (const { acc, amount } of byAccount.values()) out.push(balanceLine(acc, amount))
  return { text: out.join('\n'), keyboard: buttons(d, '/fijos', 'Abrir Fijos'), silent: false }
}

async function fixedOverdue(c: Ctx, n: Doc, key: string): Promise<Msg> {
  const ids = key.split('|')[1].split(',').map((x) => x.split(':'))
  const rows: { fe: any; e: any }[] = []
  for (const [id, month] of ids) { const e = await c.entry(id, month); if (e) rows.push({ fe: e.fe, e }) }
  if (rows.length === 0) throw new Error('nothing overdue anymore')
  rows.sort((a, b) => (a.e.due?.getTime() ?? 0) - (b.e.due?.getTime() ?? 0))
  const total = rows.reduce((s, r) => s + r.e.total, 0)
  const lines = rows.map((r) => {
    const days = r.e.due ? Math.max(0, Math.round((c.today.getTime() - r.e.due.getTime()) / 86_400_000)) : 0
    const months = r.e.owed.length > 1 ? ` · ${r.e.owed.length} meses atrasados` : ''
    return `• <b>${esc(r.fe.concept)}</b> — ${cop(r.e.total)}\n   ${days > 0 ? `${days} día${days === 1 ? '' : 's'} de atraso` : 'vence hoy'}${months}`
  })
  const out = [`🔴 <b>${rows.length === 1 ? '1 pago vencido' : `${rows.length} pagos vencidos`}</b>\n<i>📅 Gastos fijos</i>`, rule, quote(lines), `\n💵 Por pagar: <b>${cop(total)}</b>`]
  const accounts = await c.accounts()
  const have = accounts.reduce((s, a) => s + (a.balance ?? 0), 0)
  if (accounts.length) out.push(`🏦 En tus cuentas: ${cop(have)} ${have >= total ? '✅ alcanza para ponerte al día' : `⚠️ faltan ${cop(total - have)}`}`)
  return { text: out.join('\n'), keyboard: buttons(c.d, '/fijos', 'Pagar en Fijos', n.id), silent: false }
}

// ── salary, budgets, spending ────────────────────────────────────────────────────────────────────────────────────

const firstAmount = (text: unknown) => { const m = String(text ?? '').match(/\$\s?([\d.]+)/); return m ? Number(m[1].replace(/\./g, '')) : null }

async function payDay(c: Ctx, n: Doc, key: string): Promise<Msg> {
  const amount = firstAmount(n.body)
  // the key holds the pay date as an instant of the person's clock (Colombia): move it into the calendar frame
  const date = new Date(Number(key.split('|')[1]) - 5 * 3600_000)
  const accounts = await c.accounts()
  const schedule = (c.user.paySchedule ?? {}) as any
  const acc = accounts.find((a) => a.id === schedule.accountId) ?? accounts.find((a) => a.isDefault) ?? null
  const lines = [header(n), rule, amount ? `💵 <b>${cop(amount)}</b>` : '', `📅 ${dayLong(date)}`]
  if (acc) lines.push(`🏦 Se deposita en <b>${esc(acc.name)}</b> (saldo ${cop(acc.balance ?? 0)})`)
  lines.push('\n<i>Confírmalo en la app para que actualice lo que te queda del período.</i>')
  return { text: lines.filter(Boolean).join('\n'), keyboard: buttons(c.d, '/', 'Confirmar sueldo', n.id), silent: true }
}

async function overBudget(c: Ctx, n: Doc): Promise<Msg> {
  const over = firstAmount(n.body)
  const { entries } = await c.fixed()
  const owed = entries.filter((e) => e.owed.length > 0).sort((a, b) => b.total - a.total)
  const accounts = await c.accounts()
  const lines = [header(n), rule, over ? `📉 Te pasas por <b>${cop(over)}</b> este período de sueldo.` : esc(n.body)]
  if (owed.length) {
    lines.push(`\n⏳ Todavía por pagar: <b>${cop(owed.reduce((s, e) => s + e.total, 0))}</b> en ${owed.length} gasto${owed.length === 1 ? '' : 's'}`)
    lines.push(quote(owed.slice(0, 5).map((e) => `• ${esc((e.fe as any).concept)} — ${cop(e.total)}${e.due ? ` (${dayShort(e.due)})` : ''}`).concat(owed.length > 5 ? [`… y ${owed.length - 5} más`] : [])))
  }
  if (accounts.length) lines.push(`🏦 En tus cuentas: ${cop(accounts.reduce((s, a) => s + (a.balance ?? 0), 0))}`)
  return { text: lines.join('\n'), keyboard: buttons(c.d, '/fijos', 'Revisar gastos', n.id), silent: false }
}

async function budgetOver(c: Ctx, n: Doc, key: string): Promise<Msg> {
  const [, budgetId, startMs] = key.split('|')
  const budget = ((c.user.variableBudgets ?? []) as any[]).find((b) => b?.id === budgetId)
  if (!budget) throw new Error('budget not found')
  const start = Number(startMs)
  const spends = (await c.d.db.query('expenses', [{ field: 'userId', op: 'EQUAL', value: c.user.id }, { field: 'variableBudgetId', op: 'EQUAL', value: budgetId }]))
    .filter((s) => s.date.getTime() >= start).sort((a, b) => b.date.getTime() - a.date.getTime())
  const spent = spends.reduce((s, x) => s + (x.amount ?? 0), 0)
  const ratio = budget.amount > 0 ? spent / budget.amount : 0
  const lines = [
    header(n), rule,
    `<code>${bar(ratio)}</code> <b>${Math.round(ratio * 100)}%</b>`,
    `💸 Llevas <b>${cop(spent)}</b> de ${cop(budget.amount)} estimados`,
    `📈 Te pasaste por <b>${cop(spent - budget.amount)}</b>`,
  ]
  if (spends.length) lines.push(`\n🧾 Últimos gastos:`, quote(spends.slice(0, 4).map((s) => `• ${esc(s.description || budget.concept)} — ${cop(s.amount)} (${dayShort(new Date(s.date.getTime() - 5 * 3600_000))})`)))
  return { text: lines.join('\n'), keyboard: buttons(c.d, '/fijos?tab=config', 'Ver gastos ocasionales', n.id), silent: false }
}

const KIND_ICON: Record<string, string> = { income: '💰', fixed: '📌', occasional: '🛒', abono: '🏠' }
const KIND_NAME: Record<string, string> = { income: 'Ingreso', fixed: 'Gasto fijo', occasional: 'Gasto adicional', abono: 'Abono al hogar' }

async function pendingMovements(c: Ctx, n: Doc): Promise<Msg> {
  const pending = await c.pending()
  if (pending.length === 0) throw new Error('nothing pending anymore')
  const income = pending.filter((p) => p.kind === 'income').reduce((s, p) => s + p.amount, 0)
  const out = pending.filter((p) => p.kind !== 'income').reduce((s, p) => s + p.amount, 0)
  const lines = pending.slice(0, 8).map((p) => `${KIND_ICON[p.kind] ?? '•'} <b>${esc(p.concept || KIND_NAME[p.kind])}</b> — ${cop(p.amount)}\n   ${KIND_NAME[p.kind] ?? p.kind} · ${dayShort(new Date(p.date.getTime() - 5 * 3600_000))}${p.attachmentId ? ' · 📎' : ''}`)
  if (pending.length > 8) lines.push(`… y ${pending.length - 8} más`)
  const totals = [income ? `+${cop(income)} en ingresos` : '', out ? `-${cop(out)} en gastos` : ''].filter(Boolean).join(' · ')
  const title = pending.length === 1 ? 'Tienes 1 movimiento por confirmar' : `Tienes ${pending.length} movimientos por confirmar`
  return {
    text: [header(n, title), rule, quote(lines), totals ? `\n💵 ${totals}` : '', '<i>Nada se registra hasta que lo confirmes en la app.</i>'].filter(Boolean).join('\n'),
    keyboard: buttons(c.d, '/pendientes', 'Revisar y confirmar', n.id), silent: true,
  }
}

// ── household ────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Tu situación en Casa: debes $X a A · te deben $Y" for the household a notice points at. */
async function householdStanding(c: Ctx, householdId: string): Promise<string | null> {
  const hh = (await c.households()).find((x) => x.h.id === householdId)
  if (!hh) return null
  const iOwe = owedByCreditor(hh.debts as any[], c.user.id, hh.members).filter((l) => l.owed > 0)
  const theyOwe = hh.members.filter((m) => m !== c.user.id)
    .map((m) => ({ m, owed: owedByCreditor(hh.debts as any[], m, hh.members).filter((l) => l.creditor === c.user.id).reduce((s, l) => s + l.owed, 0) })).filter((x) => x.owed > 0)
  const parts = [
    ...iOwe.map((l) => `debes <b>${cop(l.owed)}</b> a ${esc(hh.name(l.creditor))}`),
    ...theyOwe.map((x) => `${esc(hh.name(x.m))} te debe <b>${cop(x.owed)}</b>`),
  ]
  return `📊 <b>${esc(hh.h.name)}</b>: ${parts.length ? parts.join(' · ') : 'estás al día con todos ✅'}`
}

async function householdDebt(c: Ctx, n: Doc, key: string): Promise<Msg> {
  const debtId = key.split('|')[1]
  const debt = await c.d.db.get(`householdDebts/${debtId}`)
  if (!debt) throw new Error('debt not found')
  const hh = (await c.households()).find((x) => x.h.id === debt.householdId)
  if (!hh) throw new Error('household not found')
  const withPaid = (hh.debts as any[]).find((x) => x.id === debtId) ?? debt
  const left = remainingOf(withPaid)
  if (left <= 0) throw new Error('already settled')
  const paid = (withPaid.paidAbono ?? 0) + (withPaid.crossedAmount ?? 0)
  const creditor = creditorOf(withPaid, hh.members)
  const due = debt.dueDate instanceof Date ? new Date(debt.dueDate.getTime() - 5 * 3600_000) : null
  const lines = [
    header(n), rule,
    `📝 <b>${esc(debt.concept || 'Deuda')}</b> · ${esc(hh.h.name)}`,
    `<code>${bar(withPaid.amount ? paid / withPaid.amount : 0)}</code> ${withPaid.amount ? Math.round((paid / withPaid.amount) * 100) : 0}% pagado`,
    `💵 Falta <b>${cop(left)}</b> de ${cop(withPaid.amount)}${paid ? ` (abonado ${cop(paid)})` : ''}`,
  ]
  if (creditor) lines.push(`🙋 Se le debe a <b>${esc(hh.name(creditor))}</b>`)
  if (due) lines.push(`📅 Vence ${dayShort(due)} · ${relativeDay(due, c.today)}`)
  return { text: lines.join('\n'), keyboard: buttons(c.d, n.link, 'Abrir Hogar', n.id), silent: false }
}

async function receipt(c: Ctx, n: Doc): Promise<Msg> {
  const r = n.receipt
  const lines = [`💰 <b>${esc(n.title)}</b>\n<i>🏠 Hogar · ${dayShort(new Date(new Date(r.date).getTime() - 5 * 3600_000))}</i>`, rule, `💵 <b>${cop(r.amount)}</b> de ${esc(r.fromName)}`]
  if (Array.isArray(r.lines) && r.lines.length) lines.push(`\n🧾 Por estos conceptos:`, quote(r.lines.map((l: any) => `• ${esc(l.concept)} — ${cop(l.amount)}`)))
  const accounts = await c.accounts()
  if (accounts.length) lines.push(`\n🏦 Confirma en cuál cuenta lo recibiste: ${accounts.slice(0, 4).map((a) => esc(a.name)).join(' · ')}`)
  const standing = r.householdId ? await householdStanding(c, r.householdId).catch(() => null) : null
  if (standing) lines.push('', standing)
  return { text: lines.join('\n'), keyboard: buttons(c.d, n.link ?? '/notificaciones', 'Confirmar recibido', n.id), silent: false }
}

async function householdEvent(c: Ctx, n: Doc): Promise<Msg> {
  const householdId = String(n.link ?? '').match(/[?&]id=([^&]+)/)?.[1]
  const lines = [header(n), rule, esc(n.body)]
  const standing = householdId ? await householdStanding(c, householdId).catch(() => null) : null
  if (standing) lines.push('', standing)
  return { text: lines.join('\n'), keyboard: buttons(c.d, n.link ?? '/hogar', 'Abrir Hogar', n.id), silent: n.severity !== 'warning' && n.severity !== 'critical' }
}

function plainNotice(d: FormatDeps, n: Doc): Msg {
  return { text: `${header(n)}\n${rule}\n${esc(n.body)}`, keyboard: buttons(d, n.link, 'Abrir en la app', n.id), silent: n.severity === 'info' || n.severity === 'success' }
}

/**
 * The message for one notice. It never throws: when the live data cannot be read, or the situation already changed
 * (e.g. the debt was paid), it falls back to the plain version.
 */
export async function buildNotice(d: FormatDeps, user: Doc, n: Doc, ctx = new Ctx(d, user)): Promise<Msg> {
  try {
    const key = typeof n.derivedKey === 'string' ? n.derivedKey : ''
    if (key.startsWith('fx-soon|')) { const [, id, month] = key.split('|'); return await fixedSoon(ctx, n, id, month) }
    if (key.startsWith('fx-overdue|')) return await fixedOverdue(ctx, n, key)
    if (key.startsWith('pay|')) return await payDay(ctx, n, key)
    if (key.startsWith('over|')) return await overBudget(ctx, n)
    if (key.startsWith('vb|')) return await budgetOver(ctx, n, key)
    if (key.startsWith('hh|')) return await householdDebt(ctx, n, key)
    if (key.startsWith('pendmov|')) return await pendingMovements(ctx, n)
    if (n.receipt) return await receipt(ctx, n)
    if (n.zone === 'hogar') return await householdEvent(ctx, n)
  } catch (e) {
    console.error(`format ${n.derivedKey ?? n.title}:`, (e as Error)?.message)
  }
  return plainNotice(d, n)
}

export { Ctx }
