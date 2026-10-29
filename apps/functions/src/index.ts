import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()

// When a household expense is deleted, clean up any related data
export const onHouseholdExpenseDeleted = functions.firestore
  .document('householdExpenses/{expenseId}')
  .onDelete(async (snap) => {
    // Placeholder for future cleanup logic
    functions.logger.info('Household expense deleted', { id: snap.id })
  })

// Recalculate household balance summary when an expense is created/updated
export const onHouseholdExpenseWritten = functions.firestore
  .document('householdExpenses/{expenseId}')
  .onWrite(async (change, context) => {
    const expense = change.after.exists ? change.after.data() : null
    const previous = change.before.exists ? change.before.data() : null

    if (!expense && !previous) return

    const householdId = (expense ?? previous)?.householdId
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
