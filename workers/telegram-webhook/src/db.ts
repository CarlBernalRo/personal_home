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

const encode = (v: string | number | boolean) =>
  typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }

export const toDoc = (d: { name: string; fields?: Record<string, any> }): Doc => ({
  id: d.name.split('/').pop()!,
  ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, decode(v)])),
})

export interface Db {
  query(collection: string, filters?: Filter[], limit?: number): Promise<Doc[]>
  get(path: string): Promise<Doc | null>
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
        : filters.length === 1 ? { fieldFilter: { field: { fieldPath: filters[0].field }, op: filters[0].op, value: encode(filters[0].value) } }
          : { compositeFilter: { op: 'AND', filters: filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: encode(f.value) } })) } }
      const rows: any[] = await call(`${base}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where, limit } }) })
      return rows.filter((r) => r.document).map((r) => toDoc(r.document))
    },
    async get(path) {
      try { return toDoc(await call(`${base}/${path}`, { method: 'GET' })) } catch (e: any) { if (e.status === 404) return null; throw e }
    },
  }
}
