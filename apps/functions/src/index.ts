import { onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore'
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

// Recalculate household balance summary when an expense is created/updated/deleted
export const onHouseholdExpenseWritten = onDocumentWritten('householdExpenses/{expenseId}', async (event) => {
  const expense  = event.data?.after.exists ? event.data.after.data() : null
  const previous = event.data?.before.exists ? event.data.before.data() : null
  if (!expense && !previous) return

  const householdId = (expense ?? previous)?.householdId as string | undefined
  if (!householdId) return

  // Sum all expenses for this household this month
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const snap = await db.collection('householdExpenses')
    .where('householdId', '==', householdId)
    .where('date', '>=', admin.firestore.Timestamp.fromDate(monthStart))
    .get()

  const total = snap.docs.reduce((s, d) => s + (d.data().amount ?? 0), 0)

  await db.collection('households').doc(householdId).update({
    currentMonthTotal: total,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
})
