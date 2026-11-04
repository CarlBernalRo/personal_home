/**
 * Reads a screenshot of a payment / transfer / receipt and returns what it SAYS (amount, date, concept…), with Cloudflare
 * Workers AI (a vision model that runs inside your own Cloudflare account: free daily allowance, no key, and the image
 * is not sent to any other company). It never decides anything: every field may come back empty, and the chat flow asks
 * the person to confirm each one. The answer is validated here field by field, whatever the model returns.
 */

export interface Extracted {
  is_payment_proof: boolean
  direction: 'income' | 'expense' | 'unknown'
  amount: number | null
  currency: string | null
  /** YYYY-MM-DD */
  date: string | null
  /** HH:MM */
  time: string | null
  concept: string | null
  counterparty: string | null
  reference: string | null
  app: string | null
}

export const EMPTY_EXTRACTED: Extracted = {
  is_payment_proof: false, direction: 'unknown', amount: null, currency: null, date: null, time: null,
  concept: null, counterparty: null, reference: null, app: null,
}

/** The Workers AI binding (`[ai] binding = "AI"` in wrangler.toml), or anything with the same `run`. */
export interface AiRunner { run(model: string, input: unknown): Promise<any> }
export interface VisionEnv { AI: AiRunner; VISION_MODEL?: string }

/** Reads Spanish text well, no license step, and answers in about 2 seconds. */
export const DEFAULT_VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'

export const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** An amount written as text ("120.000", "$ 1.234,50", "25,000") → number. In Colombia "." groups thousands. */
function textToNumber(text: string): number {
  let t = text.replace(/[^\d.,]/g, '')
  const dot = t.lastIndexOf('.')
  const comma = t.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) t = comma > dot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (dot >= 0 || comma >= 0) {
    const parts = t.split(dot >= 0 ? '.' : ',')
    // groups of exactly 3 digits are thousands ("25.000"); otherwise a decimal mark ("25,5")
    t = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? parts.join('') : `${parts[0]}.${parts[1]}`
  }
  return Number(t)
}

/** Whatever the model answered → a safe `Extracted` (unknown shapes become null, never a guess). */
export function sanitize(raw: any): Extracted {
  const o = raw && typeof raw === 'object' ? raw : {}
  const n = typeof o.amount === 'number' ? o.amount : typeof o.amount === 'string' ? textToNumber(o.amount) : NaN
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !isNaN(Date.parse(o.date)) ? o.date : null
  const time = typeof o.time === 'string' && /^\d{1,2}:\d{2}/.test(o.time) ? o.time.slice(0, 5) : null
  const amount = Number.isFinite(n) && n > 0 ? Math.round(n) : null
  return {
    // a model that found an amount or a date has found a movement, even if it forgot to say so
    is_payment_proof: o.is_payment_proof === true || (o.is_payment_proof === undefined && (amount !== null || date !== null)),
    direction: o.direction === 'income' || o.direction === 'expense' ? o.direction : 'unknown',
    amount,
    currency: str(o.currency, 8),
    date,
    time,
    concept: str(o.concept),
    counterparty: str(o.counterparty),
    reference: str(o.reference, 60),
    app: str(o.app, 40),
  }
}

/** Pulls the JSON object out of the model's text (it may be wrapped in a code fence or surrounded by prose). */
export function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(t) } catch { /* fall through */ }
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  return a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null
}

/** The text of a Workers AI answer, whichever shape the model uses (`response` or an OpenAI-style `choices`). */
export function textOf(out: any): string {
  if (typeof out === 'string') return out
  const r = out?.response ?? out?.result?.response ?? out?.choices?.[0]?.message?.content
  if (typeof r === 'string') return r
  // some models already return the parsed object
  return r && typeof r === 'object' ? JSON.stringify(r) : ''
}

/** `today` is YYYY-MM-DD in Colombia: it only resolves words like "hoy" or "ayer" printed in the screenshot. */
export async function extractFromImage(env: VisionEnv, image: { bytes: Uint8Array; mime: string }, today: string): Promise<Extracted> {
  const prompt = [
    'Esta imagen es una captura de pantalla que alguien envió para registrar un movimiento de dinero (probablemente de Nequi, Bancolombia, Daviplata u otra app o banco en Colombia).',
    'Extrae SOLO lo que se ve escrito en la imagen. No adivines ni completes: si un dato no aparece con claridad, usa null.',
    `Hoy es ${today} (úsalo solo para resolver palabras como "hoy" o "ayer" que aparezcan en la captura; si la captura muestra una fecha sin año, usa null en la fecha).`,
    'El valor es un número sin símbolos ni separadores de miles (en Colombia el punto separa miles: $25.000 = 25000). Si hay varios valores (por ejemplo comisión y total), usa el total del movimiento.',
    'Responde SOLO un objeto JSON, sin texto antes ni después, con exactamente estas claves:',
    '{"is_payment_proof": true si es un comprobante o movimiento de dinero, false si no,',
    ' "direction": "income" (el dueño del teléfono RECIBIÓ dinero) | "expense" (ENVIÓ o PAGÓ) | "unknown",',
    ' "amount": número o null, "currency": código ISO (COP, USD…) o null,',
    ' "date": "YYYY-MM-DD" o null, "time": "HH:MM" (24 h) o null,',
    ' "concept": para qué fue el pago (descripción/mensaje escrito en el movimiento) o null,',
    ' "counterparty": persona o negocio que envió o recibió el dinero, o null,',
    ' "reference": número de referencia/aprobación o null, "app": banco o billetera (Nequi, Bancolombia, Daviplata…) o null}',
  ].join('\n')

  const out = await env.AI.run(env.VISION_MODEL || DEFAULT_VISION_MODEL, {
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${b64(image.bytes)}` } }],
    }],
    max_tokens: 500,
    temperature: 0,
  })
  const text = textOf(out)
  if (!text) throw new Error('El modelo no devolvió texto')
  const json = parseJson(text)
  if (!json) throw new Error(`El modelo no devolvió un JSON legible: ${text.slice(0, 120)}`)
  return sanitize(json)
}
