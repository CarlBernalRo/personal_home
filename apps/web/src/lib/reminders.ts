import { addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import type { Reminder } from '@/shared'

const asReminder = (id: string, d: Record<string, any>): Reminder => ({
  id,
  userId: d.userId,
  ownerName: d.ownerName ?? '',
  ownerPhoto: d.ownerPhoto ?? null,
  title: d.title ?? '',
  notes: d.notes || undefined,
  date: d.date,
  every: d.every ?? 0,
  sharedWith: d.sharedWith ?? [],
  done: d.done ?? {},
  createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : undefined,
})

/** The user's reminders and the ones family members share with them, live (two queries the rules allow). */
export function subscribeReminders(uid: string, onRows: (rows: Reminder[]) => void) {
  let mine: Reminder[] = []
  let shared: Reminder[] = []
  const emit = () => onRows([...mine, ...shared.filter((s) => !mine.some((m) => m.id === s.id))])
  const a = onSnapshot(query(collection(db, 'reminders'), where('userId', '==', uid)), (snap) => { mine = snap.docs.map((x) => asReminder(x.id, x.data())); emit() }, () => { mine = []; emit() })
  const b = onSnapshot(query(collection(db, 'reminders'), where('sharedWith', 'array-contains', uid)), (snap) => { shared = snap.docs.map((x) => asReminder(x.id, x.data())); emit() }, () => { shared = []; emit() })
  return () => { a(); b() }
}

export type ReminderInput = Pick<Reminder, 'title' | 'date' | 'every' | 'sharedWith'> & { notes?: string }

export async function addReminder(owner: { uid: string; name: string; photo: string | null }, r: ReminderInput) {
  await addDoc(collection(db, 'reminders'), {
    userId: owner.uid, ownerName: owner.name, ownerPhoto: owner.photo,
    title: r.title.trim(), date: r.date, every: r.every, sharedWith: r.sharedWith,
    ...(r.notes?.trim() ? { notes: r.notes.trim() } : {}),
    done: {}, createdAt: serverTimestamp(),
  })
}

export async function updateReminder(id: string, r: ReminderInput) {
  await updateDoc(doc(db, 'reminders', id), {
    title: r.title.trim(), date: r.date, every: r.every, sharedWith: r.sharedWith,
    notes: r.notes?.trim() ? r.notes.trim() : deleteField(),
  })
}

export async function deleteReminder(id: string) {
  await deleteDoc(doc(db, 'reminders', id))
}

/** Marks one occurrence done (or not) — anybody who sees the reminder can. */
export async function setReminderDone(id: string, date: string, who: { uid: string; name: string } | null) {
  await updateDoc(doc(db, 'reminders', id), { [`done.${date}`]: who ? { by: who.uid, name: who.name, at: new Date().toISOString() } : deleteField() })
}
