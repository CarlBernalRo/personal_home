import * as fs from 'firebase/firestore'
import type { DocumentData, DocumentReference, Firestore } from 'firebase/firestore'
import { auth, db } from './firebase'

/**
 * Firestore's write functions, the same signatures, plus the change signal every screen relies on (see lib/sync.ts).
 *
 * After a write lands, everyone it concerns gets a stamp in their `sync/{uid}` document saying which module changed and
 * which document it was (the log is what lets an open screen read just that document). Who it concerns comes from the
 * document itself — its owner and who it is shared with, or the household's members — read from the device's copy
 * before the write (free: what is changed was on screen), or from the server when it isn't there.
 *
 * Stamps are the server's time (serverTimestamp), so devices with clocks that disagree never misorder them. A signal
 * that can't be written is only a missed refresh, never a failed save: errors there are swallowed.
 */

type Kind = 'set' | 'update' | 'delete'
interface Touched { path: string; kind: Kind; data?: Record<string, any>; before?: Promise<Record<string, any> | null> }

/** Module key of each collection the screens read. */
const PERSONAL: Record<string, string> = {
  incomes: 'incomes', expenses: 'expenses', accounts: 'accounts', fixedExpenses: 'fixed', fixedExpensePayments: 'fixedPayments',
  pendingMovements: 'pending', reminders: 'reminders', notifications: 'notifications',
}
const HOUSEHOLD_PARTS = new Set(['householdDebts', 'householdExpenses', 'householdCrossings'])
const PROFILE_FIELDS = ['paySchedule', 'variableBudgets', 'householdIds', 'householdId', 'telegramZones', 'tags']
const tracked = (collection: string) => collection in PERSONAL || HOUSEHOLD_PARTS.has(collection) || ['households', 'families', 'users'].includes(collection)

const docData = (snap: fs.DocumentSnapshot) => (snap.exists() ? (snap.data() as Record<string, any>) : null)
/** The document as it is before a write: the device's copy, else the server's (null when unknown or not allowed). */
function prior(ref: DocumentReference): Promise<Record<string, any> | null> {
  return fs.getDocFromCache(ref).then(docData).catch(() => fs.getDoc(ref).then(docData).catch(() => null))
}
const collectionOf = (path: string) => path.split('/')[0]
const isTopLevel = (path: string) => path.split('/').length === 2

/** Starts reading what a write needs to know before it changes the document (only for the collections that matter). */
function touched(ref: DocumentReference, kind: Kind, data?: unknown): Touched {
  const path = ref.path
  const coll = collectionOf(path)
  const t: Touched = { path, kind, data: data && typeof data === 'object' ? (data as Record<string, any>) : undefined }
  if (isTopLevel(path) && tracked(coll)) {
    const hasOwner = t.data && (t.data.userId || t.data.householdId)
    if (kind !== 'set' || !hasOwner) t.before = prior(ref)
  }
  return t
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
/** The uids a dotted field of an update names (`requests.<uid>`, `memberNames.<uid>`). */
const dotted = (data: Record<string, any> | undefined, prefix: string) => Object.keys(data ?? {}).filter((k) => k.startsWith(`${prefix}.`)).map((k) => k.split('.')[1])

interface Stamp { uid: string; key: string; householdId?: string; path: string; deleted: boolean }

/** Who a write concerns, and under which key. */
async function stampsOf(t: Touched, me: string): Promise<Stamp[]> {
  if (!isTopLevel(t.path)) return []
  const coll = collectionOf(t.path)
  if (!tracked(coll)) return []
  const before = t.before ? await t.before : null
  const after = t.kind === 'delete' ? null : t.data ?? null
  const deleted = t.kind === 'delete'
  const out = (uids: string[], key: string, householdId?: string): Stamp[] =>
    [...new Set(uids.filter((u) => u && !u.startsWith('guest_')))].map((uid) => ({ uid, key, householdId, path: t.path, deleted }))

  if (coll in PERSONAL) {
    const owners = [before, after].flatMap((d) => (d ? [d.userId, ...ids(d.sharedWith)] : []))
    return out(owners.length ? owners : [me], PERSONAL[coll])
  }
  if (coll === 'users') {
    const id = t.path.split('/')[1]
    const changed = Object.keys(t.data ?? {}).map((k) => k.split('.')[0])
    if (t.kind !== 'delete' && !changed.some((k) => PROFILE_FIELDS.includes(k))) return []
    return out([id], 'profile')
  }
  if (coll === 'families') {
    const people = [before, after].flatMap((d) => (d ? [...ids(d.members), ...Object.keys(d.requests ?? {}), ...Object.keys(d.rejected ?? {})] : []))
    return out([me, ...people, ...dotted(t.data, 'requests'), ...dotted(t.data, 'rejected')], 'family')
  }
  if (coll === 'households') {
    const householdId = t.path.split('/')[1]
    const people = [before, after].flatMap((d) => (d ? ids(d.members) : []))
    return out([me, ...people, ...dotted(t.data, 'memberNames')], 'households', householdId)
  }
  // a household's debts, expenses and crossings: all its members
  const householdId = (after?.householdId ?? before?.householdId) as string | undefined
  if (!householdId) return out([me], 'households')
  const hh = await prior(fs.doc(db, 'households', householdId))
  return out([me, ...ids(hh?.members)], 'households', householdId)
}

/** A document path as a map key (Firestore field names keep it whole). `~` marks a deletion. */
const logKey = (path: string, deleted: boolean) => `${deleted ? '~' : ''}${path.replace('/', '|')}`

async function signal(items: Touched[]) {
  const me = auth.currentUser?.uid
  if (!me || items.length === 0) return
  try {
    const stamps = (await Promise.all(items.map((t) => stampsOf(t, me)))).flat()
    if (stamps.length === 0) return
    const byUser = new Map<string, { v: Record<string, any>; log: Record<string, Record<string, any>> }>()
    for (const s of stamps) {
      const u = byUser.get(s.uid) ?? { v: {}, log: {} }
      const now = fs.serverTimestamp()
      u.v[s.key] = now
      const logName = s.householdId ? `hh:${s.householdId}` : s.key
      if (s.householdId) u.v.hh = { ...(u.v.hh ?? {}), [s.householdId]: now }
      u.log[logName] = { ...(u.log[logName] ?? {}), [logKey(s.path, s.deleted)]: now }
      byUser.set(s.uid, u)
    }
    const batch = fs.writeBatch(db)
    for (const [uid, u] of byUser) batch.set(fs.doc(db, 'sync', uid), u, { merge: true })
    await batch.commit()
  } catch (e) {
    console.warn('No se pudo avisar del cambio (las otras pantallas lo verán al recargar):', e)
  }
}

// ── the wrapped functions ─────────────────────────────────────────────────────────────────────────────────────────

export const setDoc = (async (ref: DocumentReference, data: any, options?: fs.SetOptions) => {
  const t = touched(ref, 'set', data)
  await (options ? fs.setDoc(ref, data, options) : fs.setDoc(ref, data))
  void signal([t])
}) as typeof fs.setDoc

export const addDoc = (async (ref: fs.CollectionReference, data: any) => {
  const created = await fs.addDoc(ref, data)
  void signal([{ path: created.path, kind: 'set', data }])
  return created
}) as typeof fs.addDoc

export const updateDoc = (async (ref: DocumentReference, ...args: any[]) => {
  const t = touched(ref, 'update', typeof args[0] === 'object' ? args[0] : undefined)
  await (fs.updateDoc as any)(ref, ...args)
  void signal([t])
}) as typeof fs.updateDoc

export const deleteDoc = (async (ref: DocumentReference) => {
  const t = touched(ref, 'delete')
  await fs.deleteDoc(ref)
  void signal([t])
}) as typeof fs.deleteDoc

/** A batch that signals every document it wrote, once it commits. */
export function writeBatch(firestore: Firestore): fs.WriteBatch {
  const b = fs.writeBatch(firestore)
  const items: Touched[] = []
  const w: any = {
    set(ref: DocumentReference, data: DocumentData, options?: fs.SetOptions) { items.push(touched(ref, 'set', data)); options ? b.set(ref, data, options) : b.set(ref, data); return w },
    update(ref: DocumentReference, ...args: any[]) { items.push(touched(ref, 'update', typeof args[0] === 'object' ? args[0] : undefined)); (b.update as any)(ref, ...args); return w },
    delete(ref: DocumentReference) { items.push(touched(ref, 'delete')); b.delete(ref); return w },
    async commit() { await b.commit(); void signal(items) },
  }
  return w as fs.WriteBatch
}

/** A transaction that signals what its last (successful) attempt wrote. */
export async function runTransaction<T>(firestore: Firestore, fn: (tx: fs.Transaction) => Promise<T>, options?: fs.TransactionOptions): Promise<T> {
  let items: Touched[] = []
  const result = await fs.runTransaction(firestore, async (tx) => {
    items = [] // a retried attempt starts over
    const w: any = {
      get: (ref: DocumentReference) => tx.get(ref),
      set(ref: DocumentReference, data: DocumentData, opts?: fs.SetOptions) { items.push(touched(ref, 'set', data)); opts ? tx.set(ref, data, opts) : tx.set(ref, data); return w },
      update(ref: DocumentReference, ...args: any[]) { items.push(touched(ref, 'update', typeof args[0] === 'object' ? args[0] : undefined)); (tx.update as any)(ref, ...args); return w },
      delete(ref: DocumentReference) { items.push(touched(ref, 'delete')); tx.delete(ref); return w },
    }
    return fn(w as fs.Transaction)
  }, options)
  void signal(items)
  return result
}
