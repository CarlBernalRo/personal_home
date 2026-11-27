/**
 * Minimal Firestore REST client: runs queries, reads documents as plain data (timestamps become Dates) and writes them,
 * including all-or-nothing batches. The token comes from the caller so the same code runs in the Worker (service
 * account) and in local tests (CLI token).
 */

export interface Doc { id: string; [field: string]: any }

type Op = 'EQUAL' | 'ARRAY_CONTAINS' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL'
export type Filter = { field: string; op: Op; value: string | number | boolean | Date }

export function decode(v: any): any {
  if (v == null) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('timestampValue' in v) return new Date(v.timestampValue)
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode)
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decode(x)]))
  return null
}

const encodeFilter = (v: string | number | boolean | Date) =>
  v instanceof Date ? { timestampValue: v.toISOString() }
    : typeof v === 'string' ? { stringValue: v }
      : typeof v === 'boolean' ? { booleanValue: v }
        : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }

export const toDoc = (d: { name: string; fields?: Record<string, any> }): Doc => ({
  id: d.name.split('/').pop()!,
  ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, decode(v)])),
})

/** Plain data -> Firestore REST value. `undefined` fields are skipped; Dates become timestamps. */
export function encode(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: null }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } }
  return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } }
}
const encodeFields = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)]))

/** One step of an all-or-nothing batch. */
export type BatchWrite =
  /** Creates the document; the whole batch fails with `status: 409` if it already exists. */
  | { create: string; data: Record<string, unknown> }
  /** Adds `by` (negative to subtract) to a number field of an existing document, atomically. */
  | { increment: string; field: string; by: number }

export interface Db {
  query(collection: string, filters?: Filter[], limit?: number): Promise<Doc[]>
  get(path: string): Promise<Doc | null>
  /** Creates or replaces the document at `path` with exactly `data`. */
  set(path: string, data: Record<string, unknown>): Promise<void>
  /** Changes only the given fields; the ones in `remove` are deleted. Everything else stays. */
  patch(path: string, data: Record<string, unknown>, remove?: string[]): Promise<void>
  /** Adds a document with a generated id; returns the id. */
  add(collection: string, data: Record<string, unknown>): Promise<string>
  remove(path: string): Promise<void>
  /** Applies every step or none. Fails with `status: 409` when a `create` finds the document already there. */
  batch(writes: BatchWrite[]): Promise<void>
}

// ── change signals ────────────────────────────────────────────────────────────────────────────────────────────────
// What the bot writes for the app (pending movements, notices, automatic payments and the accounts they move) is
// stamped in each owner's `sync/{uid}` with the server's time, exactly like the app's own writes (apps/web lib/writes.ts),
// so open screens read just those documents and closed ones know to read them when they open.

/** Module key of each collection whose changes the app's screens follow. */
const SIGNALLED: Record<string, string> = {
  pendingMovements: 'pending', notifications: 'notifications', fixedExpensePayments: 'fixedPayments', accounts: 'accounts',
  incomes: 'incomes', expenses: 'expenses', fixedExpenses: 'fixed', reminders: 'reminders',
}
const BACKTICK = String.fromCharCode(96)
/** A field path segment, quoted when it isn't a plain name. */
const segment = (s: string) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : BACKTICK + s.split('\\').join('\\\\').split(BACKTICK).join('\\' + BACKTICK) + BACKTICK)
/** Who a written document concerns: its owner and whoever it is shared with. */
const ownersOf = (data: Record<string, unknown> | undefined) =>
  [data?.userId, ...(Array.isArray(data?.sharedWith) ? (data!.sharedWith as unknown[]) : [])]
    .filter((u): u is string => typeof u === 'string' && !!u && !u.startsWith('guest_'))

export function createDb(projectId: string, getToken: () => Promise<string>): Db {
  const root = `projects/${projectId}/databases/(default)/documents`
  const base = `https://firestore.googleapis.com/v1/${root}`
  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' } })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(`Firestore ${res.status}: ${JSON.stringify(data)}`), { status: res.status })
    return data
  }
  const mask = (fields: string[]) => fields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
  // Our own derived-notice ids are themselves percent-encoded (`fx-soon%7Cabc%7C2026-11`, from the app's and the
  // Worker's own encodeURIComponent(key)). Dropped straight into a URL path, that literal "%7C" is indistinguishable
  // from an already-escaped "|": Firestore decodes it back to "|" and looks up a document that was never created,
  // so the real one is never found (get) or a stray new one is written instead (set/patch) — never erroring, so the
  // original stays "pending" forever and gets resent every run. Each segment is escaped again before it goes in the URL.
  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

  /** Stamps what was written for the people it concerns. A failure is only a missed refresh, never a failed write. */
  async function signal(items: { path: string; data?: Record<string, unknown>; owners?: string[] }[]) {
    const byUser = new Map<string, Set<string>>()
    for (const it of items) {
      const [coll, ...rest] = it.path.split('/')
      if (rest.length !== 1 || !(coll in SIGNALLED)) continue
      for (const uid of it.owners ?? ownersOf(it.data)) {
        const paths = byUser.get(uid) ?? new Set<string>()
        paths.add(it.path)
        byUser.set(uid, paths)
      }
    }
    if (byUser.size === 0) return
    const writes = [...byUser].map(([uid, paths]) => {
      const keyOf = (p: string) => SIGNALLED[p.split('/')[0]]
      const updateTransforms = [
        ...[...new Set([...paths].map(keyOf))].map((k) => ({ fieldPath: `v.${segment(k)}`, setToServerValue: 'REQUEST_TIME' })),
        ...[...paths].map((p) => ({ fieldPath: `log.${segment(keyOf(p))}.${segment(p.replace('/', '|'))}`, setToServerValue: 'REQUEST_TIME' })),
      ]
      // an empty mask leaves every other field as it is (and creates the document when it doesn't exist yet)
      return { update: { name: `${root}/sync/${uid}`, fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms }
    })
    await call(`${base}:commit`, { method: 'POST', body: JSON.stringify({ writes }) }).catch((e) => console.error('signal:', e?.message))
  }

  return {
    async query(collection, filters = [], limit) {
      const f = (x: Filter) => ({ fieldFilter: { field: { fieldPath: x.field }, op: x.op, value: encodeFilter(x.value) } })
      const where = filters.length === 0 ? undefined : filters.length === 1 ? f(filters[0]) : { compositeFilter: { op: 'AND', filters: filters.map(f) } }
      const rows: any[] = await call(`${base}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where, limit } }) })
      return rows.filter((r) => r.document).map((r) => toDoc(r.document))
    },
    async get(path) {
      try { return toDoc(await call(`${base}/${encodePath(path)}`, { method: 'GET' })) } catch (e: any) { if (e.status === 404) return null; throw e }
    },
    async set(path, data) {
      await call(`${base}/${encodePath(path)}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) })
      await signal([{ path, data }])
    },
    async patch(path, data, remove = []) {
      const keys = [...Object.keys(data).filter((k) => data[k] !== undefined), ...remove]
      await call(`${base}/${encodePath(path)}?${mask(keys)}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) })
    },
    async add(collection, data) {
      const id = toDoc(await call(`${base}/${encodePath(collection)}`, { method: 'POST', body: JSON.stringify({ fields: encodeFields(data) }) })).id
      await signal([{ path: `${collection}/${id}`, data }])
      return id
    },
    async remove(path) {
      await call(`${base}/${encodePath(path)}`, { method: 'DELETE' })
    },
    async batch(writes) {
      const body = writes.map((w) =>
        'create' in w
          ? { update: { name: `${root}/${w.create}`, fields: encodeFields(w.data) }, currentDocument: { exists: false } }
          // the account must exist: a transform on a missing document would create an empty one
          : { transform: { document: `${root}/${w.increment}`, fieldTransforms: [{ fieldPath: w.field, increment: encode(w.by) }] }, currentDocument: { exists: true } })
      await call(`${base}:commit`, { method: 'POST', body: JSON.stringify({ writes: body }) })
      // an account moved in the same batch belongs to whoever the batch created something for
      const creates = writes.filter((w): w is Extract<BatchWrite, { create: string }> => 'create' in w)
      const owners = [...new Set(creates.flatMap((w) => ownersOf(w.data)))]
      await signal([
        ...creates.map((w) => ({ path: w.create, data: w.data })),
        ...writes.filter((w): w is Extract<BatchWrite, { increment: string }> => 'increment' in w).map((w) => ({ path: w.increment, owners })),
      ])
    },
  }
}
