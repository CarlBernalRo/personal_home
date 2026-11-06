/**
 * Short, button-driven actions that don't need the full step-by-step flow (that one lives in flow.ts, for
 * screenshots): confirming a salary day from its own notice. Like a screenshot, it only ever creates a
 * `pendingMovements` doc — nothing registers, and no balance moves, until the person confirms it inside the app.
 *
 * The only state that outlives one tap is "waiting for a typed amount" (the person picked "Monto diferente"),
 * kept in `telegramActions/{chatId}` — a much smaller sibling of `telegramFlows`.
 */
import { isScheduleUsable, latestPayDate } from '../../../apps/web/src/shared/index'
import { parseAmount } from './flow'
import { bogotaToday, fixedFor } from './commands'
import type { Db } from './db'
import type { Keyboard, Telegram } from './telegram'

export interface ActionDeps { db: Db; tg: Telegram; now?: () => number }
const clock = (d: ActionDeps) => (d.now ? d.now() : Date.now())

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cop = (n: number) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const dayLong = (d: Date) => `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`

const ACTION_TTL_MS = 2 * 3600_000 // waiting for a typed amount expires after 2h; the buttons above still work

const actionPath = (chatId: number) => `telegramActions/${chatId}`
interface PendingAction { kind: 'salary'; userId: string; chatId: number; ts: number; accountId: string | null; messageId: number; updatedAt: Date }

async function loadAction(d: ActionDeps, chatId: number): Promise<PendingAction | null> {
  const doc = await d.db.get(actionPath(chatId))
  if (!doc) return null
  const a = doc as unknown as PendingAction
  if (clock(d) - new Date(a.updatedAt).getTime() > ACTION_TTL_MS) { await d.db.remove(actionPath(chatId)).catch(() => {}); return null }
  return a
}

async function accountsOf(d: ActionDeps, uid: string) {
  return (await d.db.query('accounts', [{ field: 'userId', op: 'EQUAL', value: uid }])).sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** Creates the pending income; the person confirms it in the app, same as anything registered from a screenshot. */
async function createSalaryPending(d: ActionDeps, userId: string, date: Date, amount: number, accountId: string | null) {
  await d.db.add('pendingMovements', {
    userId,
    kind: 'income',
    isSalary: true,
    amount,
    // midnight in Colombia (UTC-5), like the dates the app writes
    date: new Date(date.getTime() + 5 * 3600_000),
    concept: 'Sueldo',
    ...(accountId ? { accountId } : {}),
    source: 'telegram',
    status: 'pending',
    createdAt: new Date(clock(d)),
  })
}

/** A pressed button on the salary-confirmation message (`p:y|e|n:<ts>:<accountId>`). */
export async function onActionCallback(d: ActionDeps, userId: string, cb: { id: string; chatId: number; messageId: number; data: string }): Promise<void> {
  const [, kind, tsStr, accIdRaw] = cb.data.split(':')
  const ts = Number(tsStr)
  const accId = accIdRaw || null

  if (kind === 'n') {
    await d.tg.answer(cb.id, 'Te lo recuerdo más tarde')
    await d.tg.edit(cb.chatId, cb.messageId, '🕐 Te lo recuerdo más tarde.', [])
    return
  }

  const user = await d.db.get(`users/${userId}`)
  const schedule = (user?.paySchedule ?? null) as any
  const today = bogotaToday(clock(d))
  const latest = isScheduleUsable(schedule) ? latestPayDate(schedule, today) : null
  // the button is only honored while it still matches today's pending pay day (not a stale tap on an old message)
  if (!latest || latest.date.getTime() !== ts) {
    await d.tg.answer(cb.id, 'Ese día de pago ya no está pendiente')
    await d.tg.edit(cb.chatId, cb.messageId, 'Ese día de pago ya no está pendiente.', [])
    return
  }
  // the account, if any, must still exist
  const accounts = await accountsOf(d, userId)
  const acc = accId ? accounts.find((a) => a.id === accId) ?? null : null

  if (kind === 'y') {
    await d.tg.answer(cb.id)
    await createSalaryPending(d, userId, latest.date, latest.amount, acc?.id ?? null)
    await d.tg.edit(
      cb.chatId, cb.messageId,
      `✅ <b>Enviado a la app.</b>\n💵 Sueldo de ${cop(latest.amount)} del ${dayLong(latest.date)}${acc ? ` en <b>${esc(acc.name)}</b>` : ''}.\nConfírmalo ahí para que quede registrado.`,
      [],
    )
    return
  }
  if (kind === 'e') {
    const action: PendingAction = { kind: 'salary', userId, chatId: cb.chatId, ts, accountId: acc?.id ?? null, messageId: cb.messageId, updatedAt: new Date(clock(d)) }
    await d.db.set(actionPath(cb.chatId), action as unknown as Record<string, unknown>)
    await d.tg.answer(cb.id)
    await d.tg.edit(cb.chatId, cb.messageId, '✏️ Escribe el monto que te pagaron (solo números, ej. 2850000).', [[{ text: '❌ Cancelar', data: `p:n:${ts}:` }]])
    return
  }
}

/** Typed text while a salary amount is pending. Returns false when there is nothing waiting for it. */
export async function onActionText(d: ActionDeps, userId: string, chatId: number, text: string): Promise<boolean> {
  const a = await loadAction(d, chatId)
  if (!a || a.userId !== userId) return false

  const user = await d.db.get(`users/${userId}`)
  const schedule = (user?.paySchedule ?? null) as any
  const today = bogotaToday(clock(d))
  const latest = isScheduleUsable(schedule) ? latestPayDate(schedule, today) : null
  if (!latest || latest.date.getTime() !== a.ts) {
    await d.db.remove(actionPath(chatId)).catch(() => {})
    await d.tg.send(chatId, 'Ese día de pago ya no está pendiente.')
    return true
  }

  const amount = parseAmount(text)
  if (!amount) {
    await d.tg.send(chatId, 'No entendí ese valor. Escríbelo solo con números, por ejemplo 2850000.')
    return true
  }
  await d.db.remove(actionPath(chatId)).catch(() => {})
  await createSalaryPending(d, userId, latest.date, amount, a.accountId)
  const acc = a.accountId ? (await accountsOf(d, userId)).find((x) => x.id === a.accountId) ?? null : null
  await d.tg.edit(
    chatId, a.messageId,
    `✅ <b>Enviado a la app.</b>\n💵 Sueldo de ${cop(amount)} del ${dayLong(latest.date)}${acc ? ` en <b>${esc(acc.name)}</b>` : ''}.\nConfírmalo ahí para que quede registrado.`,
    [],
  ).catch(() => d.tg.send(chatId, '✅ Enviado a la app. Confírmalo ahí para que quede registrado.'))
  return true
}

// ── "Marcar como pagado" on a fixed-expense notice ──────────────────────────────────────────────────────────────

async function liveFixedEntry(d: ActionDeps, uid: string, feId: string, month: string) {
  const today = bogotaToday(clock(d))
  const { entries, next } = await fixedFor(d.db, uid, today)
  return [...entries, ...next].find((e) => (e.fe as any).id === feId && e.hostMonth === month) ?? null
}

/** A pressed button on a fixed-expense notice (`x:p|a:<feId>:<month>:<accountId>`). */
export async function onPayFixedCallback(d: ActionDeps, userId: string, cb: { id: string; chatId: number; messageId: number; data: string }): Promise<void> {
  const [, kind, feId, month, accIdRaw] = cb.data.split(':')
  const entry = await liveFixedEntry(d, userId, feId, month)
  if (!entry || entry.owed.length === 0) {
    await d.tg.answer(cb.id, 'Ya no está pendiente')
    await d.tg.edit(cb.chatId, cb.messageId, 'Ese pago ya no está pendiente.', [])
    return
  }
  const fe = entry.fe as any

  if (kind === 'p') {
    const accounts = await accountsOf(d, userId)
    const kb: Keyboard = [
      ...accounts.map((a) => [{ text: a.name as string, data: `x:a:${feId}:${month}:${a.id}` }]),
      [{ text: 'Sin cuenta', data: `x:a:${feId}:${month}:` }],
    ]
    await d.tg.answer(cb.id)
    await d.tg.edit(cb.chatId, cb.messageId, `🏦 <b>${esc(fe.concept)}</b> · ${cop(entry.total)}\n¿De qué cuenta salió?`, kb)
    return
  }
  if (kind === 'a') {
    const accId = accIdRaw || null
    const accounts = await accountsOf(d, userId)
    const acc = accId ? accounts.find((x) => x.id === accId) ?? null : null
    await d.tg.answer(cb.id)
    await d.db.add('pendingMovements', {
      userId,
      kind: 'fixed',
      amount: entry.total,
      // paid today (Colombia midnight, like the app's own dates)
      date: new Date(bogotaToday(clock(d)).getTime() + 5 * 3600_000),
      concept: fe.concept,
      fixedExpenseId: feId,
      occMonth: month,
      ...(acc ? { accountId: acc.id } : {}),
      source: 'telegram',
      status: 'pending',
      createdAt: new Date(clock(d)),
    })
    await d.tg.edit(
      cb.chatId, cb.messageId,
      `✅ <b>Enviado a la app.</b>\n${esc(fe.concept)} · ${cop(entry.total)}${acc ? ` desde <b>${esc(acc.name)}</b>` : ''}.\nConfírmalo ahí para que quede registrado.`,
      [],
    )
    return
  }
}
