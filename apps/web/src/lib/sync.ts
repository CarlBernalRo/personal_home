import {
  doc, getDoc, getDocFromCache, getDocs, getDocsFromCache, onSnapshot,
  type DocumentReference, type DocumentSnapshot, type Query, type QuerySnapshot,
} from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

/**
 * Reading a module again only when it changed.
 *
 * The server stamps every change of a module in a tiny per-user document, `sync/{uid}` (Cloud Functions, see
 * apps/functions): `v.incomes`, `v.expenses`, `v.accounts`, `v.fixed`, `v.fixedPayments`, `v.pending`, `v.notifications`,
 * `v.reminders`, `v.family`, `v.profile`, `v.households` and `v.hh[<householdId>]`. The app keeps ONE listener, on that
 * document, and:
 *  - `readSynced` serves a query from the device's cache when the stamps it depends on are the ones it last read
 *    the server with (and the cache still holds as many documents as then), or from the server otherwise;
 *  - `listenSynced` shows a query live from the cache alone (so the user's own writes show at once, with no reads) and
 *    refreshes it from the server only when its stamps move — someone else changed it.
 * When the stamps can't be known (no signal yet, offline, an error) everything simply reads the server, as before.
 */

/** What a query depends on: plain keys of `v` (`'incomes'`), or a household's own stamp (`'hh.<id>'`). */
export type SyncKey = string

let uid: string | null = null
/** The stamps, once the server has confirmed them; null while unknown. */
let stamps: Record<string, any> | null = null
/** Which documents changed lately, per key: path -> ms (negative = deleted). */
let changeLog: Record<string, Record<string, number>> = {}
/** How far back the server keeps that log (a little less, to be safe): an older gap reads the module again. */
const LOG_TRUST_MS = 6 * 86_400_000
let ready: Promise<void> = Promise.resolve()
let markReady: () => void = () => {}
let stopSignal: (() => void) | null = null
const watchers = new Set<() => void>()

function start(next: string | null) {
  if (next === uid) return
  stopSignal?.()
  stopSignal = null
  uid = next
  stamps = null
  ready = new Promise<void>((resolve) => { markReady = resolve })
  if (!next) { markReady(); return }
  // never wait long for the signal: without it, reads go to the server
  const timer = setTimeout(() => markReady(), 2500)
  stopSignal = onSnapshot(
    doc(db, 'sync', next),
    { includeMetadataChanges: true },
    (snap) => {
      // a copy from the device's cache may be old: only the server's word is trusted
      if (snap.metadata.fromCache) return
      stamps = (snap.data()?.v as Record<string, any> | undefined) ?? {}
      changeLog = (snap.data()?.log as Record<string, Record<string, number>> | undefined) ?? {}
      clearTimeout(timer)
      markReady()
      watchers.forEach((w) => w())
    },
    () => { stamps = null; markReady(); watchers.forEach((w) => w()) },
  )
}
onAuthStateChanged(auth, (user) => start(user?.uid ?? null))

/** The current stamp of a set of keys (null when unknown: then the server is read). */
function stampOf(keys: SyncKey[]): string | null {
  if (!stamps) return null
  return keys.map((k) => {
    if (k.startsWith('hh.')) return `${stamps!.hh?.[k.slice(3)] ?? 0}`
    return `${stamps![k] ?? 0}`
  }).join('|')
}

/** The newest stamp of a set of keys, in ms (0 when unknown). */
function newestOf(keys: SyncKey[]): number {
  if (!stamps) return 0
  return Math.max(0, ...keys.map((k) => Number(k.startsWith('hh.') ? stamps!.hh?.[k.slice(3)] : stamps![k]) || 0))
}

/**
 * The documents of `keys` that changed after `since`, or null when that can't be told from the log (a deletion, which
 * only reading the module again can take off the device, or a gap older than the log): then the module is read whole.
 */
function changedSince(keys: SyncKey[], since: number): string[] | null {
  if (!since || newestOf(keys) - since > LOG_TRUST_MS) return null
  const paths = new Map<string, number>()
  for (const k of keys) {
    const log = changeLog[k]
    if (!log) return null
    for (const [path, at] of Object.entries(log)) {
      if (Math.abs(at) <= since) continue
      if (at < 0) return null
      paths.set(path, Math.max(paths.get(path) ?? 0, at))
    }
  }
  return [...paths.keys()]
}

/** Documents already brought from the server for a given change (several screens refreshing at once read each once). */
const fetched = new Map<string, number>()
async function fetchChanged(keys: SyncKey[], paths: string[]) {
  await Promise.all(paths.map(async (path) => {
    const at = Math.max(0, ...keys.map((k) => changeLog[k]?.[path] ?? 0))
    if ((fetched.get(path) ?? 0) >= at) return
    await getDoc(doc(db, path)) // from the server: it updates the device's copy, which the screens show
    fetched.set(path, at)
  }))
}

/** Runs `fn` every time the stamps change (returns the function that stops it). */
export function onStamps(fn: () => void) {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}

/** What a query was last read with: the stamps, how many documents it had, and the newest stamp (for the log). */
type Seen = { s: string; n: number; t?: number }
const seenKey = (name: string) => `sync:${uid}:${name}`
function loadSeen(name: string): Seen | null {
  try { const raw = localStorage.getItem(seenKey(name)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function saveSeen(name: string, seen: Seen) {
  try { localStorage.setItem(seenKey(name), JSON.stringify(seen)) } catch { /* private mode: just reads the server next time */ }
}

/**
 * A query, from the device when nothing it depends on changed since it was last read from the server, or from the
 * server otherwise. `name` identifies the query (one per distinct query: include its parameters).
 */
export async function readSynced(name: string, keys: SyncKey[], q: Query): Promise<QuerySnapshot> {
  await ready
  // taken BEFORE reading: a change that lands while reading moves it, and the next read goes to the server again
  const stamp = stampOf(keys)
  const newest = newestOf(keys)
  const seen = stamp ? loadSeen(name) : null
  if (stamp && seen && seen.s === stamp) {
    try {
      const cached = await getDocsFromCache(q)
      // the device may have dropped documents (space, cleared data): then it is not the whole answer
      if (cached.size === seen.n) return cached
    } catch { /* not in the cache: read the server */ }
  }
  // only some documents changed since: just those are read, and the device's copy answers the query
  const changed = stamp && seen?.t ? changedSince(keys, seen.t) : null
  if (stamp && changed) {
    try {
      await fetchChanged(keys, changed)
      const cached = await getDocsFromCache(q)
      saveSeen(name, { s: stamp, n: cached.size, t: newest })
      return cached
    } catch { /* fall back to reading it whole */ }
  }
  const fresh = await getDocs(q)
  if (stamp) saveSeen(name, { s: stamp, n: fresh.size, t: newest })
  return fresh
}

/** One document, the same way as `readSynced`. */
export async function readSyncedDoc(name: string, keys: SyncKey[], ref: DocumentReference): Promise<DocumentSnapshot> {
  await ready
  const stamp = stampOf(keys)
  const newest = newestOf(keys)
  const seen = stamp ? loadSeen(name) : null
  // the module changed, but not this document (per the log): the device's copy is still right
  const changed = stamp && seen && seen.s !== stamp && seen.t ? changedSince(keys, seen.t) : null
  const untouched = !!changed && !changed.includes(ref.path)
  if (stamp && seen && (seen.s === stamp || untouched)) {
    try {
      const cached = await getDocFromCache(ref)
      if ((cached.exists() ? 1 : 0) === seen.n) { if (untouched) saveSeen(name, { s: stamp, n: seen.n, t: newest }); return cached }
    } catch { /* not in the cache */ }
  }
  const fresh = await getDoc(ref)
  if (stamp) saveSeen(name, { s: stamp, n: fresh.exists() ? 1 : 0, t: newest })
  return fresh
}

/**
 * A query shown live from the device's cache (no server reads: the user's own writes show at once) and refreshed from
 * the server only when its stamps move. Nothing is shown until the first answer is known, so a screen never flashes
 * "empty" from a cache that simply had nothing yet.
 */
export function listenSynced(name: string, keys: SyncKey[], q: Query, onSnap: (snap: QuerySnapshot) => void, onError?: (e: Error) => void) {
  let primed = false
  let stopped = false
  let lastStamp: string | null | undefined
  const stopCache = onSnapshot(q, { source: 'cache' }, (snap) => { if (primed && !stopped) onSnap(snap) }, (e) => onError?.(e))
  const check = () => {
    const stamp = stampOf(keys)
    if (primed && stamp !== null && stamp === lastStamp) return
    lastStamp = stamp
    readSynced(name, keys, q)
      .then((snap) => {
        if (stopped) return
        const first = !primed
        primed = true
        if (first) onSnap(snap)
      })
      .catch((e) => { if (!stopped) onError?.(e) })
  }
  ready.then(check)
  const stopWatch = onStamps(check)
  return () => { stopped = true; stopCache(); stopWatch() }
}

/** One document live, the same way as `listenSynced`. */
export function listenSyncedDoc(name: string, keys: SyncKey[], ref: DocumentReference, onSnap: (snap: DocumentSnapshot) => void, onError?: (e: Error) => void) {
  let primed = false
  let stopped = false
  let lastStamp: string | null | undefined
  const stopCache = onSnapshot(ref, { source: 'cache' }, (snap) => { if (primed && !stopped) onSnap(snap) }, (e) => onError?.(e))
  const check = () => {
    const stamp = stampOf(keys)
    if (primed && stamp !== null && stamp === lastStamp) return
    lastStamp = stamp
    readSyncedDoc(name, keys, ref)
      .then((snap) => { if (stopped) return; const first = !primed; primed = true; if (first) onSnap(snap) })
      .catch((e) => { if (!stopped) onError?.(e) })
  }
  ready.then(check)
  const stopWatch = onStamps(check)
  return () => { stopped = true; stopCache(); stopWatch() }
}
