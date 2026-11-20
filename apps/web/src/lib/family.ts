import {
  arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, increment, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { createNotification } from './firestore'
import { sameList, viewersOf, type Family, type FamilyShare } from '@/shared'

// ── Helpers ──────────────────────────────────────────────────────────────────

const asFamily = (id: string, d: Record<string, any>): Family => ({
  id,
  name: d.name ?? 'Familia',
  createdBy: d.createdBy,
  admins: d.admins ?? [],
  members: d.members ?? [],
  memberNames: d.memberNames ?? {},
  memberPhotos: d.memberPhotos ?? {},
  relations: d.relations ?? {},
  code: d.code ?? '',
  open: d.open !== false,
  requests: d.requests ?? {},
  rejected: d.rejected ?? {},
  shares: d.shares ?? {},
  createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : undefined,
})

const plain = (data: Record<string, any>) => {
  const out: Record<string, any> = {}
  for (const k of Object.keys(data)) out[k] = data[k] instanceof Timestamp ? data[k].toDate() : data[k]
  return out
}

/** A 6-character code without look-alike letters (no 0/O, 1/I). */
export function newFamilyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** The family the user belongs to, live (null when none). */
export function subscribeMyFamily(uid: string, onFamily: (f: Family | null) => void) {
  return onSnapshot(
    query(collection(db, 'families'), where('members', 'array-contains', uid)),
    (snap) => onFamily(snap.docs[0] ? asFamily(snap.docs[0].id, snap.docs[0].data()) : null),
    () => onFamily(null),
  )
}

/** One family, live (for following a request sent to it). */
export function subscribeFamily(id: string, onFamily: (f: Family | null) => void) {
  return onSnapshot(doc(db, 'families', id), (snap) => onFamily(snap.exists() ? asFamily(snap.id, snap.data()) : null), () => onFamily(null))
}

export async function findFamilyByCode(code: string): Promise<Family | null> {
  const snap = await getDocs(query(collection(db, 'families'), where('code', '==', code.trim().toUpperCase())))
  return snap.docs[0] ? asFamily(snap.docs[0].id, snap.docs[0].data()) : null
}

// ── Creating and joining ─────────────────────────────────────────────────────

export async function createFamily(uid: string, name: string, me: { name: string; photo: string | null }) {
  const ref = doc(collection(db, 'families'))
  await setDoc(ref, {
    name: name.trim() || 'Mi familia',
    createdBy: uid,
    admins: [uid],
    members: [uid],
    memberNames: { [uid]: me.name },
    memberPhotos: { [uid]: me.photo },
    relations: {},
    code: newFamilyCode(),
    open: true,
    requests: {},
    rejected: {},
    shares: {},
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Sends a request to join (the code alone lets nobody in). The request is remembered on the requester's profile so
 * they can follow it, and every administrator gets a notification.
 */
export async function requestToJoin(family: Family, uid: string, me: { name: string; photo: string | null }) {
  await updateDoc(doc(db, 'families', family.id), {
    [`requests.${uid}`]: { name: me.name, photo: me.photo, at: new Date().toISOString() },
    [`rejected.${uid}`]: deleteField(),
  })
  await updateDoc(doc(db, 'users', uid), { familyRequest: { familyId: family.id, familyName: family.name, at: new Date().toISOString() } })
  await Promise.all(family.admins.map((admin) => createNotification({
    userId: admin,
    zone: 'familia',
    severity: 'info',
    title: `${me.name} quiere unirse a tu familia`,
    body: `Pidió entrar a "${family.name}". Acepta o rechaza la solicitud en tu perfil.`,
    link: '/perfil?tab=familia',
    fromUid: uid,
  }).catch(() => {})))
}

/** The requester withdraws a request (or clears the trace of an answered one). */
export async function cancelRequest(familyId: string, uid: string) {
  await updateDoc(doc(db, 'families', familyId), { [`requests.${uid}`]: deleteField(), [`rejected.${uid}`]: deleteField() }).catch(() => {})
  await updateDoc(doc(db, 'users', uid), { familyRequest: deleteField() })
}

export async function forgetRequest(uid: string) {
  await updateDoc(doc(db, 'users', uid), { familyRequest: deleteField() })
}

// ── Administrators ───────────────────────────────────────────────────────────

export async function acceptRequest(family: Family, uid: string, by: string, relation?: string) {
  const r = family.requests[uid]
  if (!r) return
  await updateDoc(doc(db, 'families', family.id), {
    members: arrayUnion(uid),
    [`memberNames.${uid}`]: r.name,
    [`memberPhotos.${uid}`]: r.photo ?? null,
    ...(relation ? { [`relations.${uid}`]: relation } : {}),
    [`requests.${uid}`]: deleteField(),
  })
  await createNotification({
    userId: uid, zone: 'familia', severity: 'success',
    title: `Ya eres parte de "${family.name}"`,
    body: 'Tu solicitud fue aceptada. En tu perfil eliges qué gastos compartir con tu familia.',
    link: '/perfil?tab=familia', fromUid: by,
  }).catch(() => {})
}

export async function rejectRequest(family: Family, uid: string, by: string) {
  await updateDoc(doc(db, 'families', family.id), { [`requests.${uid}`]: deleteField(), [`rejected.${uid}`]: new Date().toISOString() })
  await createNotification({
    userId: uid, zone: 'familia', severity: 'info',
    title: 'Tu solicitud no fue aceptada',
    body: `No te aceptaron en "${family.name}".`,
    link: '/perfil?tab=familia', fromUid: by,
  }).catch(() => {})
}

export async function setRelation(familyId: string, uid: string, relation: string) {
  await updateDoc(doc(db, 'families', familyId), { [`relations.${uid}`]: relation || deleteField() })
}

export async function setAdmin(familyId: string, uid: string, admin: boolean) {
  await updateDoc(doc(db, 'families', familyId), { admins: admin ? arrayUnion(uid) : arrayRemove(uid) })
}

/** An administrator takes someone out (what they shared stops being visible right away for the others too). */
export async function removeMember(familyId: string, uid: string) {
  await updateDoc(doc(db, 'families', familyId), {
    members: arrayRemove(uid),
    admins: arrayRemove(uid),
    [`shares.${uid}`]: deleteField(),
    [`relations.${uid}`]: deleteField(),
  })
}

export async function renameFamily(familyId: string, name: string) {
  await updateDoc(doc(db, 'families', familyId), { name: name.trim() || 'Mi familia' })
}

export async function regenerateCode(familyId: string) {
  await updateDoc(doc(db, 'families', familyId), { code: newFamilyCode() })
}

export async function setOpen(familyId: string, open: boolean) {
  await updateDoc(doc(db, 'families', familyId), { open })
}

// ── Members ──────────────────────────────────────────────────────────────────

/**
 * An administrator deletes the family (or the last person leaves it): its code stops working, nobody sees anybody's
 * expenses any more, and the other members are told.
 */
export async function deleteFamily(family: Family, by: string, byName: string) {
  await deleteDoc(doc(db, 'families', family.id))
  await Promise.all(family.members.filter((u) => u !== by).map((u) => createNotification({
    userId: u, zone: 'familia', severity: 'info',
    title: `${byName} eliminó la familia "${family.name}"`,
    body: 'Ya no compartes gastos con esa familia. Puedes crear otra o unirte con un código.',
    link: '/perfil?tab=familia', fromUid: by,
  }).catch(() => {})))
}

/** Leaving: the member takes themselves out and stops sharing. */
export async function leaveFamily(familyId: string, uid: string) {
  await updateDoc(doc(db, 'families', familyId), {
    members: arrayRemove(uid),
    admins: arrayRemove(uid),
    [`shares.${uid}`]: deleteField(),
  })
}

export async function saveMyShare(familyId: string, uid: string, share: FamilyShare) {
  await updateDoc(doc(db, 'families', familyId), { [`shares.${uid}`]: share })
}

// ── Sharing the data itself ──────────────────────────────────────────────────

/**
 * Brings `sharedWith` on the user's fixed expenses and their payments in line with what they share now: that list is
 * what the security rules check before anybody else can read a record. Runs whenever the family or the user's
 * expenses change; nothing is written when everything already matches.
 */
export async function syncFamilySharing(uid: string, family: Family | null) {
  const [expSnap, paySnap] = await Promise.all([
    getDocs(query(collection(db, 'fixedExpenses'), where('userId', '==', uid))),
    getDocs(query(collection(db, 'fixedExpensePayments'), where('userId', '==', uid))),
  ])
  const want = new Map<string, string[]>()
  const updates: { ref: any; sharedWith: string[] }[] = []
  for (const d of expSnap.docs) {
    const data = d.data()
    const viewers = viewersOf({ id: d.id, category: data.category }, family, uid)
    want.set(d.id, viewers)
    if (!sameList(data.sharedWith ?? [], viewers)) updates.push({ ref: d.ref, sharedWith: viewers })
  }
  for (const d of paySnap.docs) {
    const data = d.data()
    const viewers = want.get(data.fixedExpenseId) ?? []
    if (!sameList(data.sharedWith ?? [], viewers)) updates.push({ ref: d.ref, sharedWith: viewers })
  }
  for (let i = 0; i < updates.length; i += 450) {
    const batch = writeBatch(db)
    for (const u of updates.slice(i, i + 450)) batch.update(u.ref, { sharedWith: u.sharedWith })
    await batch.commit()
  }
  return updates.length
}

/** What the other members share with the user: their fixed expenses and those expenses' payments. */
export async function getSharedWithMe(uid: string) {
  const [expSnap, paySnap] = await Promise.all([
    getDocs(query(collection(db, 'fixedExpenses'), where('sharedWith', 'array-contains', uid))),
    getDocs(query(collection(db, 'fixedExpensePayments'), where('sharedWith', 'array-contains', uid))),
  ])
  return {
    expenses: expSnap.docs.map((d) => ({ id: d.id, ...plain(d.data()) })),
    payments: paySnap.docs.map((d) => ({ id: d.id, ...plain(d.data()) })),
  }
}

export async function getFamily(id: string) {
  const snap = await getDoc(doc(db, 'families', id))
  return snap.exists() ? asFamily(snap.id, snap.data()) : null
}

// ── Transfers to a family member ─────────────────────────────────────────────

interface TransferInput {
  family: Family
  from: string
  fromName: string
  to: string
  amount: number
  date: Date
  accountId?: string
  concept?: string
  notes?: string
  /** The receipt; it must already be shared with `to` so they can see it from their side. */
  attachmentId?: string
}

/**
 * Money sent to a family member, registered once: it leaves the sender's account as a spend ("Transferencias a
 * personas") and reaches the recipient as a pending income with the same receipt, which they confirm in the account
 * it landed in. Nobody has to register it twice.
 */
export async function sendFamilyTransfer(t: TransferInput) {
  const toName = t.family.memberNames[t.to] ?? 'un familiar'
  const pmRef = doc(collection(db, 'pendingMovements'))
  const expRef = doc(collection(db, 'expenses'))
  const batch = writeBatch(db)
  batch.set(expRef, {
    userId: t.from,
    description: t.concept?.trim() || `Transferencia a ${toName}`,
    amount: t.amount,
    category: 'transferencias',
    date: Timestamp.fromDate(t.date),
    type: 'variable',
    isRecurring: false,
    tracked: true,
    ...(t.accountId ? { accountId: t.accountId } : {}),
    ...(t.attachmentId ? { attachmentId: t.attachmentId } : {}),
    ...(t.notes?.trim() ? { notes: t.notes.trim() } : {}),
    familyTransfer: { to: t.to, toName, pendingId: pmRef.id },
    createdAt: serverTimestamp(),
  })
  if (t.accountId) batch.update(doc(db, 'accounts', t.accountId), { balance: increment(-t.amount) })
  batch.set(pmRef, recipientPending(t))
  await batch.commit()
  await tellRecipient(t)
}

const recipientPending = (t: TransferInput) => ({
  userId: t.to,
  kind: 'income',
  amount: t.amount,
  date: Timestamp.fromDate(t.date),
  concept: `Transferencia de ${t.fromName}`,
  ...(t.notes?.trim() ? { comment: t.notes.trim() } : {}),
  ...(t.attachmentId ? { attachmentId: t.attachmentId } : {}),
  source: 'family',
  fromUid: t.from,
  fromName: t.fromName,
  familyId: t.family.id,
  status: 'pending',
  createdAt: serverTimestamp(),
})

const tellRecipient = (t: TransferInput) => createNotification({
  userId: t.to,
  zone: 'familia',
  severity: 'info',
  title: `${t.fromName} te transfirió dinero`,
  body: `Confirma en qué cuenta te llegaron los ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(t.amount)} y queda registrado como ingreso.`,
  link: '/pendientes',
  fromUid: t.from,
}).catch(() => {})

/**
 * A movement that came from Telegram turned into a transfer to a family member: the sender's side is registered as a
 * spend from it (by the caller), and here the receipt is shared and the recipient gets their pending income.
 */
export async function forwardToFamily(t: TransferInput, sourceId: string): Promise<boolean> {
  if (t.attachmentId) await updateDoc(doc(db, 'attachments', t.attachmentId), { sharedWith: arrayUnion(t.to) }).catch(() => {})
  // one fixed id per original movement and recipient (the bot uses the same one): if their side already exists, the
  // rules refuse to create it again, so nobody gets the same transfer twice
  try {
    await setDoc(doc(db, 'pendingMovements', familyPendingId(sourceId, t.to)), recipientPending(t))
  } catch {
    return false
  }
  await tellRecipient(t)
  return true
}

/** The id of a family member's side of a transfer that came from one of the sender's movements. */
export const familyPendingId = (sourceId: string, to: string) => `fam_${sourceId}_${to}`

/** The sender deleted the spend: the recipient's income that was still waiting goes away too. */
export async function withdrawFamilyTransfer(pendingId: string) {
  await deleteDoc(doc(db, 'pendingMovements', pendingId)).catch(() => {})
}
