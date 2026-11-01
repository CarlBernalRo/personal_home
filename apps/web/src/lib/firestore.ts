import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, where, orderBy, Timestamp,
  serverTimestamp, setDoc, arrayUnion, arrayRemove, writeBatch, increment, deleteField,
} from 'firebase/firestore'
import { db } from './firebase'
import type {
  NewExpense, NewAccount, NewAccountTransfer, NewSavingsGoal,
  NewFixedExpense, NewFixedExpensePayment,
  NewIncome, NewHouseholdDebt, NewHouseholdExpense,
  CrossingAllocation, NewStoredNotification, NewHouseholdInvite,
} from '@/shared'
import { resolveExpenseShares, sharesToDebtors } from '@/shared'

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDate(ts: unknown): Date {
  if (ts instanceof Timestamp) return ts.toDate()
  if (ts instanceof Date)      return ts
  return new Date()
}

function mapDoc<T>(snap: { id: string; data(): Record<string, unknown> }): T {
  const data = snap.data()
  const out: Record<string, unknown> = { id: snap.id }
  for (const key of Object.keys(data)) {
    out[key] = data[key] instanceof Timestamp ? toDate(data[key]) : data[key]
  }
  return out as T
}

// ── User profile ─────────────────────────────────────────────────────────────

export async function getUserProfile(uid: string) {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return mapDoc<Record<string, unknown>>(snap)
}

export async function updateUserProfile(
  uid: string,
  data: { apodo?: string; [key: string]: unknown },
  householdId?: string,
) {
  await updateDoc(doc(db, 'users', uid), data)
  // Keep household memberNames in sync when apodo changes
  if (data.apodo !== undefined && householdId) {
    const hSnap = await getDoc(doc(db, 'households', householdId))
    if (hSnap.exists()) {
      const names = (hSnap.data().memberNames ?? {}) as Record<string, string>
      await updateDoc(hSnap.ref, { memberNames: { ...names, [uid]: data.apodo } })
    }
  }
}

// ── Variable Expenses ─────────────────────────────────────────────────────────

/** Registers a spend and, in the same write, lowers the balance of the account it came out of. */
export async function addExpense(expense: NewExpense) {
  const { accountId, ...rest } = expense
  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'expenses')), {
    ...rest,
    ...(accountId ? { accountId } : {}),
    date:      Timestamp.fromDate(expense.date),
    createdAt: serverTimestamp(),
  })
  if (accountId) batch.update(doc(db, 'accounts', accountId), { balance: increment(-expense.amount) })
  await batch.commit()
}

export async function getExpenses(userId: string) {
  const q = query(
    collection(db, 'expenses'),
    where('userId', '==', userId),
    orderBy('date', 'desc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

/**
 * Edits a spend and keeps the accounts right in the same write: when the amount changes the account it came
 * out of is charged the difference, and when the account changes the old one gets its money back and the new
 * one is charged.
 */
export async function updateExpense(
  id: string,
  next: { description: string; amount: number; category: string; date: Date; accountId?: string },
  prev: { amount: number; accountId?: string },
) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'expenses', id), {
    description: next.description,
    amount: next.amount,
    category: next.category,
    date: Timestamp.fromDate(next.date),
    accountId: next.accountId ? next.accountId : deleteField(),
  })
  // the previous account may have been deleted since: then there is nothing to give back
  const prevAccount = prev.accountId && (await getDoc(doc(db, 'accounts', prev.accountId))).exists() ? prev.accountId : undefined
  if (prevAccount && prevAccount === next.accountId) {
    if (prev.amount !== next.amount) batch.update(doc(db, 'accounts', prevAccount), { balance: increment(prev.amount - next.amount) })
  } else {
    if (prevAccount) batch.update(doc(db, 'accounts', prevAccount), { balance: increment(prev.amount) })
    if (next.accountId) batch.update(doc(db, 'accounts', next.accountId), { balance: increment(-next.amount) })
  }
  await batch.commit()
}

/** Deletes a spend; the account it came out of (when it still exists) gets that money back. */
export async function deleteExpense(id: string) {
  const ref = doc(db, 'expenses', id)
  const snap = await getDoc(ref)
  const accountId = snap.exists() ? (snap.data().accountId as string | undefined) : undefined
  const amount = snap.exists() ? (snap.data().amount as number) : 0
  if (!accountId || !(await getDoc(doc(db, 'accounts', accountId))).exists()) return deleteDoc(ref)
  const batch = writeBatch(db)
  batch.delete(ref)
  batch.update(doc(db, 'accounts', accountId), { balance: increment(amount) })
  await batch.commit()
}

// ── Fixed Expenses ────────────────────────────────────────────────────────────

export async function addFixedExpense(data: NewFixedExpense) {
  return addDoc(collection(db, 'fixedExpenses'), {
    ...data,
    createdAt: serverTimestamp(),
  })
}

export async function getFixedExpenses(userId: string) {
  const q = query(
    collection(db, 'fixedExpenses'),
    where('userId', '==', userId),
    where('active', '==', true),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

export async function updateFixedExpense(id: string, data: Partial<NewFixedExpense>) {
  return updateDoc(doc(db, 'fixedExpenses', id), data)
}

/** Deletes the expense's configuration. Payments already registered are kept: they are real money movements. */
export async function deleteFixedExpense(id: string) {
  return deleteDoc(doc(db, 'fixedExpenses', id))
}

// ── Fixed Expense Payments ────────────────────────────────────────────────────

export async function addFixedExpensePayment(data: NewFixedExpensePayment) {
  return addFixedExpensePayments([data])
}

/**
 * Registers payments and, in the same write, lowers the balance of the account each one came out of
 * (no account: nothing to lower). All or nothing, so a balance never drifts from its payments.
 */
export async function addFixedExpensePayments(items: NewFixedExpensePayment[]) {
  const batch = writeBatch(db)
  const spent = new Map<string, number>()
  for (const { accountId, ...rest } of items) {
    batch.set(doc(collection(db, 'fixedExpensePayments')), {
      ...rest,
      ...(accountId ? { accountId } : {}),
      paymentDate: Timestamp.fromDate(rest.paymentDate),
      createdAt:   serverTimestamp(),
    })
    if (accountId) spent.set(accountId, (spent.get(accountId) ?? 0) + rest.paidAmount)
  }
  spent.forEach((amount, id) => batch.update(doc(db, 'accounts', id), { balance: increment(-amount) }))
  await batch.commit()
}

export async function getFixedExpensePayments(userId: string, month: string) {
  const q = query(
    collection(db, 'fixedExpensePayments'),
    where('userId', '==', userId),
    where('month', '==', month),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

/** Every payment ever registered by the user, for history/timeline views. */
export async function getAllFixedExpensePayments(userId: string) {
  const q = query(collection(db, 'fixedExpensePayments'), where('userId', '==', userId))
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

/**
 * Stores the payments an automatic debit made by itself (they used to exist only on screen), lowering the
 * account each one came out of. The id is fixed per expense and month, so one occurrence is stored once.
 */
export async function materializeAutoPayments(items: (NewFixedExpensePayment & { accountId: string })[]) {
  const batch = writeBatch(db)
  const spent = new Map<string, number>()
  for (const { accountId, ...rest } of items) {
    batch.set(doc(db, 'fixedExpensePayments', `auto_${rest.fixedExpenseId}_${rest.month}`), {
      ...rest,
      accountId,
      auto: true,
      paymentDate: Timestamp.fromDate(rest.paymentDate),
      createdAt:   serverTimestamp(),
    })
    spent.set(accountId, (spent.get(accountId) ?? 0) + rest.paidAmount)
  }
  spent.forEach((amount, id) => batch.update(doc(db, 'accounts', id), { balance: increment(-amount) }))
  await batch.commit()
}

/** Deletes a payment; `refund` gives the money back to the account it came out of (when that account still exists). */
export async function deleteFixedExpensePayment(id: string, refund?: { accountId: string; amount: number }) {
  if (!refund) return deleteDoc(doc(db, 'fixedExpensePayments', id))
  const batch = writeBatch(db)
  batch.delete(doc(db, 'fixedExpensePayments', id))
  batch.update(doc(db, 'accounts', refund.accountId), { balance: increment(refund.amount) })
  await batch.commit()
}

// ── Income ────────────────────────────────────────────────────────────────────

/** Registers an income and, in the same write, raises the balance of the account it went into. */
export async function addIncome(data: NewIncome) {
  const { accountId, ...rest } = data
  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'incomes')), {
    ...rest,
    ...(accountId ? { accountId } : {}),
    date:      Timestamp.fromDate(data.date),
    createdAt: serverTimestamp(),
  })
  if (accountId) batch.update(doc(db, 'accounts', accountId), { balance: increment(data.amount) })
  await batch.commit()
}

export async function getIncomes(userId: string) {
  const q = query(
    collection(db, 'incomes'),
    where('userId', '==', userId),
    orderBy('date', 'desc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

/** Deletes an income; the account it went into (when it still exists) gives that money back. */
export async function deleteIncome(id: string) {
  const ref = doc(db, 'incomes', id)
  const snap = await getDoc(ref)
  const accountId = snap.exists() ? (snap.data().accountId as string | undefined) : undefined
  const amount = snap.exists() ? (snap.data().amount as number) : 0
  if (!accountId || !(await getDoc(doc(db, 'accounts', accountId))).exists()) return deleteDoc(ref)
  const batch = writeBatch(db)
  batch.delete(ref)
  batch.update(doc(db, 'accounts', accountId), { balance: increment(-amount) })
  await batch.commit()
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export async function addAccount(account: NewAccount) {
  return addDoc(collection(db, 'accounts'), {
    ...account,
    createdAt: serverTimestamp(),
  })
}

export async function getAccounts(userId: string) {
  const q = query(collection(db, 'accounts'), where('userId', '==', userId))
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

export async function updateAccount(id: string, data: Partial<NewAccount>) {
  return updateDoc(doc(db, 'accounts', id), data)
}

export async function deleteAccount(id: string) {
  return deleteDoc(doc(db, 'accounts', id))
}

/** Creates the "Cuenta default" with `balance` unless the user already has one. Returns whether it was created. */
export async function ensureDefaultAccount(userId: string, balance: number) {
  const existing = await getAccounts(userId)
  if (existing.some((a) => a.isDefault)) return false
  const created = await addDoc(collection(db, 'accounts'), {
    userId,
    name: 'Cuenta default',
    type: 'checking',
    balance: Math.round(balance),
    currency: 'COP',
    color: '#52b69a',
    isDefault: true,
    createdAt: serverTimestamp(),
  })
  // The incomes registered so far (salaries and extra ones) belong to this account. Its opening balance
  // (the money on hand today) already includes them, so they are only tagged: no balance moves.
  const incomes = await getDocs(query(collection(db, 'incomes'), where('userId', '==', userId)))
  const untagged = incomes.docs.filter((d) => !d.data().accountId)
  for (let i = 0; i < untagged.length; i += 400) {
    const batch = writeBatch(db)
    untagged.slice(i, i + 400).forEach((d) => batch.update(d.ref, { accountId: created.id }))
    await batch.commit()
  }
  return true
}

/** Every move between accounts the user made. */
export async function getAccountTransfers(userId: string) {
  const snap = await getDocs(query(collection(db, 'accountTransfers'), where('userId', '==', userId)))
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

/** Moves money between two accounts of the user: both balances and the record of the move change together. */
export async function transferBetweenAccounts(t: NewAccountTransfer) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'accounts', t.fromId), { balance: increment(-t.amount) })
  batch.update(doc(db, 'accounts', t.toId), { balance: increment(t.amount) })
  batch.set(doc(collection(db, 'accountTransfers')), {
    ...t,
    date: Timestamp.fromDate(t.date),
    createdAt: serverTimestamp(),
  })
  await batch.commit()
}

// ── Savings Goals ─────────────────────────────────────────────────────────────

export async function addSavingsGoal(goal: NewSavingsGoal) {
  return addDoc(collection(db, 'savingsGoals'), {
    ...goal,
    createdAt: serverTimestamp(),
  })
}

export async function getSavingsGoals(userId: string) {
  const q = query(collection(db, 'savingsGoals'), where('userId', '==', userId))
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

export async function updateSavingsGoal(id: string, data: Partial<NewSavingsGoal>) {
  return updateDoc(doc(db, 'savingsGoals', id), data)
}

export async function deleteSavingsGoal(id: string) {
  return deleteDoc(doc(db, 'savingsGoals', id))
}

// ── Household ─────────────────────────────────────────────────────────────────

function makeInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export async function createHousehold(userId: string, name: string, displayName?: string, photoURL?: string | null) {
  const code = makeInviteCode()
  const ref  = doc(collection(db, 'households'))
  await setDoc(ref, {
    name,
    members:      [userId],
    memberNames:  { [userId]: displayName ?? '' },
    memberPhotos: { [userId]: photoURL ?? null },
    createdBy:    userId,
    inviteCode:   code,
    createdAt:    serverTimestamp(),
  })
  await updateDoc(doc(db, 'users', userId), { householdIds: arrayUnion(ref.id) })
  return { id: ref.id, inviteCode: code }
}

export async function joinHousehold(userId: string, inviteCode: string, displayName?: string, photoURL?: string | null) {
  const q    = query(collection(db, 'households'), where('inviteCode', '==', inviteCode.toUpperCase()))
  const snap = await getDocs(q)
  if (snap.empty) throw new Error('Código de invitación inválido')
  const hDoc    = snap.docs[0]
  const members = (hDoc.data().members ?? []) as string[]
  const names   = (hDoc.data().memberNames ?? {}) as Record<string, string>
  const photos  = (hDoc.data().memberPhotos ?? {}) as Record<string, string | null>
  if (!members.includes(userId)) {
    await updateDoc(hDoc.ref, {
      members:      [...members, userId],
      memberNames:  { ...names, [userId]: displayName ?? '' },
      memberPhotos: { ...photos, [userId]: photoURL ?? null },
    })
  }
  await updateDoc(doc(db, 'users', userId), { householdIds: arrayUnion(hDoc.id) })
  return { id: hDoc.id }
}

export async function getHousehold(id: string) {
  const snap = await getDoc(doc(db, 'households', id))
  if (!snap.exists()) return null
  return mapDoc<Record<string, unknown>>(snap)
}

export async function getHouseholds(ids: string[]) {
  if (ids.length === 0) return []
  // A stale/deleted id makes Firestore rules deny the read (permission-denied,
  // not "not found"), which would reject the whole Promise.all. Use allSettled
  // so one bad id doesn't wipe out every other household the user can see.
  const results = await Promise.allSettled(ids.map(id => getHousehold(id)))
  return results
    .filter((r): r is PromiseFulfilledResult<Record<string, unknown> | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter(Boolean) as Record<string, unknown>[]
}

export async function renameHousehold(id: string, name: string) {
  return updateDoc(doc(db, 'households', id), { name })
}

export async function deleteHousehold(householdId: string, userId: string) {
  await updateDoc(doc(db, 'users', userId), { householdIds: arrayRemove(householdId) })
  const q    = query(collection(db, 'householdDebts'), where('householdId', '==', householdId))
  const snap = await getDocs(q)
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  const crossQ = query(collection(db, 'householdCrossings'), where('householdId', '==', householdId))
  const crossSnap = await getDocs(crossQ)
  await Promise.all(crossSnap.docs.map(d => deleteDoc(d.ref)))
  const expQ = query(collection(db, 'householdExpenses'), where('householdId', '==', householdId))
  const expSnap = await getDocs(expQ)
  await Promise.all(expSnap.docs.map(d => deleteDoc(d.ref)))
  await deleteDoc(doc(db, 'households', householdId))
}

/** Extract household ids from profile — supports both legacy `householdId` and new `householdIds` */
export function getHouseholdIds(profile: Record<string, unknown> | null): string[] {
  if (!profile) return []
  const ids = profile.householdIds as string[] | undefined
  if (ids?.length) return ids
  // legacy single field
  const single = profile.householdId as string | undefined
  return single ? [single] : []
}

// ── Household Debts ───────────────────────────────────────────────────────────

export async function addHouseholdDebt(data: NewHouseholdDebt) {
  return addDoc(collection(db, 'householdDebts'), {
    ...data,
    crossedAmount: 0,
    date:          Timestamp.fromDate(data.date),
    createdAt:     serverTimestamp(),
  })
}

export async function getHouseholdDebts(householdId: string) {
  const q = query(
    collection(db, 'householdDebts'),
    where('householdId', '==', householdId),
    orderBy('date', 'desc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

export async function updateHouseholdDebt(id: string, data: Partial<NewHouseholdDebt>) {
  const payload: Record<string, unknown> = { ...data }
  if (data.date) payload.date = Timestamp.fromDate(data.date)
  return updateDoc(doc(db, 'householdDebts', id), payload)
}

export async function deleteHouseholdDebt(id: string) {
  return deleteDoc(doc(db, 'householdDebts', id))
}

/** Net debt for a single person: positive = they still owe, negative = they're ahead */
export function calcNetBalance(
  debts: Record<string, unknown>[],
  debtorUid: string,
  crossings?: Record<string, unknown>[],
): number {
  let balance = debts.reduce((acc, d) => {
    if (d.debtor !== debtorUid) return acc
    if (d.tipo === 'Deuda') {
      const remaining = (d.amount as number) - ((d.crossedAmount as number) || 0)
      return acc + remaining
    }
    return acc - (d.amount as number)
  }, 0)

  // Subtract total-balance crossings where this person is the counterpart
  if (crossings) {
    balance -= crossings
      .filter(c => c.debt2PersonId === debtorUid && !c.debt2Id)
      .reduce((s, c) => s + (c.amount as number), 0)
  }
  return balance
}

// ── Household Crossings ───────────────────────────────────────────────────────

/**
 * Crosses one debt against one or more of the counterpart's pending debts in a
 * single atomic batch — e.g. I owe $600,000 and they owe $150,000 + $100,000
 * across two separate items: selecting both settles them fully and brings my
 * debt down to $350,000. One householdCrossings doc is written per allocation
 * (so each debt's own crossing history stays accurate), and debt1's
 * crossedAmount is bumped once by the combined total.
 */
export async function addHouseholdCrossing(data: {
  householdId: string
  debt1Id: string
  debt2PersonId: string
  allocations: CrossingAllocation[]
  initiatedBy: string
  notes: string
}) {
  if (data.allocations.length === 0) throw new Error('Selecciona al menos una deuda para cruzar')

  const snap1 = await getDoc(doc(db, 'householdDebts', data.debt1Id))
  if (!snap1.exists()) throw new Error('Deuda no encontrada')
  const d1   = snap1.data()
  const rem1 = (d1.amount as number) - ((d1.crossedAmount as number) || 0)

  const total = data.allocations.reduce((s, a) => s + a.amount, 0)
  if (total > rem1) throw new Error(`El cruce supera el saldo pendiente (${formatCOPRaw(rem1)})`)

  const snaps2 = await Promise.all(data.allocations.map((a) => getDoc(doc(db, 'householdDebts', a.debtId))))

  const batch = writeBatch(db)
  snaps2.forEach((snap2, i) => {
    const alloc = data.allocations[i]
    if (!snap2.exists()) throw new Error('Deuda contraparte no encontrada')
    const d2   = snap2.data()
    const rem2 = (d2.amount as number) - ((d2.crossedAmount as number) || 0)
    if (alloc.amount > rem2) {
      throw new Error(`El cruce supera el saldo pendiente de "${d2.concept}" (${formatCOPRaw(rem2)})`)
    }

    batch.set(doc(collection(db, 'householdCrossings')), {
      householdId:   data.householdId,
      debt1Id:       data.debt1Id,
      debt2Id:       alloc.debtId,
      debt2PersonId: data.debt2PersonId,
      amount:        alloc.amount,
      initiatedBy:   data.initiatedBy,
      notes:         data.notes,
      createdAt:     serverTimestamp(),
    })

    const nc2 = ((d2.crossedAmount as number) || 0) + alloc.amount
    batch.update(snap2.ref, { crossedAmount: nc2, cruzado: nc2 >= (d2.amount as number) })
  })

  const nc1 = ((d1.crossedAmount as number) || 0) + total
  batch.update(snap1.ref, { crossedAmount: nc1, cruzado: nc1 >= (d1.amount as number) })

  await batch.commit()
}

function formatCOPRaw(n: number) {
  return `$${n.toLocaleString('es-CO')}`
}

export async function getHouseholdCrossings(householdId: string) {
  const q    = query(collection(db, 'householdCrossings'), where('householdId', '==', householdId))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => mapDoc<Record<string, unknown>>(d))
    .sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0
      return tb - ta
    })
}

export async function getDebtCrossings(debtId: string) {
  // Crossings can reference this debt as debt1Id or debt2Id
  const [q1, q2] = await Promise.all([
    getDocs(query(collection(db, 'householdCrossings'), where('debt1Id', '==', debtId))),
    getDocs(query(collection(db, 'householdCrossings'), where('debt2Id', '==', debtId))),
  ])
  return [...q1.docs, ...q2.docs].map(d => mapDoc<Record<string, unknown>>(d))
}

// ── Household Expenses (gasto compartido → genera deudas automáticamente) ────

/**
 * Registers a shared expense and, in the same batch, creates one HouseholdDebt
 * per non-payer share — so "Carlos compró un mueble de 800000, 50/50" results in
 * a single 400000 debt for Alexandra, linked back to this expense via expenseId.
 */
export async function createHouseholdExpense(data: NewHouseholdExpense) {
  const shares = resolveExpenseShares(data.amount, data.paidBy, data.splitMode, data.shareInputs)

  const batch = writeBatch(db)
  const expenseRef = doc(collection(db, 'householdExpenses'))
  const dueDate = data.dueDate ? Timestamp.fromDate(data.dueDate) : null

  batch.set(expenseRef, {
    householdId:  data.householdId,
    description:  data.description,
    amount:       data.amount,
    category:     data.category,
    date:         Timestamp.fromDate(data.date),
    paidBy:       data.paidBy,
    splitMode:    data.splitMode,
    shares,
    dueDate,
    notes:        data.notes ?? '',
    registeredBy: data.registeredBy,
    createdAt:    serverTimestamp(),
  })

  for (const debtor of sharesToDebtors(shares)) {
    const debtRef = doc(collection(db, 'householdDebts'))
    batch.set(debtRef, {
      householdId:  data.householdId,
      concept:      data.description,
      tipo:         'Deuda',
      amount:       debtor.amount,
      debtor:       debtor.memberId,
      category:     data.category,
      date:         Timestamp.fromDate(data.date),
      registeredBy: data.registeredBy,
      estado:       '',
      saldaId:      null,
      notas:        data.notes ?? '',
      cruzado:      false,
      crossedAmount: 0,
      expenseId:    expenseRef.id,
      dueDate,
      createdAt:    serverTimestamp(),
    })
  }

  await batch.commit()
  return { id: expenseRef.id, shares }
}

export async function getHouseholdExpenses(householdId: string) {
  const q = query(
    collection(db, 'householdExpenses'),
    where('householdId', '==', householdId),
    orderBy('date', 'desc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

/** Deletes the expense along with every debt it generated, so the ledger never keeps orphans. */
export async function deleteHouseholdExpense(id: string, householdId: string) {
  // The rules only allow queries that are provably limited to the caller's household
  const q    = query(
    collection(db, 'householdDebts'),
    where('householdId', '==', householdId),
    where('expenseId', '==', id),
  )
  const snap = await getDocs(q)
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db, 'householdExpenses', id))
  await batch.commit()
}

/** Mark every non-cruzado debt in the household as cruzado (legacy period-close) */
export async function cruzarCuentas(householdId: string) {
  const q    = query(collection(db, 'householdDebts'), where('householdId', '==', householdId))
  const snap = await getDocs(q)
  const updates = snap.docs
    .filter(d => !d.data().cruzado)
    .map(d => updateDoc(d.ref, { cruzado: true }))
  await Promise.all(updates)
  return updates.length
}

// ── Allowed Users (Administración) ──────────────────────────────────────────

export async function getAllowedUsers() {
  const snap = await getDocs(collection(db, 'allowedUsers'))
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

export async function createAllowedUser(data: {
  email: string
  name: string
  role?: 'admin' | 'integrante' | 'user'
  active?: boolean
  permissions?: string[]
}) {
  const emailNorm = data.email.trim().toLowerCase()
  const q = query(collection(db, 'allowedUsers'), where('email', '==', emailNorm))
  const existing = await getDocs(q)
  if (!existing.empty) {
    throw new Error(existing.docs[0].data().deleted
      ? 'Este correo pertenece a un usuario eliminado. Restáuralo desde la lista.'
      : 'Ya existe un usuario autorizado con este correo electrónico')
  }

  return addDoc(collection(db, 'allowedUsers'), {
    email: emailNorm,
    name: data.name.trim(),
    role: data.role ?? 'integrante',
    active: data.active ?? true,
    deleted: false,
    permissions: data.permissions ?? [],
    createdAt: serverTimestamp(),
  })
}

export async function updateAllowedUser(
  id: string,
  data: Partial<{ email: string; name: string; role: 'admin' | 'integrante' | 'user'; active: boolean; deleted: boolean; permissions: string[] }>
) {
  const payload: Record<string, unknown> = { ...data }
  if (data.email) payload.email = data.email.trim().toLowerCase()
  return updateDoc(doc(db, 'allowedUsers', id), payload)
}

export async function deleteAllowedUser(id: string) {
  return deleteDoc(doc(db, 'allowedUsers', id))
}



// ── Roles ──────────────────────────────────────────────────────────────────

export async function getRoles() {
  const snap = await getDocs(collection(db, 'roles'))
  return snap.docs.map(d => mapDoc<Record<string, unknown>>(d))
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function createNotification(data: NewStoredNotification) {
  return addDoc(collection(db, 'notifications'), { ...data, read: false, createdAt: serverTimestamp() })
}

/** Tells everyone in a household except the person who acted. */
export async function notifyHouseholdMembers(members: string[], payload: Omit<NewStoredNotification, 'userId'>) {
  const others = members.filter((m) => m !== payload.fromUid)
  if (others.length === 0) return
  const batch = writeBatch(db)
  for (const userId of others) {
    batch.set(doc(collection(db, 'notifications')), { ...payload, userId, read: false, createdAt: serverTimestamp() })
  }
  await batch.commit()
}

export async function getNotifications(userId: string) {
  // sorted on the client: filtering on userId and ordering on another field would need a composite index
  const snap = await getDocs(query(collection(db, 'notifications'), where('userId', '==', userId)))
  return snap.docs
    .map((d) => mapDoc<Record<string, unknown>>(d))
    .sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime())
}

export async function markNotificationsRead(ids: string[]) {
  if (ids.length === 0) return
  const batch = writeBatch(db)
  ids.forEach((id) => batch.update(doc(db, 'notifications', id), { read: true }))
  await batch.commit()
}

export async function markNotificationsUnread(ids: string[]) {
  if (ids.length === 0) return
  const batch = writeBatch(db)
  ids.forEach((id) => batch.update(doc(db, 'notifications', id), { read: false }))
  await batch.commit()
}

export async function deleteNotifications(ids: string[]) {
  if (ids.length === 0) return
  const batch = writeBatch(db)
  ids.forEach((id) => batch.delete(doc(db, 'notifications', id)))
  await batch.commit()
}

// ── Household invitations ─────────────────────────────────────────────────────

export async function createHouseholdInvite(data: NewHouseholdInvite) {
  return addDoc(collection(db, 'householdInvites'), { ...data, email: data.email.toLowerCase(), status: 'pending', createdAt: serverTimestamp() })
}

export async function getHouseholdInvites(householdId: string) {
  const snap = await getDocs(query(collection(db, 'householdInvites'), where('householdId', '==', householdId)))
  return snap.docs.map((d) => mapDoc<Record<string, unknown>>(d))
}

export async function getMyInvites(email: string) {
  const snap = await getDocs(query(collection(db, 'householdInvites'), where('email', '==', email.toLowerCase())))
  return snap.docs.map((d) => mapDoc<Record<string, unknown>>(d))
}

export async function respondToInvite(id: string, status: 'accepted' | 'declined') {
  return updateDoc(doc(db, 'householdInvites', id), { status, respondedAt: serverTimestamp() })
}

export async function deleteHouseholdInvite(id: string) {
  return deleteDoc(doc(db, 'householdInvites', id))
}
