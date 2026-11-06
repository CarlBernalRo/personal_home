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
  FIXED_EXPENSE_CATEGORIES, creditorOf, effectiveDue, isAutoDebit, isPendingDebt, isScheduleUsable, latestPayDate, owedByCreditor, relativeDay, remainingOf,
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
export const quote = (lines: string[]) => `<blockquote${lines.length > 4 ? ' expandable' : ''}>${lines.join('\n')}</blockquote>`
export const rule = '━━━━━━━━━━━━━━'
/** Blurs a saldo on screen until the person taps it (Telegram's own "spoiler" entity). */
const spoiler = (s: string) => `<tg-spoiler>${s}</tg-spoiler>`

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
/**
 * Open the exact screen; for a single notice also a button to mark it read from the chat. Telegram caps
 * `callback_data` at 64 bytes: the stored id is usually `${userId}_${key}`, and the chat already knows who is
 * writing, so only the key travels. If even that does not fit (a long derived key, e.g. several overdue expenses
 * at once), the button is dropped rather than sent broken — Telegram rejects the whole message otherwise.
 */
function buttons(d: FormatDeps, path: string | undefined, label: string, n?: Doc): Keyboard {
  const rows: Keyboard = [[{ text: `📲 ${label}`, url: url(d, path) }]]
  if (n) {
    const prefix = `${n.userId}_`
    const key = n.id.startsWith(prefix) ? n.id.slice(prefix.length) : n.id
    const data = `n:r:${key}`
    if (new TextEncoder().encode(data).length <= 64) rows.push([{ text: '✓ Marcar como leída', data }])
  }
  return rows
}
const header = (n: Doc, title = n.title) => `${sevOf(n.severity)} <b>${esc(title)}</b>\n<i>${zoneOf(n.zone).icon} ${zoneOf(n.zone).label}</i>`

// ── fixed expenses ───────────────────────────────────────────────────────────────────────────────────────────────

/** "Saldo 4.568.154 → quedarían 4.466.154 ✅" for an account that has to pay `amount`. */
function balanceLine(acc: Doc, amount: number) {
  const after = (acc.balance ?? 0) - amount
  return `🏦 <b>${esc(acc.name)}</b> · saldo ${spoiler(cop(acc.balance ?? 0))} → quedarían ${spoiler(cop(after))} ${after >= 0 ? '✅' : '⚠️'}`
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
  // An automatic debit pays itself; a manual button here could double-register the same month
  const kb: Keyboard = auto ? [] : [[{ text: '✅ Marcar como pagado', data: `x:p:${feId}:${hostMonth}` }]]
  kb.push(...buttons(c.d, '/fijos', 'Abrir Fijos', n))
  return { text: lines.join('\n'), keyboard: kb, silent: false }
}

/**
 * EVERYTHING the person has left to do, in ONE message with no rules about days: payments (fixed ones overdue / coming up,
 * and what they owe in households), unread notifications, movements prepared in Telegram that wait for confirmation, and
 * the salary that arrived and is not confirmed yet. It is the daily message (8 a.m. Colombia) and the /pendientes command.
 * It throws NOTHING_PENDING when there is nothing at all.
 */
export const NOTHING_PENDING = 'nothing pending'

export async function pendingSummary(d: FormatDeps, user: Doc, ctx = new Ctx(d, user)): Promise<Msg> {
  const c = ctx
  const { entries } = await c.fixed()
  const dayDiff = (date: Date) => Math.round((date.getTime() - c.today.getTime()) / 86_400_000)
  const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
  const late = (n: number) => `${n} día${n === 1 ? '' : 's'} de atraso`
  const section = (title: string, count: number, rows: string[]) => [`\n<b>${title}</b>${count ? ` (${count})` : ''}`, quote(rows)]

  // ── PAGOS: fixed payments
  type Row = { text: string; amount: number; at: number }
  const before: Row[] = [], current: Row[] = [], upcoming: Row[] = []
  for (const e of entries) {
    const fe = e.fe as any
    for (const a of e.arrears) {
      const due = effectiveDue(fe, a.occMonth)
      const n = due ? -dayDiff(due) : 0
      before.push({ amount: a.amount, at: due?.getTime() ?? 0, text: `• <b>${esc(fe.concept)}</b> — ${cop(a.amount)}\n   ${monthName(a.occMonth)}${n > 0 ? ` · ${late(n)}` : ''}` })
    }
    const host = e.owed.filter((l) => !e.arrears.includes(l)).reduce((sum, l) => sum + l.amount, 0)
    if (host <= 0) continue
    const left = e.due ? dayDiff(e.due) : null
    const auto = isAutoDebit(fe, e.hostMonth) ? ' · 🤖 automático' : ''
    if (e.due && left! < 0) current.push({ amount: host, at: e.due.getTime(), text: `• <b>${esc(fe.concept)}</b> — ${cop(host)}\n   ${late(-left!)} (vencía ${dayShort(e.due)})` })
    else upcoming.push({ amount: host, at: e.due?.getTime() ?? Infinity, text: `• <b>${esc(fe.concept)}</b> — ${cop(host)}\n   ${e.due ? `${relativeDay(e.due, c.today)} (${dayShort(e.due)})` : 'sin fecha'}${auto}` })
  }
  for (const rows of [before, current, upcoming]) rows.sort((a, b) => a.at - b.at)
  const fixedTotal = [...before, ...current, ...upcoming].reduce((sum, r) => sum + r.amount, 0)

  // what the person owes in their households
  const owes: string[] = []
  for (const hh of await c.households()) {
    for (const l of owedByCreditor(hh.debts as any[], c.user.id, hh.members).filter((x) => x.owed > 0)) {
      owes.push(`• <b>${esc(hh.h.name)}</b>: debes ${cop(l.owed)} a ${esc(hh.name(l.creditor))}`)
    }
  }

  // ── NOTIFICACIONES: unread ones that are not already said in another section
  const covered = /^(fx-|pendmov\||pay\|)/
  const unread = (await c.d.db.query('notifications', [{ field: 'userId', op: 'EQUAL', value: c.user.id }]))
    .filter((n) => !n.read && !n.archived && !(typeof n.derivedKey === 'string' && covered.test(n.derivedKey)))
    .sort((a, b) => b.createdAt - a.createdAt)

  // ── PENDIENTES POR CONFIRMAR: movements prepared in Telegram
  const waiting = await c.pending()

  // ── CONFIRMACIÓN DE SALARIO: a pay day that arrived and was not confirmed
  let salaryLine = ''
  const schedule = (c.user.paySchedule ?? null) as any
  if (schedule && isScheduleUsable(schedule)) {
    const latest = latestPayDate(schedule, c.today)
    if (latest) {
      const salaries = (await c.d.db.query('incomes', [{ field: 'userId', op: 'EQUAL', value: c.user.id }])).filter((i) => i.kind === 'salary')
      const same = (a: Date, b: Date) => a.getUTCFullYear() === b.getFullYear() && a.getUTCMonth() === b.getMonth() && a.getUTCDate() === b.getDate()
      // incomes are stored at Colombia midnight (05:00Z): shift them into the same calendar frame as `latest`
      if (!salaries.some((s) => same(new Date(s.date.getTime() - 5 * 3600_000), latest.date))) {
        salaryLine = `• Sueldo de <b>${cop(latest.amount)}</b> del ${dayShort(latest.date)}: aún no lo has confirmado`
      }
    }
  }

  const nothing = before.length + current.length + upcoming.length + owes.length + unread.length + waiting.length === 0 && !salaryLine
  if (nothing) throw new Error(NOTHING_PENDING)

  const out: string[] = [`${before.length + current.length > 0 ? '🔴' : '🟡'} <b>Tus pendientes</b>\n<i>📋 Todo lo que te falta por hacer</i>`, rule]

  if (before.length + current.length + upcoming.length + owes.length > 0) {
    out.push('\n💳 <b>PAGOS</b>')
    if (before.length) out.push(...section('🔴 Vencidos de períodos anteriores', before.length, before.map((r) => r.text)))
    if (current.length) out.push(...section('🔴 Vencidos del período actual', current.length, current.map((r) => r.text)))
    if (upcoming.length) out.push(...section('🟡 Próximos a pagar', upcoming.length, upcoming.map((r) => r.text)))
    if (owes.length) out.push(...section('🏠 Deudas del hogar', owes.length, owes))
    if (fixedTotal > 0) {
      out.push(`\n💵 Gastos fijos por pagar: <b>${cop(fixedTotal)}</b>`)
      const accounts = await c.accounts()
      const have = accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0)
      if (accounts.length) out.push(`🏦 En tus cuentas: ${spoiler(cop(have))} ${have >= fixedTotal ? '✅ alcanza para todo' : `⚠️ faltan ${spoiler(cop(fixedTotal - have))}`}`)
    }
  }
  if (unread.length) {
    out.push('\n🔔 <b>NOTIFICACIONES</b>')
    out.push(...section('Sin leer', unread.length, unread.slice(0, 6).map((n) => `• ${zoneOf(n.zone).icon} ${esc(n.title)}`).concat(unread.length > 6 ? [`… y ${unread.length - 6} más`] : [])))
  }
  if (waiting.length) {
    out.push('\n📥 <b>PENDIENTES POR CONFIRMAR</b>')
    out.push(...section('Preparados desde Telegram', waiting.length, waiting.slice(0, 8).map((p) => `${KIND_ICON[p.kind] ?? '•'} <b>${esc(p.concept || KIND_NAME[p.kind])}</b> — ${cop(p.amount)}\n   ${KIND_NAME[p.kind] ?? p.kind} · ${dayShort(new Date(p.date.getTime() - 5 * 3600_000))}${p.attachmentId ? ' · 📎' : ''}`).concat(waiting.length > 8 ? [`… y ${waiting.length - 8} más`] : [])))
  }
  if (salaryLine) {
    out.push('\n💼 <b>CONFIRMACIÓN DE SALARIO</b>')
    out.push(quote([salaryLine]))
  }
  out.push('\n<i>Nada se registra hasta que lo confirmes en la app.</i>')

  // the button goes where the most pressing thing is
  const path = salaryLine && before.length + current.length + upcoming.length === 0 ? '/' : waiting.length && before.length + current.length === 0 ? '/pendientes' : '/fijos'
  return { text: out.join('\n'), keyboard: buttons(d, path, path === '/pendientes' ? 'Revisar y confirmar' : path === '/' ? 'Confirmar sueldo' : 'Abrir Fijos'), silent: false }
}

/** /pendientes: the same message, but when there is nothing it says so instead of staying quiet. */
export async function pendingSummaryNow(d: FormatDeps, user: Doc): Promise<Msg> {
  try {
    return await pendingSummary(d, user)
  } catch (e) {
    if ((e as Error)?.message !== NOTHING_PENDING) throw e
    return { text: '✅ <b>Estás al día</b>\nNo tienes pagos, notificaciones, movimientos por confirmar ni sueldo pendiente.', keyboard: buttons(d, '/', 'Abrir la app'), silent: true }
  }
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
  if (accounts.length) out.push(`🏦 En tus cuentas: ${spoiler(cop(have))} ${have >= total ? '✅ alcanza para ponerte al día' : `⚠️ faltan ${spoiler(cop(total - have))}`}`)
  // Only for the simple case (one expense, one owed month, not an automatic debit): several at once is ambiguous
  // for a single button, and an automatic debit pays itself.
  const kb: Keyboard = rows.length === 1 && rows[0].e.owed.length === 1 && !isAutoDebit(rows[0].fe, rows[0].e.hostMonth)
    ? [[{ text: '✅ Marcar como pagado', data: `x:p:${rows[0].fe.id}:${rows[0].e.hostMonth}` }]]
    : []
  kb.push(...buttons(c.d, '/fijos', 'Pagar en Fijos', n))
  return { text: out.join('\n'), keyboard: kb, silent: false }
}

// ── salary, budgets, spending ────────────────────────────────────────────────────────────────────────────────────

const firstAmount = (text: unknown) => { const m = String(text ?? '').match(/\$\s?([\d.]+)/); return m ? Number(m[1].replace(/\./g, '')) : null }

async function payDay(c: Ctx, n: Doc, key: string): Promise<Msg> {
  const amount = firstAmount(n.body)
  // the key holds the pay date as an instant of the person's clock (Colombia): move it into the calendar frame
  const date = new Date(Number(key.split('|')[1]) - 5 * 3600_000)
  const accounts = await c.accounts()
  const schedule = (c.user.paySchedule ?? null) as any
  const acc = accounts.find((a) => a.id === schedule?.accountId) ?? accounts.find((a) => a.isDefault) ?? accounts[0] ?? null
  const lines = [header(n), rule, amount ? `💵 <b>${cop(amount)}</b>` : '', `📅 ${dayLong(date)}`]
  if (acc) lines.push(`🏦 Se deposita en <b>${esc(acc.name)}</b> (saldo ${spoiler(cop(acc.balance ?? 0))})`)

  const kb: Keyboard = []
  // Recomputed fresh, worker-side, instead of trusting the key: a stale button (schedule changed, already confirmed)
  // then simply fails the live check when tapped, rather than silently registering the wrong day or amount.
  const latest = isScheduleUsable(schedule) ? latestPayDate(schedule, c.today) : null
  if (latest) {
    const ts = latest.date.getTime()
    lines.push('\n¿Ya te consignaron este sueldo?')
    kb.push(acc ? [{ text: `✅ Sí, en ${esc(acc.name)}`, data: `p:y:${ts}:${acc.id}` }] : [{ text: '✅ Sí, ya me pagaron', data: `p:y:${ts}:` }])
    kb.push([{ text: '✏️ Monto diferente', data: `p:e:${ts}:${acc?.id ?? ''}` }, { text: 'Aún no', data: `p:n:${ts}` }])
  } else {
    lines.push('\n<i>Confírmalo en la app para que actualice lo que te queda del período.</i>')
  }
  kb.push(...buttons(c.d, '/', 'Abrir en la app'))
  return { text: lines.filter(Boolean).join('\n'), keyboard: kb, silent: true }
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
  if (accounts.length) lines.push(`🏦 En tus cuentas: ${spoiler(cop(accounts.reduce((s, a) => s + (a.balance ?? 0), 0)))}`)
  return { text: lines.join('\n'), keyboard: buttons(c.d, '/fijos', 'Revisar gastos', n), silent: false }
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
  return { text: lines.join('\n'), keyboard: buttons(c.d, '/fijos?tab=config', 'Ver gastos ocasionales', n), silent: false }
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
    keyboard: buttons(c.d, '/pendientes', 'Revisar y confirmar', n), silent: true,
  }
}

/**
 * The reminder of what is waiting to be confirmed. It does not depend on a notice created by the app (those only exist
 * while the app is open): the Worker looks at the pending movements itself and sends this when they have been waiting.
 */
export const pendingReminder = (d: FormatDeps, user: Doc, ctx: Ctx): Promise<Msg> =>
  pendingMovements(ctx, { zone: 'gastos', severity: 'info', title: '' } as unknown as Doc)

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
  return { text: lines.join('\n'), keyboard: buttons(c.d, n.link, 'Abrir Hogar', n), silent: false }
}

async function receipt(c: Ctx, n: Doc): Promise<Msg> {
  const r = n.receipt
  const lines = [`💰 <b>${esc(n.title)}</b>\n<i>🏠 Hogar · ${dayShort(new Date(new Date(r.date).getTime() - 5 * 3600_000))}</i>`, rule, `💵 <b>${cop(r.amount)}</b> de ${esc(r.fromName)}`]
  if (Array.isArray(r.lines) && r.lines.length) lines.push(`\n🧾 Por estos conceptos:`, quote(r.lines.map((l: any) => `• ${esc(l.concept)} — ${cop(l.amount)}`)))
  const accounts = await c.accounts()
  if (accounts.length) lines.push(`\n🏦 Confirma en cuál cuenta lo recibiste: ${accounts.slice(0, 4).map((a) => esc(a.name)).join(' · ')}`)
  const standing = r.householdId ? await householdStanding(c, r.householdId).catch(() => null) : null
  if (standing) lines.push('', standing)
  return { text: lines.join('\n'), keyboard: buttons(c.d, n.link ?? '/notificaciones', 'Confirmar recibido', n), silent: false }
}

async function householdEvent(c: Ctx, n: Doc): Promise<Msg> {
  const householdId = String(n.link ?? '').match(/[?&]id=([^&]+)/)?.[1]
  const lines = [header(n), rule, esc(n.body)]
  const standing = householdId ? await householdStanding(c, householdId).catch(() => null) : null
  if (standing) lines.push('', standing)
  return { text: lines.join('\n'), keyboard: buttons(c.d, n.link ?? '/hogar', 'Abrir Hogar', n), silent: n.severity !== 'warning' && n.severity !== 'critical' }
}

function plainNotice(d: FormatDeps, n: Doc): Msg {
  return { text: `${header(n)}\n${rule}\n${esc(n.body)}`, keyboard: buttons(d, n.link, 'Abrir en la app', n), silent: n.severity === 'info' || n.severity === 'success' }
}

/**
 * The message for one notice. It never throws: when the live data cannot be read, or the situation already changed
 * (e.g. the debt was paid), it falls back to the plain version.
 */
export async function buildNotice(d: FormatDeps, user: Doc, n: Doc, ctx = new Ctx(d, user)): Promise<Msg> {
  try {
    const key = typeof n.derivedKey === 'string' ? n.derivedKey : ''
    if (key.startsWith('fx-soon|') || key.startsWith('fx-today|')) { const [, id, month] = key.split('|'); return await fixedSoon(ctx, n, id, month) }
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
