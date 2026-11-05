/**
 * The scheduled jobs the Worker runs by itself (Cloudflare Cron Triggers: they fire on the exact minute, unlike GitHub's
 * schedule, which may run hours late):
 *
 *  - sendTelegramAvisos: forwards the app's notifications that were not sent yet to each person's Telegram.
 *  - saveAutoDebits: stores, as real payments, the automatic debits that fell due, and lowers the balance of the
 *    account each one came out of (the app does the same when someone opens it; this makes it happen every day).
 *
 * Both are safe to run any number of times: a notification carries a Telegram status, and every debit has a fixed id per
 * expense and month that can only be created once, together with the balance change, in one all-or-nothing write.
 */
import { autoDebitFloor, planAutoPayments } from '../../../apps/web/src/shared/index'
import { bogotaToday } from './commands'
import type { Db, Doc } from './db'
import { Ctx, buildNotice, fixedDigest, pendingReminder, type FormatDeps, type Msg } from './format'
import type { Telegram } from './telegram'

export interface JobDeps {
  db: Db
  /** Clock in ms (injected for tests). */
  now?: () => number
}

const HOUR = 3600_000
const clock = (d: JobDeps) => (d.now ? d.now() : Date.now())

// ── Telegram notices ─────────────────────────────────────────────────────────────────────────────────────────────

/** Notices older than this are never sent: a late "vence mañana" is noise, and it keeps each run cheap to read. */
const NOTICE_WINDOW_MS = 48 * HOUR
const BOGOTA_HOURS = 5

export interface TelegramResult { users: number; sent: number; skipped: number }

export async function sendTelegramAvisos(d: JobDeps & { tg: Telegram; appUrl: string }, apply = true): Promise<TelegramResult> {
  const users = await d.db.query('users', [{ field: 'telegramChatId', op: 'GREATER_THAN', value: '' }])
  const out: TelegramResult = { users: users.length, sent: 0, skipped: 0 }
  if (users.length === 0) return out

  const since = new Date(clock(d) - NOTICE_WINDOW_MS)
  const recent = await d.db.query('notifications', [{ field: 'createdAt', op: 'GREATER_THAN_OR_EQUAL', value: since }])
  const mark = (id: string, status: 'sent' | 'skipped', messageId?: number) =>
    apply ? d.db.patch(`notifications/${id}`, { telegramStatus: status, ...(status === 'sent' ? { telegramSent: true } : {}), ...(messageId ? { telegramMessageId: messageId } : {}), telegramAt: new Date(clock(d)) }) : Promise.resolve()

  for (const u of users) {
    const zones: string[] | undefined = Array.isArray(u.telegramZones) ? u.telegramZones : undefined
    const fd: FormatDeps = { db: d.db, appUrl: d.appUrl, now: clock(d) }
    const ctx = new Ctx(fd, u)

    const waiting = (await ctx.pending()).length
    const pending = recent
      .filter((n) => n.userId === u.id && !n.telegramStatus && n.telegramSent !== true)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    // what really goes out: archived, switched-off zones and alerts that were solved while they waited are left out
    const toSend: Doc[] = []
    for (const n of pending) {
      let why = n.archived ? 'descartado' : zones && !zones.includes(n.zone) ? 'zona apagada' : ''
      if (!why && typeof n.derivedKey === 'string' && n.derivedKey.startsWith('pendmov|') && waiting === 0) why = 'ya no hay movimientos pendientes'
      if (why) { out.skipped++; await mark(n.id, 'skipped'); continue }
      toSend.push(n)
    }

    // several "vence pronto" of this run are one message (a list, the total and what each account would be left with)
    const soon = toSend.filter((n) => typeof n.derivedKey === 'string' && n.derivedKey.startsWith('fx-soon|'))
    const messages: { notices: Doc[]; build: () => Promise<Msg> }[] = []
    if (soon.length >= 2) messages.push({ notices: soon, build: () => fixedDigest(fd, u, soon) })
    for (const n of toSend) if (!(soon.length >= 2 && soon.includes(n))) messages.push({ notices: [n], build: () => buildNotice(fd, u, n, ctx) })

    for (const m of messages) {
      // a digest that cannot be built (the data changed) is sent notice by notice instead
      let msg: Msg
      try { msg = await m.build() } catch { msg = m.notices.length === 1 ? await buildNotice(fd, u, m.notices[0], ctx) : { text: '', keyboard: [], silent: false } }
      if (!msg.text) { for (const n of m.notices) await sendOne(n); continue }
      if (!apply) { out.sent += m.notices.length; continue }
      try {
        const id = await d.tg.send(Number(u.telegramChatId), msg.text, msg.keyboard, { silent: msg.silent })
        for (const n of m.notices) await mark(n.id, 'sent', id)
        out.sent += m.notices.length
      } catch (e: any) {
        console.error(`telegram ${u.id.slice(0, 6)}…: ${e?.message}`)
        // the person blocked the bot or deleted the chat: forget it instead of failing every run (the rest stay pending)
        if (/forbidden|blocked|chat not found|deactivated/i.test(String(e?.message))) { await d.db.patch(`users/${u.id}`, {}, ['telegramChatId', 'telegramLinkedAt']); break }
      }
    }

    // Reminder of what waits in Pendientes. The notice the app creates only exists while the app is open and its id repeats
    // for the same count, so it can never be trusted to arrive: the Worker looks at the pending movements itself.
    // At most once a day, in waking hours, for movements that have waited a while (not for one that was just sent).
    const hourNow = new Date(clock(d) - BOGOTA_HOURS * HOUR).getUTCHours()
    const waitingList = await ctx.pending()
    const oldest = waitingList[0]?.createdAt instanceof Date ? waitingList[0].createdAt.getTime() : clock(d)
    const lastReminder = u.pendingReminderAt instanceof Date ? u.pendingReminderAt.getTime() : 0
    const covered = toSend.some((n) => typeof n.derivedKey === 'string' && n.derivedKey.startsWith('pendmov|'))
    if (waitingList.length > 0 && !covered && (!zones || zones.includes('gastos'))
        && hourNow >= 8 && hourNow < 21
        && clock(d) - oldest >= 2 * HOUR && clock(d) - lastReminder >= 20 * HOUR) {
      try {
        const msg = await pendingReminder(fd, u, ctx)
        if (!apply) out.sent++
        else {
          await d.tg.send(Number(u.telegramChatId), msg.text, msg.keyboard, { silent: msg.silent })
          await d.db.patch(`users/${u.id}`, { pendingReminderAt: new Date(clock(d)) })
          out.sent++
        }
      } catch (e: any) { console.error(`reminder ${u.id.slice(0, 6)}…: ${e?.message}`) }
    }

    /** The digest could not be built: each of its notices goes alone. */
    async function sendOne(n: Doc) {
      const msg = await buildNotice(fd, u, n, ctx)
      if (!apply) { out.sent++; return }
      try { const id = await d.tg.send(Number(u.telegramChatId), msg.text, msg.keyboard, { silent: msg.silent }); await mark(n.id, 'sent', id); out.sent++ }
      catch (e: any) { console.error(`telegram ${u.id.slice(0, 6)}…: ${e?.message}`) }
    }
  }
  return out
}

// ── Automatic debits ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The shared planner reads dates with the machine's local getters. This Worker's clock is UTC, so everything is moved
 * into a "Colombia frame" (UTC-5): real instants are shifted back 5 h, so the planner sees the same calendar days a
 * computer in Bogotá would, and the dates it returns are moved forward again before they are stored.
 */
const BOGOTA_MS = 5 * HOUR
const toFrame = (v: unknown) => (v instanceof Date ? new Date(v.getTime() - BOGOTA_MS) : v)
const fromFrame = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5, 0, 0))

export interface PlannedDebit { docId: string; userId: string; concept: string; month: string; paidAmount: number; accountId: string; paymentDate: Date; fixedExpenseId: string }
export interface DebitsResult { planned: number; stored: number; skipped: number; items: string[] }

/** What would be stored right now, without writing anything (shared by the run and by the tests). */
export async function planAutoDebits(db: Db, nowMs: number): Promise<PlannedDebit[]> {
  const today = bogotaToday(nowMs)
  const everyExpense = await db.query('fixedExpenses')
  const withDebit = everyExpense.filter((e) => Array.isArray(e.autoDebit) && e.autoDebit.length > 0 && e.active !== false)
  const userIds = [...new Set(withDebit.map((e) => e.userId as string).filter(Boolean))]
  const floor = autoDebitFloor(today)
  const out: PlannedDebit[] = []

  for (const userId of userIds) {
    // only the payments of the recent window matter; without the index, read them all
    const payments = await db.query('fixedExpensePayments', [{ field: 'userId', op: 'EQUAL', value: userId }, { field: 'month', op: 'GREATER_THAN_OR_EQUAL', value: floor }])
      .catch(() => db.query('fixedExpensePayments', [{ field: 'userId', op: 'EQUAL', value: userId }]))
    const accounts = (await db.query('accounts', [{ field: 'userId', op: 'EQUAL', value: userId }]))
      .map((a) => ({ ...a, createdAt: toFrame(a.createdAt), balanceSetAt: toFrame(a.balanceSetAt) }))
    const mine = everyExpense.filter((e) => e.userId === userId).map((e) => ({ ...e, createdAt: toFrame(e.createdAt) }))
    for (const p of planAutoPayments(mine as any, payments as any, accounts as any, today, userId)) {
      out.push({ ...p, paymentDate: fromFrame(p.paymentDate) })
    }
  }
  return out
}

export async function saveAutoDebits(d: JobDeps, apply = true): Promise<DebitsResult> {
  const plan = await planAutoDebits(d.db, clock(d))
  const out: DebitsResult = { planned: plan.length, stored: 0, skipped: 0, items: [] }
  for (const p of plan) {
    const label = `${p.userId.slice(0, 6)}… ${p.concept} ${p.month} (${p.paymentDate.toISOString().slice(0, 10)}) $${p.paidAmount}`
    if (!apply) { out.items.push(label); out.stored++; continue }
    try {
      await d.db.batch([
        {
          create: `fixedExpensePayments/${p.docId}`,
          data: {
            fixedExpenseId: p.fixedExpenseId, userId: p.userId, concept: p.concept, paidAmount: p.paidAmount, accountId: p.accountId,
            month: p.month, paymentDate: p.paymentDate, notes: '', auto: true, createdAt: new Date(clock(d)),
          },
        },
        { increment: `accounts/${p.accountId}`, field: 'balance', by: -p.paidAmount },
      ])
      out.items.push(label)
      out.stored++
    } catch (e: any) {
      // already stored (by the app or an earlier run): nothing to do, and the account was not charged
      if (e?.status === 409) { out.skipped++; continue }
      throw e
    }
  }
  return out
}

export type JobName = 'telegram' | 'debits'
