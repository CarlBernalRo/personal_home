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
  return {
    async query(collection, filters = [], limit) {
      const f = (x: Filter) => ({ fieldFilter: { field: { fieldPath: x.field }, op: x.op, value: encodeFilter(x.value) } })
      const where = filters.length === 0 ? undefined : filters.length === 1 ? f(filters[0]) : { compositeFilter: { op: 'AND', filters: filters.map(f) } }
      const rows: any[] = await call(`${base}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where, limit } }) })
      return rows.filter((r) => r.document).map((r) => toDoc(r.document))
    },
    async get(path) {
      try { return toDoc(await call(`${base}/${path}`, { method: 'GET' })) } catch (e: any) { if (e.status === 404) return null; throw e }
    },
    async set(path, data) {
      await call(`${base}/${path}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) })
    },
    async patch(path, data, remove = []) {
      const keys = [...Object.keys(data).filter((k) => data[k] !== undefined), ...remove]
      await call(`${base}/${path}?${mask(keys)}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) })
    },
    async add(collection, data) {
      return toDoc(await call(`${base}/${collection}`, { method: 'POST', body: JSON.stringify({ fields: encodeFields(data) }) })).id
    },
    async remove(path) {
      await call(`${base}/${path}`, { method: 'DELETE' })
    },
    async batch(writes) {
      const body = writes.map((w) =>
        'create' in w
          ? { update: { name: `${root}/${w.create}`, fields: encodeFields(w.data) }, currentDocument: { exists: false } }
          // the account must exist: a transform on a missing document would create an empty one
          : { transform: { document: `${root}/${w.increment}`, fieldTransforms: [{ fieldPath: w.field, increment: encode(w.by) }] }, currentDocument: { exists: true } })
      await call(`${base}:commit`, { method: 'POST', body: JSON.stringify({ writes: body }) })
    },
  }
}
