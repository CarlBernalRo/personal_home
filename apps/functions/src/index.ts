import { onDocumentDeleted, onDocumentWritten, type FirestoreEvent, type Change, type DocumentSnapshot } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()

// When a household expense is deleted, clean up the debts it generated.
// Server-side safety net: the client already does this cascade on delete,
// but a doc removed any other way (console, another client) must not leave
// orphaned householdDebts behind.
export const onHouseholdExpenseDeleted = onDocumentDeleted('householdExpenses/{expenseId}', async (event) => {
  const expenseId = event.params.expenseId

  const linkedDebts = await db.collection('householdDebts')
    .where('expenseId', '==', expenseId)
    .get()

  if (linkedDebts.empty) return

  const batch = db.batch()
  linkedDebts.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()

  logger.info('Cleaned up debts for deleted household expense', {
    expenseId,
    debtsDeleted: linkedDebts.size,
  })
})

// ── Change signals, one per module ────────────────────────────────────────────────────────────────────────────────
//
// Instead of every screen (and the Telegram bot) keeping live listeners on whole collections — which re-reads the full
// history every time a listener starts again — each write here only stamps "this module changed" in a tiny per-user
// document, `sync/{uid}`: `{ v: { incomes: 1732..., fixed: ..., hh: { <householdId>: ... } } }`. The app listens to that
// one document and reads a module again only when its stamp moved (and from its local cache otherwise); the bot
// recomputes a person's notices only when one of their stamps moved. A stamp is a time in ms, compared only for change.
//
// Like a webhook's payload, the signal also says WHAT changed: `log[<key>][<document path>] = <ms>` (negative when the
// document was deleted), for the last few days. A screen that is open then reads just those documents instead of the
// whole module again; a deletion, or a gap older than the log, makes it read the module again.

type Written = FirestoreEvent<Change<DocumentSnapshot> | undefined, Record<string, string>>
const both = (e: Written) => [e.data?.before.exists ? e.data.before.data() ?? null : null, e.data?.after.exists ? e.data.after.data() ?? null : null] as const

/** How long the log of changed documents is kept (a screen away for longer reads its module again). */
const LOG_KEEP_MS = 7 * 86_400_000

/**
 * Stamps `keys` (or one household) as changed for each person (guests have no account and are skipped), and logs which
 * document it was. One small read and write per person, in a transaction so two changes at once both stay logged.
 */
async function bump(e: Written, uids: Iterable<unknown>, keys: string[], householdId?: string) {
  const people = [...new Set([...uids].filter((u): u is string => typeof u === 'string' && !!u && !u.startsWith('guest_')))]
  if (people.length === 0) return
  const path = e.document
  const deleted = !e.data?.after.exists
  const logKeys = householdId ? [`hh.${householdId}`] : keys
  await Promise.all(people.map((uid) => db.runTransaction(async (tx) => {
    const ref = db.doc(`sync/${uid}`)
    const cur = (await tx.get(ref)).data() ?? {}
    const t = Date.now()
    const v: Record<string, any> = { ...(cur.v ?? {}) }
    for (const k of keys) v[k] = t
    if (householdId) v.hh = { ...(v.hh ?? {}), [householdId]: t }
    const log: Record<string, Record<string, number>> = { ...(cur.log ?? {}) }
    for (const k of logKeys) {
      const kept = Object.entries(log[k] ?? {}).filter(([, at]) => Math.abs(at) > t - LOG_KEEP_MS)
      log[k] = Object.fromEntries([...kept, [path, deleted ? -t : t]])
    }
    tx.set(ref, { v, log })
  })))
}

/** The people of a document: its owner and whoever it is shared with, before and after the change. */
const ownersOf = (...docs: (admin.firestore.DocumentData | null)[]) =>
  docs.flatMap((d) => (d ? [d.userId, ...((d.sharedWith as unknown[] | undefined) ?? [])] : []))

/** A collection whose documents belong to `userId` (and its `sharedWith`). */
const personal = (path: string, key: string) => onDocumentWritten(path, async (e) => {
  const [before, after] = both(e)
  await bump(e, ownersOf(before, after), [key])
})

export const syncIncomes = personal('incomes/{id}', 'incomes')
export const syncExpenses = personal('expenses/{id}', 'expenses')
export const syncAccounts = personal('accounts/{id}', 'accounts')
export const syncFixed = personal('fixedExpenses/{id}', 'fixed')
export const syncFixedPayments = personal('fixedExpensePayments/{id}', 'fixedPayments')
export const syncPending = personal('pendingMovements/{id}', 'pending')
export const syncReminders = personal('reminders/{id}', 'reminders')

/** Notices: a change only of how it went out to Telegram is not something the app shows, so it is not signalled. */
const TELEGRAM_ONLY = new Set(['telegramStatus', 'telegramSent', 'telegramMessageId', 'telegramAt'])
export const syncNotifications = onDocumentWritten('notifications/{id}', async (e) => {
  const [before, after] = both(e)
  if (before && after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    const changed = [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    if (changed.every((k) => TELEGRAM_ONLY.has(k))) return
  }
  await bump(e, ownersOf(before, after), ['notifications'])
})

/** Everything of a household (its debts, expenses, crossings) changes the household for all its members. */
const householdPart = (path: string) => onDocumentWritten(path, async (e) => {
  const [before, after] = both(e)
  const householdId = (after?.householdId ?? before?.householdId) as string | undefined
  if (!householdId) return
  const hh = await db.doc(`households/${householdId}`).get()
  await bump(e, (hh.data()?.members as string[] | undefined) ?? [], ['households'], householdId)
})

export const syncHouseholdDebts = householdPart('householdDebts/{id}')
export const syncHouseholdExpenses = householdPart('householdExpenses/{id}')
export const syncHouseholdCrossings = householdPart('householdCrossings/{id}')

export const syncHouseholds = onDocumentWritten('households/{id}', async (e) => {
  const [before, after] = both(e)
  // whoever left is told too, so the household disappears from their screens
  await bump(e, [...((before?.members as string[] | undefined) ?? []), ...((after?.members as string[] | undefined) ?? [])], ['households'], e.params.id)
})

export const syncFamilies = onDocumentWritten('families/{id}', async (e) => {
  const [before, after] = both(e)
  const people = [before, after].flatMap((d) => (d ? [...((d.members as string[] | undefined) ?? []), ...Object.keys(d.requests ?? {}), ...Object.keys(d.rejected ?? {})] : []))
  await bump(e, people, ['family'])
})

/** The profile only matters to the others (and the bot) for what feeds the money figures and notices. */
const PROFILE_FIELDS = ['paySchedule', 'variableBudgets', 'householdIds', 'householdId', 'telegramZones', 'tags']
export const syncProfiles = onDocumentWritten('users/{uid}', async (e) => {
  const [before, after] = both(e)
  if (before && after && PROFILE_FIELDS.every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]))) return
  await bump(e, [e.params.uid], ['profile'])
})
