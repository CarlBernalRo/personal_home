/**
 * Daily job: stores, as real payments, the automatic debits that fell due, and lowers the balance of the
 * account each one came out of. The app does the same as soon as someone opens it; this makes it happen every
 * day whether or not anyone logs in. Both use `planAutoPayments`, so they decide exactly the same.
 *
 * Safe to run any number of times: every payment has a fixed id per expense and month and is created with
 * `create`, which fails when it already exists, so nothing is stored (or charged to an account) twice.
 *
 * Reads the service account from GOOGLE_APPLICATION_CREDENTIALS. By default it only LISTS what it would do;
 * pass --apply to write.
 *
 *   npx tsx scripts/ci/materialize-auto-debits.ts           (dry run)
 *   npx tsx scripts/ci/materialize-auto-debits.ts --apply   (writes)
 */

process.env.TZ ||= 'America/Bogota'

import * as admin from 'firebase-admin'
import { autoDebitFloor, planAutoPayments } from '../../apps/web/src/shared/utils/fixedExpenses'

const APPLY = process.argv.includes('--apply')

admin.initializeApp({ credential: admin.credential.applicationDefault() })
const db = admin.firestore()
const { FieldValue, Timestamp } = admin.firestore

/** A Firestore document as plain data: timestamps become Dates. */
function plain(doc: admin.firestore.QueryDocumentSnapshot) {
  const out: Record<string, any> = { id: doc.id }
  for (const [k, v] of Object.entries(doc.data())) out[k] = v instanceof Timestamp ? v.toDate() : v
  return out
}

async function main() {
  const today = new Date()
  console.log(`Fecha: ${today.toString()}  (${APPLY ? 'ESCRIBE' : 'simulación'})`)

  // only the expenses that have an automatic debit matter, and only their owners
  const expenses = (await db.collection('fixedExpenses').get()).docs.map(plain).filter((e) => Array.isArray(e.autoDebit) && e.autoDebit.length > 0 && e.active !== false)
  const users = [...new Set(expenses.map((e) => e.userId as string).filter(Boolean))]
  console.log(`${expenses.length} gasto(s) con débito automático, de ${users.length} usuario(s).`)

  let stored = 0
  let skipped = 0
  for (const userId of users) {
    // only the payments of the recent window matter (older months are never looked at); without the index, read them all
    const floor = autoDebitFloor(today)
    const recentPayments = () =>
      db.collection('fixedExpensePayments').where('userId', '==', userId).where('month', '>=', floor).get()
        .catch(() => db.collection('fixedExpensePayments').where('userId', '==', userId).get())
        .then((s) => s.docs.map(plain))
    const [payments, accounts] = await Promise.all([
      recentPayments(),
      db.collection('accounts').where('userId', '==', userId).get().then((s) => s.docs.map(plain)),
    ])
    const mine = (await db.collection('fixedExpenses').where('userId', '==', userId).get()).docs.map(plain)
    const plan = planAutoPayments(mine as any, payments as any, accounts as any, today, userId)

    for (const p of plan) {
      const where = `${userId.slice(0, 6)}… ${p.concept} ${p.month} (${p.paymentDate.toDateString()}) $${p.paidAmount} → cuenta ${p.accountId.slice(0, 6)}…`
      if (!APPLY) { console.log(`  · ${where}`); stored++; continue }
      const batch = db.batch()
      batch.create(db.collection('fixedExpensePayments').doc(p.docId), {
        fixedExpenseId: p.fixedExpenseId,
        userId: p.userId,
        concept: p.concept,
        paidAmount: p.paidAmount,
        accountId: p.accountId,
        month: p.month,
        paymentDate: Timestamp.fromDate(p.paymentDate),
        notes: '',
        auto: true,
        createdAt: FieldValue.serverTimestamp(),
      })
      batch.update(db.collection('accounts').doc(p.accountId), { balance: FieldValue.increment(-p.paidAmount) })
      try {
        await batch.commit()
        console.log(`  ✓ ${where}`)
        stored++
      } catch (e: any) {
        // already stored (by the app or an earlier run): nothing to do, and the account was not charged
        if (e?.code === 6 || /ALREADY_EXISTS/i.test(String(e?.message))) { skipped++; continue }
        throw e
      }
    }
  }
  console.log(`${APPLY ? 'Guardados' : 'Por guardar'}: ${stored}. Ya existían: ${skipped}.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
