/**
 * Minimal Firestore REST client: runs queries and reads documents as plain data (timestamps become Dates).
 * The token comes from the caller so the same code runs in the Worker (service account) and in local tests (CLI token).
 */

export interface Doc { id: string; [field: string]: any }

type Filter = { field: string; op: 'EQUAL' | 'ARRAY_CONTAINS' | 'GREATER_THAN_OR_EQUAL'; value: string | number | boolean }

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

const encodeFilter = (v: string | number | boolean) =>
  typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }

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

export interface Db {
  query(collection: string, filters?: Filter[], limit?: number): Promise<Doc[]>
  get(path: string): Promise<Doc | null>
  /** Creates or replaces the document at `path` with exactly `data`. */
  set(path: string, data: Record<string, unknown>): Promise<void>
  /** Adds a document with a generated id; returns the id. */
  add(collection: string, data: Record<string, unknown>): Promise<string>
  remove(path: string): Promise<void>
}

export function createDb(projectId: string, getToken: () => Promise<string>): Db {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
  const call = async (url: string, init: RequestInit) => {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' } })
    const data: any = await res.json()
    if (!res.ok) throw Object.assign(new Error(`Firestore ${res.status}: ${JSON.stringify(data)}`), { status: res.status })
    return data
  }
  return {
    async query(collection, filters = [], limit) {
      const where = filters.length === 0 ? undefined
        : filters.length === 1 ? { fieldFilter: { field: { fieldPath: filters[0].field }, op: filters[0].op, value: encodeFilter(filters[0].value) } }
          : { compositeFilter: { op: 'AND', filters: filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: encodeFilter(f.value) } })) } }
      const rows: any[] = await call(`${base}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where, limit } }) })
      return rows.filter((r) => r.document).map((r) => toDoc(r.document))
    },
    async get(path) {
      try { return toDoc(await call(`${base}/${path}`, { method: 'GET' })) } catch (e: any) { if (e.status === 404) return null; throw e }
    },
    async set(path, data) {
      await call(`${base}/${path}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(data) }) })
    },
    async add(collection, data) {
      return toDoc(await call(`${base}/${collection}`, { method: 'POST', body: JSON.stringify({ fields: encodeFields(data) }) })).id
    },
    async remove(path) {
      await call(`${base}/${path}`, { method: 'DELETE' })
    },
  }
}
