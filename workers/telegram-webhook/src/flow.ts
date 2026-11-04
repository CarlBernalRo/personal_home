/**
 * Register a movement from a screenshot, step by step, in the chat.
 *
 * Nothing is assumed: what the screenshot says is only OFFERED (amount, date, concept) and the person confirms or
 * corrects each one; type, fixed expense / budget, category and account are always chosen by them. Every step has a
 * "Atrás". At the end nothing is registered: a `pendingMovements` document is created and the person confirms it
 * inside the app.
 *
 * The state of the conversation lives in `telegramFlows/{chatId}` (the Worker keeps nothing in memory).
 */
import { PERSONAL_CATEGORIES } from '../../../apps/web/src/shared/index'
import { fixedFor, bogotaToday } from './commands'
import type { Db } from './db'
import type { Keyboard, Telegram } from './telegram'
import { EMPTY_EXTRACTED, b64, type Extracted } from './vision'

export type Kind = 'income' | 'fixed' | 'occasional'
type Step = 'amount' | 'date' | 'kind' | 'concept' | 'fixed' | 'budget' | 'category' | 'account' | 'comment' | 'confirm'

export interface FlowData {
  amount?: number
  /** YYYY-MM-DD */
  date?: string
  kind?: Kind
  concept?: string
  category?: string
  fixedExpenseId?: string
  occMonth?: string
  fixedLabel?: string
  budgetId?: string
  budgetLabel?: string
  /** null = the person chose "sin cuenta" */
  accountId?: string | null
  accountLabel?: string
  comment?: string | null
}

export interface Flow {
  userId: string
  chatId: number
  step: Step
  history: Step[]
  /** Typing is expected for this field. */
  awaiting: 'amount' | 'date' | 'concept' | 'comment' | null
  /** The person pressed "Escribir otro/a": "Atrás" then only cancels the typing. */
  editing: boolean
  extracted: Extracted
  data: FlowData
  messageId?: number
  /** The (small) copy of the screenshot kept in `attachments`; it follows the movement or is deleted with the flow. */
  attachmentId?: string
  updatedAt: Date
}

export interface FlowDeps {
  db: Db
  tg: Telegram
  /** Clock, in ms (injected for tests). */
  now?: () => number
}

const FLOW_TTL_MS = 24 * 3600_000
const clock = (d: FlowDeps) => (d.now ? d.now() : Date.now())

// ── formatting / parsing ─────────────────────────────────────────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cop = (n: number) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const dateLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
const monthLabel = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}` }
const clip = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const validIso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))

/** "25.000", "$ 25,000", "25000", "1.234,50" → pesos (decimals are rounded away). Colombia: "." groups thousands. */
export function parseAmount(text: string): number | null {
  let t = text.replace(/[^\d.,]/g, '')
  if (!t) return null
  const lastDot = t.lastIndexOf('.')
  const lastComma = t.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // both present: the last one is the decimal mark
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.'
    const parts = t.split(sep)
    // "25.000" / "1.234.567" (groups of 3) are thousands; "25,5" / "25.50" are decimals
    t = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? parts.join('') : `${parts[0]}.${parts[1]}`
  }
  const n = Math.round(Number(t))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** "hoy", "ayer", "2026-11-02", "02/11/2026", "2/11" (year = current) → YYYY-MM-DD, or null. */
export function parseDate(text: string, today: Date): string | null {
  const t = text.trim().toLowerCase()
  if (t === 'hoy') return isoOf(today)
  if (t === 'ayer') return isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
  let y: number, m: number, d: number
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (r) { y = +r[1]; m = +r[2]; d = +r[3] } else {
    r = t.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/)
    if (!r) return null
    d = +r[1]; m = +r[2]; y = r[3] ? (r[3].length === 2 ? 2000 + +r[3] : +r[3]) : today.getFullYear()
  }
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return isoOf(date)
}

// ── persistence ──────────────────────────────────────────────────────────────────────────────────────────────────
const path = (chatId: number) => `telegramFlows/${chatId}`

async function load(d: FlowDeps, chatId: number): Promise<Flow | null> {
  const doc = await d.db.get(path(chatId))
  if (!doc) return null
  const { id: _id, ...flow } = doc as any
  const f = flow as Flow
  if (clock(d) - new Date(f.updatedAt).getTime() > FLOW_TTL_MS) { await dropFlow(d, chatId, f); return null }
  return f
}
const save = (d: FlowDeps, f: Flow) => d.db.set(path(f.chatId), { ...f, updatedAt: new Date(clock(d)) } as any)
/** Deletes the flow and the screenshot copy it was holding (when it ends without being sent). */
async function dropFlow(d: FlowDeps, chatId: number, f?: Flow | null) {
  if (f?.attachmentId) await d.db.remove(`attachments/${f.attachmentId}`).catch(() => {})
  await d.db.remove(path(chatId)).catch(() => {})
}
export async function clearFlow(d: FlowDeps, chatId: number) {
  const doc = await d.db.get(path(chatId)).catch(() => null)
  await dropFlow(d, chatId, doc as Flow | null)
}

// ── the steps ────────────────────────────────────────────────────────────────────────────────────────────────────
function stepsOf(f: Flow): Step[] {
  const head: Step[] = ['amount', 'date', 'kind']
  switch (f.data.kind) {
    case 'income': return [...head, 'concept', 'account', 'comment', 'confirm']
    case 'fixed': return [...head, 'fixed', 'account', 'comment', 'confirm']
    case 'occasional': return [...head, 'budget', ...(f.data.budgetId === 'other' ? (['concept', 'category'] as Step[]) : []), 'account', 'comment', 'confirm']
    default: return head
  }
}

/** Sets what the chat is waiting for on entering a step. */
function enter(f: Flow) {
  f.editing = false
  f.awaiting =
    f.step === 'concept' || f.step === 'comment' ? f.step
      : f.step === 'amount' && !(f.data.amount ?? f.extracted.amount) ? 'amount'
        : f.step === 'date' && !(f.data.date ?? (validIso(f.extracted.date) ? f.extracted.date : null)) ? 'date'
          : null
}
function advance(f: Flow) {
  const order = stepsOf(f)
  const next = order[order.indexOf(f.step) + 1]
  if (!next) return
  f.history.push(f.step)
  f.step = next
  enter(f)
}
function goBack(f: Flow): boolean {
  const prev = f.history.pop()
  if (!prev) return false
  f.step = prev
  enter(f)
  return true
}

const NAV: Keyboard = [[{ text: '⬅️ Atrás', data: 'f:back' }, { text: '❌ Cancelar', data: 'f:cancel' }]]
const rows = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))

/** Short recap of what is already decided, shown at the top of every step. */
function recap(f: Flow): string {
  const d = f.data
  const lines: string[] = []
  if (d.amount) lines.push(`💵 Valor: <b>${cop(d.amount)}</b>`)
  if (d.date) lines.push(`📅 Fecha: <b>${dateLabel(d.date)}</b>`)
  if (d.kind) lines.push(`🏷 Tipo: <b>${KIND_LABEL[d.kind]}</b>`)
  if (d.fixedLabel) lines.push(`📌 Gasto fijo: <b>${esc(d.fixedLabel)}</b>`)
  if (d.budgetLabel) lines.push(`🛒 Presupuesto: <b>${esc(d.budgetLabel)}</b>`)
  if (d.concept && d.kind !== 'fixed') lines.push(`📝 Concepto: <b>${esc(d.concept)}</b>`)
  if (d.category) lines.push(`🗂 Categoría: <b>${esc(PERSONAL_CATEGORIES.find((c) => c.id === d.category)?.label ?? d.category)}</b>`)
  if (d.accountId !== undefined) lines.push(`🏦 Cuenta: <b>${esc(d.accountId ? d.accountLabel : 'Sin cuenta')}</b>`)
  return lines.length ? `${lines.join('\n')}\n\n` : ''
}
const KIND_LABEL: Record<Kind, string> = { income: 'Ingreso', fixed: 'Gasto fijo', occasional: 'Gasto ocasional' }

async function render(d: FlowDeps, f: Flow): Promise<{ text: string; kb: Keyboard }> {
  const head = '📸 <b>Registrar movimiento</b>\n\n'
  const body = recap(f)
  const ex = f.extracted

  switch (f.step) {
    case 'amount': {
      const v = f.data.amount ?? ex.amount
      if (f.awaiting === 'amount' || !v) {
        return { text: `${head}${body}${v ? '' : 'No pude leer el valor con claridad.\n'}✏️ Escribe el <b>valor</b> (ej. 25000).`, kb: f.editing ? [[{ text: '⬅️ Volver', data: 'f:back' }, { text: '❌ Cancelar', data: 'f:cancel' }]] : [[{ text: '❌ Cancelar', data: 'f:cancel' }]] }
      }
      return {
        text: `${head}${body}Leí este valor: <b>${cop(v)}</b>${ex.currency && ex.currency !== 'COP' ? ` (${esc(ex.currency)})` : ''}\n¿Es correcto?`,
        kb: [[{ text: '✅ Sí, es correcto', data: 'f:ok' }, { text: '✏️ Escribir otro', data: 'f:edit' }], [{ text: '❌ Cancelar', data: 'f:cancel' }]],
      }
    }
    case 'date': {
      const v = f.data.date ?? (validIso(ex.date) ? ex.date : null)
      const quick = [{ text: 'Hoy', data: 'f:today' }, { text: 'Ayer', data: 'f:yest' }]
      if (f.awaiting === 'date' || !v) {
        return { text: `${head}${body}${v ? '' : 'No pude leer la fecha con claridad.\n'}✏️ Escribe la <b>fecha</b> (ej. 02/11/2026, hoy o ayer), o elige:`, kb: [quick, [{ text: '⬅️ Atrás', data: 'f:back' }, { text: '❌ Cancelar', data: 'f:cancel' }]] }
      }
      return {
        text: `${head}${body}Leí esta fecha: <b>${dateLabel(v)}</b>${ex.time ? ` (${esc(ex.time)})` : ''}\n¿Es correcta?`,
        kb: [[{ text: '✅ Sí, es correcta', data: 'f:ok' }, { text: '✏️ Escribir otra', data: 'f:edit' }], quick, NAV[0]],
      }
    }
    case 'kind': {
      const hint = ex.direction === 'income' ? '\n<i>La captura parece un dinero recibido.</i>' : ex.direction === 'expense' ? '\n<i>La captura parece un pago o envío.</i>' : ''
      return {
        text: `${head}${body}¿Qué tipo de movimiento es?${hint}`,
        kb: [[{ text: '💰 Ingreso', data: 'f:k:income' }], [{ text: '📌 Gasto fijo', data: 'f:k:fixed' }], [{ text: '🛒 Gasto ocasional', data: 'f:k:occasional' }], NAV[0]],
      }
    }
    case 'concept': {
      const cands = conceptCandidates(f)
      return {
        text: `${head}${body}✏️ Escribe el <b>concepto</b>${cands.length ? ' o usa uno de la captura:' : ':'}`,
        kb: [...cands.map((c, i) => [{ text: `Usar: ${clip(c)}`, data: `f:cc:${i}` }]), NAV[0]],
      }
    }
    case 'fixed': {
      const today = bogotaToday(clock(d))
      const { entries, next } = await fixedFor(d.db, f.userId, today)
      const opts = fixedOptions([...entries, ...next], f.data.date?.slice(0, 7))
      if (opts.length === 0) return { text: `${head}${body}No tienes gastos fijos pendientes de pago para asociarlo.`, kb: [NAV[0]] }
      return {
        text: `${head}${body}¿A cuál <b>gasto fijo</b> corresponde este pago?
<i>Muestro los pendientes más cercanos a la fecha.</i>`,
        kb: [...opts.map((o) => [{ text: clip(`${o.concept} · ${monthLabel(o.occMonth)} · ${cop(o.amount)}`, 48), data: `f:fx:${o.id}:${o.occMonth}` }]), NAV[0]],
      }
    }
    case 'budget': {
      const budgets = await budgetsOf(d, f.userId)
      return {
        text: `${head}${body}¿A cuál <b>gasto ocasional</b> corresponde?`,
        kb: [...budgets.map((b) => [{ text: clip(b.concept, 40), data: `f:bd:${b.id}` }]), [{ text: '➕ Otro gasto (adicional)', data: 'f:bd:other' }], NAV[0]],
      }
    }
    case 'category':
      return { text: `${head}${body}¿En qué <b>categoría</b> lo pones?`, kb: [...rows(PERSONAL_CATEGORIES.map((c) => ({ text: clip(c.label, 22), data: `f:cat:${c.id}` })), 2), NAV[0]] }
    case 'account': {
      const accounts = await accountsOf(d, f.userId)
      const effect = f.data.kind === 'income' ? 'sumará' : 'descontará'
      return {
        text: `${head}${body}¿En qué <b>cuenta</b> ${f.data.kind === 'income' ? 'lo recibiste' : 'se pagó'}?\n<i>Al confirmarlo en la app, el saldo de la cuenta se ${effect}.</i>`,
        kb: [...accounts.map((a) => [{ text: clip(a.name, 40), data: `f:acc:${a.id}` }]), [{ text: 'Sin cuenta', data: 'f:acc:none' }], NAV[0]],
      }
    }
    case 'comment':
      return { text: `${head}${body}💬 ¿Quieres agregar un <b>comentario</b>? Escríbelo, o toca Omitir.`, kb: [[{ text: 'Omitir', data: 'f:skip' }], NAV[0]] }
    case 'confirm': {
      const c = f.data.comment
      return {
        text: `${head}${body}${c ? `💬 Comentario: <b>${esc(c)}</b>\n\n` : ''}Esto <b>no se registra todavía</b>: queda pendiente para que lo confirmes dentro de la app.`,
        kb: [[{ text: '📨 Enviar a la app', data: 'f:send' }], NAV[0]],
      }
    }
  }
}

// ── data the steps list ──────────────────────────────────────────────────────────────────────────────────────────
function conceptCandidates(f: Flow): string[] {
  const out = [f.extracted.concept, f.extracted.counterparty].map((s) => (s ?? '').trim()).filter(Boolean)
  return [...new Set(out)].slice(0, 2)
}

/** Months apart (yyyy-MM vs yyyy-MM). */
const monthGap = (a: string, b: string) => Math.abs((+a.slice(0, 4) - +b.slice(0, 4)) * 12 + (+a.slice(5, 7) - +b.slice(5, 7)))

/** The unpaid occurrences, nearest to the month of the payment first (the person still picks which one). */
function fixedOptions(entries: Awaited<ReturnType<typeof fixedFor>>['entries'], paidMonth?: string) {
  const seen = new Set<string>()
  const out: { id: string; concept: string; occMonth: string; amount: number; due: number }[] = []
  for (const e of entries) {
    for (const line of e.owed) {
      const key = `${(e.fe as any).id}|${line.occMonth}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: (e.fe as any).id, concept: (e.fe as any).concept, occMonth: line.occMonth, amount: line.amount, due: e.due?.getTime() ?? 0 })
    }
  }
  return out
    .sort((a, b) => (paidMonth ? monthGap(a.occMonth, paidMonth) - monthGap(b.occMonth, paidMonth) : 0) || a.due - b.due || a.occMonth.localeCompare(b.occMonth))
    .slice(0, 8)
}

async function accountsOf(d: FlowDeps, uid: string) {
  return (await d.db.query('accounts', [{ field: 'userId', op: 'EQUAL', value: uid }])).sort((a, b) => String(a.name).localeCompare(String(b.name)))
}
async function budgetsOf(d: FlowDeps, uid: string): Promise<{ id: string; concept: string; category: string }[]> {
  const profile = await d.db.get(`users/${uid}`)
  return ((profile?.variableBudgets ?? []) as any[]).filter((b) => b && b.active !== false && b.source !== 'household-debt')
}

// ── entry points ─────────────────────────────────────────────────────────────────────────────────────────────────
async function show(d: FlowDeps, f: Flow) {
  const { text, kb } = await render(d, f)
  if (f.messageId) await d.tg.edit(f.chatId, f.messageId, text, kb)
  else f.messageId = await d.tg.send(f.chatId, text, kb)
  await save(d, f)
}

/** Biggest copy of the screenshot that is kept: it must fit comfortably in a Firestore document (1 MB, base64 adds a third). */
const MAX_KEPT_BYTES = 600_000

export interface ImageSource {
  /** Reads what the screenshot says (the sharpest copy is used for this). */
  extract: () => Promise<Extracted>
  /** The small copy to keep, or null when there is none small enough. */
  keep: () => Promise<{ bytes: Uint8Array; mime: string } | null>
}

/** A screenshot arrived from a linked chat: read it, keep a small copy, and open the flow. */
export async function startFromImage(d: FlowDeps, userId: string, chatId: number, source: ImageSource) {
  await clearFlow(d, chatId)
  const messageId = await d.tg.send(chatId, '🔍 Leyendo tu captura…')
  let extracted: Extracted = EMPTY_EXTRACTED
  let note = ''
  const [read, kept] = await Promise.allSettled([source.extract(), source.keep()])
  if (read.status === 'fulfilled') {
    extracted = read.value
    if (!extracted.is_payment_proof) note = '⚠️ No parece un comprobante de pago: revisa cada dato.\n\n'
  } else {
    console.error(read.reason)
    note = '⚠️ No pude leer la captura, pero podemos registrarlo escribiendo los datos.\n\n'
  }
  let attachmentId: string | undefined
  if (kept.status === 'fulfilled' && kept.value && kept.value.bytes.length <= MAX_KEPT_BYTES) {
    try {
      attachmentId = await d.db.add('attachments', {
        userId, source: 'telegram', mime: kept.value.mime, size: kept.value.bytes.length, data: b64(kept.value.bytes), createdAt: new Date(clock(d)),
      })
    } catch (e) { console.error(e) }
  } else if (kept.status === 'fulfilled' && !kept.value) {
    note += '📎 No guardé la imagen porque pesa mucho. Envíala como <b>foto</b> (no como archivo) para guardarla.\n\n'
  }
  const flow: Flow = { userId, chatId, step: 'amount', history: [], awaiting: null, editing: false, extracted, data: {}, messageId, attachmentId, updatedAt: new Date(clock(d)) }
  enter(flow)
  const { text, kb } = await render(d, flow)
  await d.tg.edit(chatId, messageId, note + text, kb)
  await save(d, flow)
}

/** A pressed button. Returns false when the message no longer belongs to an active flow. */
export async function onCallback(d: FlowDeps, userId: string, cb: { id: string; chatId: number; messageId: number; data: string }): Promise<void> {
  const f = await load(d, cb.chatId)
  if (!f || f.userId !== userId || f.messageId !== cb.messageId) {
    await d.tg.answer(cb.id, 'Este registro ya no está activo')
    await d.tg.edit(cb.chatId, cb.messageId, 'Este registro ya no está activo. Envía la captura otra vez para empezar de nuevo.', []).catch(() => {})
    return
  }
  const [, action, a, b] = cb.data.split(':')
  const today = bogotaToday(clock(d))
  const d0 = f.data
  let notice: string | undefined

  switch (action) {
    case 'cancel':
      await d.tg.answer(cb.id)
      await clearFlow(d, f.chatId)
      await d.tg.edit(f.chatId, cb.messageId, '❌ Cancelado. No se guardó nada.', [])
      return
    case 'back':
      if (f.editing) { f.editing = false; f.awaiting = null } else if (!goBack(f)) { await d.tg.answer(cb.id, 'Ya estás en el primer paso'); return }
      break
    case 'edit':
      if (f.step === 'amount' || f.step === 'date') { f.awaiting = f.step; f.editing = true }
      break
    case 'ok': {
      if (f.step === 'amount') { const v = d0.amount ?? f.extracted.amount; if (!v || v <= 0) return; d0.amount = Math.round(v); advance(f) }
      else if (f.step === 'date') { const v = d0.date ?? f.extracted.date; if (!validIso(v)) return; d0.date = v; advance(f) }
      break
    }
    case 'today': case 'yest':
      if (f.step === 'date') { d0.date = isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (action === 'yest' ? 1 : 0))); advance(f) }
      break
    case 'k': {
      if (f.step !== 'kind' || !['income', 'fixed', 'occasional'].includes(a)) break
      if (d0.kind !== a) {
        // another type: what belonged to the previous one no longer applies
        delete d0.concept; delete d0.category; delete d0.fixedExpenseId; delete d0.occMonth; delete d0.fixedLabel
        delete d0.budgetId; delete d0.budgetLabel; delete d0.accountId; delete d0.accountLabel
      }
      d0.kind = a as Kind
      advance(f)
      break
    }
    case 'cc': {
      const c = conceptCandidates(f)[Number(a)]
      if (f.step === 'concept' && c) { d0.concept = c; advance(f) }
      break
    }
    case 'fx': {
      if (f.step !== 'fixed') break
      const { entries, next } = await fixedFor(d.db, f.userId, today)
      const o = fixedOptions([...entries, ...next], d0.date?.slice(0, 7)).find((x) => x.id === a && x.occMonth === b)
      if (!o) { notice = 'Esa opción ya no está disponible'; break }
      d0.fixedExpenseId = o.id; d0.occMonth = o.occMonth; d0.fixedLabel = `${o.concept} · ${monthLabel(o.occMonth)}`; d0.concept = o.concept
      advance(f)
      break
    }
    case 'bd': {
      if (f.step !== 'budget') break
      if (a === 'other') { d0.budgetId = 'other'; delete d0.budgetLabel; delete d0.concept; delete d0.category }
      else {
        const bd = (await budgetsOf(d, f.userId)).find((x) => x.id === a)
        if (!bd) { notice = 'Esa opción ya no está disponible'; break }
        d0.budgetId = bd.id; d0.budgetLabel = bd.concept; d0.concept = bd.concept; d0.category = bd.category
      }
      advance(f)
      break
    }
    case 'cat':
      if (f.step === 'category' && PERSONAL_CATEGORIES.some((c) => c.id === a)) { d0.category = a; advance(f) }
      break
    case 'acc': {
      if (f.step !== 'account') break
      if (a === 'none') { d0.accountId = null; delete d0.accountLabel }
      else {
        const acc = (await accountsOf(d, f.userId)).find((x) => x.id === a)
        if (!acc) { notice = 'Esa cuenta ya no está disponible'; break }
        d0.accountId = acc.id; d0.accountLabel = acc.name
      }
      advance(f)
      break
    }
    case 'skip':
      if (f.step === 'comment') { d0.comment = null; advance(f) }
      break
    case 'send':
      if (f.step === 'confirm') { await d.tg.answer(cb.id); await send(d, f); return }
      break
  }
  await d.tg.answer(cb.id, notice)
  await show(d, f)
}

/** Typed text. Returns false when there is no flow waiting for it (so the caller can answer as usual). */
export async function onText(d: FlowDeps, userId: string, chatId: number, text: string): Promise<boolean> {
  const f = await load(d, chatId)
  if (!f || f.userId !== userId) return false
  const today = bogotaToday(clock(d))
  const t = text.trim()

  if (!f.awaiting) { await d.tg.send(chatId, 'Usa los botones del mensaje de arriba, o escribe /cancelar para empezar de nuevo.'); return true }

  if (f.awaiting === 'amount') {
    const v = parseAmount(t)
    if (!v) { await d.tg.send(chatId, 'No entendí ese valor. Escríbelo solo con números, por ejemplo 25000.'); return true }
    f.data.amount = v
    advance(f)
  } else if (f.awaiting === 'date') {
    const v = parseDate(t, today)
    if (!v) { await d.tg.send(chatId, 'No entendí esa fecha. Prueba con 02/11/2026, 2026-11-02, hoy o ayer.'); return true }
    f.data.date = v
    advance(f)
  } else if (f.awaiting === 'concept') {
    if (!t || t.length > 80) { await d.tg.send(chatId, 'Escribe un concepto de hasta 80 caracteres.'); return true }
    f.data.concept = t
    advance(f)
  } else if (f.awaiting === 'comment') {
    if (t.length > 300) { await d.tg.send(chatId, 'El comentario puede tener hasta 300 caracteres.'); return true }
    f.data.comment = t
    advance(f)
  }
  await show(d, f)
  return true
}

/** Creates the pending movement (nothing is registered yet) and closes the flow. */
async function send(d: FlowDeps, f: Flow) {
  const x = f.data
  const missing =
    !x.amount ? 'el valor' : !x.date ? 'la fecha' : !x.kind ? 'el tipo' : x.accountId === undefined ? 'la cuenta'
      : x.kind === 'fixed' && !x.fixedExpenseId ? 'el gasto fijo'
        : x.kind === 'occasional' && !x.budgetId ? 'el presupuesto'
          : x.kind !== 'fixed' && !x.concept ? 'el concepto'
            : x.kind === 'occasional' && x.budgetId === 'other' && !x.category ? 'la categoría' : ''
  if (missing) { await d.tg.edit(f.chatId, f.messageId!, `Falta ${missing}. Usa ⬅️ Atrás para completarlo.`, NAV); return }

  const [y, m, dd] = x.date!.split('-').map(Number)
  await d.db.add('pendingMovements', {
    userId: f.userId,
    kind: x.kind,
    amount: x.amount,
    // midnight in Colombia (UTC-5), like the dates the app writes
    date: new Date(Date.UTC(y, m - 1, dd, 5, 0, 0)),
    concept: x.concept ?? '',
    category: x.category,
    fixedExpenseId: x.fixedExpenseId,
    occMonth: x.occMonth,
    budgetId: x.budgetId && x.budgetId !== 'other' ? x.budgetId : undefined,
    accountId: x.accountId ?? undefined,
    comment: x.comment ?? undefined,
    source: 'telegram',
    status: 'pending',
    read: { amount: f.extracted.amount, date: f.extracted.date, concept: f.extracted.concept, counterparty: f.extracted.counterparty, reference: f.extracted.reference, app: f.extracted.app },
    attachmentId: f.attachmentId,
    createdAt: new Date(clock(d)),
  })
  await d.db.remove(path(f.chatId)).catch(() => {})
  const pending = (await d.db.query('pendingMovements', [{ field: 'userId', op: 'EQUAL', value: f.userId }])).filter((p) => p.status === 'pending').length
  await d.tg.edit(
    f.chatId, f.messageId!,
    `✅ <b>Enviado a la app.</b>\n\n${recap(f)}Queda <b>pendiente por confirmar</b>: ábrela y confírmalo para que se registre. Tienes ${pending} movimiento${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'}.`,
    [],
  )
}
