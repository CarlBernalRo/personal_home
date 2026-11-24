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
import { HOUSEHOLD_DEBT_CATEGORIES, PERSONAL_CATEGORIES, creditorOf, inPaymentOrder, isPendingDebt, remainingOf, resolveExpenseShares, settleExpenseContributions } from '../../../apps/web/src/shared/index'
import { fixedFor, bogotaToday, households } from './commands'
import type { Db } from './db'
import type { Keyboard, Telegram } from './telegram'
import { EMPTY_EXTRACTED, b64, type Extracted } from './vision'

/**
 * `received`: someone of a household (a member or a guest) paid the user — their abono, the money into the user's account.
 * `shared`: a shared household expense, split and settled exactly like the app's "Nuevo gasto compartido".
 */
export type Kind = 'income' | 'fixed' | 'occasional' | 'abono' | 'received' | 'shared'
type Step = 'amount' | 'date' | 'kind' | 'family' | 'concept' | 'fixed' | 'budget' | 'category' | 'tags' | 'household' | 'creditor' | 'target'
  | 'debtor' | 'rtarget' | 'hcategory' | 'participants' | 'split' | 'shares' | 'payers' | 'payamounts' | 'due'
  | 'account' | 'comment' | 'confirm'
type SplitMode = 'equal' | 'percentage' | 'fixed'
const SPLIT_LABEL: Record<SplitMode, string> = { equal: 'partes iguales', percentage: 'por porcentaje', fixed: 'montos fijos' }

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
  /** Abono to a household: where, to whom and which debt ('auto' = spread it, oldest first). */
  householdId?: string
  householdLabel?: string
  creditorId?: string
  creditorLabel?: string
  targetDebtId?: string
  targetLabel?: string
  /** The chosen household's people (the user as "Tú"), so every step can name them without reading it again. */
  memberNames?: Record<string, string>
  guestIds?: string[]
  /** Payment received in a household: who paid the user. */
  debtorId?: string
  debtorLabel?: string
  /** Shared household expense: among whom (in order), how, the typed values (same order), who paid and how much each. */
  participants?: string[]
  splitMode?: SplitMode
  shareValues?: number[]
  payers?: string[]
  payerAmounts?: number[]
  /** YYYY-MM-DD; null = no agreed date */
  dueDate?: string | null
  /** Money sent to / received from a family member: who (null = the person said it wasn't family). */
  familyWith?: string | null
  familyName?: string
  /** Tags of an additional expense (fixed and occasional ones carry their own, set in the app). */
  tagIds?: string[]
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
  awaiting: 'amount' | 'date' | 'concept' | 'comment' | 'shares' | 'payamounts' | 'due' | null
  /** The person pressed "Escribir otro/a": "Atrás" then only cancels the typing. */
  editing: boolean
  extracted: Extracted
  data: FlowData
  messageId?: number
  /** The (small) copy of the screenshot kept in `attachments`; it follows the movement or is deleted with the flow. */
  attachmentId?: string
  /** The person's family (the other members), read when the flow starts: a transfer with one of them reaches them too. */
  family?: { id: string; myName: string; members: { uid: string; name: string }[] } | null
  /** The person's tags, read when the flow starts (buttons point to them by position, to keep callback data short). */
  tags?: { id: string; name: string }[]
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
  // with a family, money that comes in or goes out may be a transfer with one of them
  const fam: Step[] = f.family?.members.length ? ['family'] : []
  switch (f.data.kind) {
    case 'income': return [...head, ...fam, ...(f.data.familyWith ? [] : (['concept'] as Step[])), 'account', 'comment', 'confirm']
    case 'fixed': return [...head, 'fixed', 'account', 'comment', 'confirm']
    case 'abono': return [...head, 'household', 'creditor', 'target', 'account', 'comment', 'confirm']
    // a payment between any two people of the household: the account is only asked when the user's money moves
    case 'received': return [...head, 'household', 'debtor', 'creditor', 'rtarget', ...(f.data.debtorId === f.userId || f.data.creditorId === f.userId ? (['account'] as Step[]) : []), 'comment', 'confirm']
    case 'shared': {
      const d = f.data
      return [
        ...head, 'household', 'concept', 'hcategory', 'participants', 'split',
        ...(d.splitMode && d.splitMode !== 'equal' ? (['shares'] as Step[]) : []),
        'payers',
        ...((d.payers?.length ?? 0) > 1 ? (['payamounts'] as Step[]) : []),
        // the account only matters for the user's own part
        ...(d.payers?.includes(f.userId) ? (['account'] as Step[]) : []),
        'due', 'comment', 'confirm',
      ]
    }
    // an expense of its own (not a budget's) can carry tags, like in the app; only asked when the person has some
    case 'occasional': return [...head, ...fam, ...(f.data.familyWith ? [] : (['budget', ...(f.data.budgetId === 'other' ? (['concept', 'category', ...(f.tags?.length ? ['tags'] : [])] as Step[]) : [])] as Step[])), 'account', 'comment', 'confirm']
    default: return head
  }
}

/** Sets what the chat is waiting for on entering a step. */
function enter(f: Flow) {
  f.editing = false
  f.awaiting =
    f.step === 'concept' || f.step === 'comment' || f.step === 'shares' || f.step === 'payamounts' || f.step === 'due' ? f.step
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
  if (d.familyWith && d.familyName) lines.push(`💞 ${d.kind === 'income' ? 'Te lo envió' : 'Se lo enviaste a'}: <b>${esc(d.familyName)}</b> (familia)`)
  if (d.fixedLabel) lines.push(`📌 Gasto fijo: <b>${esc(d.fixedLabel)}</b>`)
  if (d.budgetLabel) lines.push(`🛒 Presupuesto: <b>${esc(d.budgetLabel)}</b>`)
  if (d.householdLabel) lines.push(`🏠 Hogar: <b>${esc(d.householdLabel)}</b>`)
  if (d.kind === 'received') {
    if (d.debtorLabel) lines.push(`🙋 Paga: <b>${esc(d.debtorLabel)}</b>`)
    if (d.creditorLabel) lines.push(`➡️ Recibe: <b>${esc(d.creditorLabel)}</b>`)
  } else if (d.creditorLabel) lines.push(`🙋 Le pagas a: <b>${esc(d.creditorLabel)}</b>`)
  if (d.targetDebtId) lines.push(`🎯 Va a: <b>${esc(d.targetDebtId === 'auto' ? 'sus deudas, la más antigua primero' : d.targetLabel)}</b>`)
  if (d.concept && d.kind !== 'fixed' && d.kind !== 'abono' && d.kind !== 'received') lines.push(`📝 Concepto: <b>${esc(d.concept)}</b>`)
  if (d.category) lines.push(`🗂 Categoría: <b>${esc((d.kind === 'shared' ? HOUSEHOLD_DEBT_CATEGORIES : PERSONAL_CATEGORIES).find((c) => c.id === d.category)?.label ?? d.category)}</b>`)
  if (d.kind === 'shared') {
    const who = (uid: string) => d.memberNames?.[uid] ?? 'alguien'
    if (d.participants?.length && d.splitMode) {
      const values = d.splitMode !== 'equal' && d.shareValues?.length === d.participants.length ? d.shareValues : null
      const list = d.participants.map((u, i) => `${who(u)}${values ? ` ${d.splitMode === 'percentage' ? `${values[i]}%` : cop(values[i])}` : ''}`).join(', ')
      lines.push(`👥 Entre: <b>${esc(list)}</b> (${SPLIT_LABEL[d.splitMode]})`)
    }
    if (d.payers?.length && (d.payers.length === 1 || d.payerAmounts?.length === d.payers.length)) {
      lines.push(`💳 Pagó: <b>${esc(d.payers.map((u, i) => (d.payers!.length > 1 ? `${who(u)} ${cop(d.payerAmounts![i])}` : who(u))).join(', '))}</b>`)
    }
    if (d.dueDate !== undefined) lines.push(`⏰ Fecha acordada: <b>${d.dueDate ? dateLabel(d.dueDate) : 'sin fecha'}</b>`)
  }
  const tagNames = (d.tagIds ?? []).map((id) => f.tags?.find((t) => t.id === id)?.name).filter(Boolean)
  if (tagNames.length) lines.push(`🔖 Etiquetas: <b>${esc(tagNames.join(', '))}</b>`)
  // a shared expense the user put nothing into moves none of their accounts
  const noOwnMoney = (d.kind === 'shared' && !d.payers?.includes(f.userId)) || (d.kind === 'received' && !!d.creditorId && d.debtorId !== f.userId && d.creditorId !== f.userId)
  if (d.accountId !== undefined && !noOwnMoney) lines.push(`🏦 Cuenta: <b>${esc(d.accountId ? d.accountLabel : 'Sin cuenta')}</b>`)
  return lines.length ? `${lines.join('\n')}\n\n` : ''
}
const KIND_LABEL: Record<Kind, string> = { income: 'Ingreso', fixed: 'Gasto fijo', occasional: 'Gasto ocasional', abono: 'Abono al hogar', received: 'Pago de una deuda del hogar', shared: 'Gasto compartido del hogar' }

/** Who pays in a household payment: the user in an abono, whoever was chosen in a payment between any two people. */
const payerOf = (f: Flow) => (f.data.kind === 'received' ? f.data.debtorId : f.userId)
/** "Tú" for the user, the household's name for anyone else (guests marked). */
const personLabel = (f: Flow, uid: string, name: string) => (uid === f.userId ? 'Tú' : `${name}${(f.data.guestIds ?? []).includes(uid) ? ' (invitado)' : ''}`)

/** The shares and who owes whom, with the very functions the app uses to write them (null + reason when it can't be split). */
function sharedPreview(f: Flow): { shares: { memberId: string; amount: number }[]; edges: { debtor: string; creditor: string; amount: number }[] } | { error: string } {
  const d = f.data
  const parts = d.participants ?? []
  if (!d.amount || parts.length === 0 || !d.splitMode) return { error: 'Faltan datos del reparto.' }
  try {
    const shares = resolveExpenseShares(d.amount, parts[0], d.splitMode, parts.map((m, i) => ({
      memberId: m,
      percentage: d.splitMode === 'percentage' ? d.shareValues?.[i] ?? 0 : undefined,
      fixedAmount: d.splitMode === 'fixed' ? d.shareValues?.[i] ?? 0 : undefined,
    })))
    const payers = payersOf(d)
    const edges = settleExpenseContributions(shares.map((s) => ({ memberId: s.memberId, amount: s.amount })), payers)
    return { shares, edges }
  } catch (e: any) {
    return { error: e?.message ?? 'No se pudo calcular la división.' }
  }
}
/** Why the typed shares can't split the expense (null when they can). */
function sharedPreviewShares(f: Flow): string | null {
  const d = f.data
  const parts = d.participants ?? []
  try {
    resolveExpenseShares(d.amount ?? 0, parts[0], d.splitMode ?? 'equal', parts.map((m, i) => ({
      memberId: m,
      percentage: d.splitMode === 'percentage' ? d.shareValues?.[i] ?? 0 : undefined,
      fixedAmount: d.splitMode === 'fixed' ? d.shareValues?.[i] ?? 0 : undefined,
    })))
    return null
  } catch (e: any) {
    return e?.message ?? 'No se pudo dividir así.'
  }
}

/** In a payment between two people the account is only asked when the user's money moves (they pay or receive). */
function syncAccountAsk(f: Flow) {
  const d = f.data
  if (d.debtorId === f.userId || d.creditorId === f.userId) { if (d.accountId === null) delete d.accountId }
  else { d.accountId = null; delete d.accountLabel }
}

/** What belonged to one household's choice (who paid, the split…) no longer applies to another one. */
function clearHouseholdChoices(d: FlowData) {
  delete d.debtorId; delete d.debtorLabel
  delete d.participants; delete d.splitMode; delete d.shareValues; delete d.payers; delete d.payerAmounts; delete d.dueDate
}
const payersOf = (d: FlowData) => (d.payers ?? []).map((m, i) => ({ memberId: m, amount: d.payers!.length === 1 ? d.amount ?? 0 : d.payerAmounts?.[i] ?? 0 }))

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
      let hint = ex.direction === 'income' ? '\n<i>La captura parece un dinero recibido.</i>' : ex.direction === 'expense' ? '\n<i>La captura parece un pago o envío.</i>' : ''
      // the screenshot names someone of the household: it may be an abono (only a hint, the person decides)
      const who = await memberNamed(d, f)
      if (who) {
        const tag = `<b>${esc(who.name)}</b>${who.guest ? ' (invitado)' : ''}, de tu hogar «${esc(who.household)}»`
        hint += ex.direction === 'income'
          ? `\n<i>Menciona a ${tag}: puede ser un pago que te hizo en el hogar.</i>`
          : `\n<i>Menciona a ${tag}: puede ser el pago de una deuda del hogar o un gasto compartido.</i>`
      }
      return {
        text: `${head}${body}¿Qué tipo de movimiento es?${hint}`,
        kb: [
          [{ text: '💰 Ingreso', data: 'f:k:income' }], [{ text: '📌 Gasto fijo', data: 'f:k:fixed' }], [{ text: '🛒 Gasto ocasional', data: 'f:k:occasional' }],
          [{ text: '🤝 Pago de una deuda del hogar (quién paga a quién)', data: 'f:k:received' }],
          [{ text: '👥 Gasto compartido del hogar', data: 'f:k:shared' }], NAV[0],
        ],
      }
    }
    case 'family': {
      const income = f.data.kind === 'income'
      // the screenshot names one of them: only a hint, the person decides
      const text = plain(`${f.extracted.counterparty ?? ''} ${f.extracted.concept ?? ''}`)
      const named = (f.family?.members ?? []).find((m) => { const first = plain(m.name).split(/\s+/)[0]; return first.length >= 3 && text.includes(first) })
      return {
        text: `${head}${body}${income ? '¿Te lo envió alguien de tu <b>familia</b>?' : '¿Es una transferencia a alguien de tu <b>familia</b>?'}\n<i>Si es así, a esa persona le llega en su app para confirmarlo, con esta misma captura: no tiene que registrarlo.</i>${named ? `\n<i>La captura menciona a <b>${esc(named.name)}</b>.</i>` : ''}`,
        kb: [...(f.family?.members ?? []).map((m) => [{ text: `💞 ${clip(m.name, 30)}`, data: `f:fam:${m.uid}` }]), [{ text: income ? 'No, de otra persona' : 'No, es otro gasto', data: 'f:fam:none' }], NAV[0]],
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
    case 'tags': {
      const chosen = new Set(f.data.tagIds ?? [])
      return {
        text: `${head}${body}🔖 ¿Le pones <b>etiquetas</b>? Toca las que quieras (puedes elegir varias o ninguna) y luego continúa.`,
        kb: [
          ...rows((f.tags ?? []).map((t, i) => ({ text: `${chosen.has(t.id) ? '✅' : '▫️'} ${clip(t.name, 20)}`, data: `f:tg:${i}` })), 2),
          [{ text: chosen.size ? `➡️ Continuar (${chosen.size})` : '➡️ Continuar sin etiquetas', data: 'f:tg:done' }],
          NAV[0],
        ],
      }
    }
    case 'household': {
      const hhs = await households(d.db, f.userId)
      if (hhs.length === 0) return { text: `${head}${body}No perteneces a ningún hogar todavía, así que no puedo registrar esto en un hogar.`, kb: [NAV[0]] }
      const question = f.data.kind === 'received' ? '¿En cuál <b>hogar</b> te pagaron?' : f.data.kind === 'shared' ? '¿De cuál <b>hogar</b> es el gasto?' : '¿A cuál <b>hogar</b> le abonas?'
      return {
        text: `${head}${body}${question}`,
        kb: [...hhs.map(({ h, members }) => [{ text: clip(`${h.name} · ${members.length} personas`, 40), data: `f:hh:${h.id}` }]), NAV[0]],
      }
    }
    case 'creditor': {
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === f.data.householdId)
      if (!hh) return { text: `${head}${body}Ese hogar ya no está disponible.`, kb: [NAV[0]] }
      const payer = payerOf(f) ?? f.userId
      const mine = payer === f.userId
      // whom the payer really has to pay, once everything is set against each other (the same plan the app shows)
      const owed = new Map((hh.person(payer)?.pays ?? []).map((l) => [l.to, l.amount]))
      const others = hh.members.filter((m) => m !== payer).sort((a, b) => (owed.get(b) ?? 0) - (owed.get(a) ?? 0))
      return {
        text: `${head}${body}${mine ? '¿A quién le pagaste?' : `¿A quién le pagó <b>${esc(f.data.debtorLabel)}</b>?`}`,
        kb: [...others.map((m) => [{ text: clip(`${personLabel(f, m, hh.name(m))}${owed.get(m) ? ` · ${mine ? 'le debes' : 'le debe'} ${cop(owed.get(m)!)}` : ''}`, 46), data: `f:cr:${m}` }]), NAV[0]],
      }
    }
    case 'target': {
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === f.data.householdId)
      if (!hh) return { text: `${head}${body}Ese hogar ya no está disponible.`, kb: [NAV[0]] }
      // a household that crossed its accounts pays as the plan says: an abono never goes to one debt on its own
      if ((hh.h as any).settlementPlan || (hh.h as any).payMode === 'plan') {
        return {
          text: `${head}${body}Este hogar ya <b>cruzó las cuentas</b>: el abono cuenta como pago del plan, no para una deuda suelta.`,
          kb: [[{ text: '➡️ Continuar', data: 'f:td:auto' }], NAV[0]],
        }
      }
      const debts = inPaymentOrder((hh.debts as any[]).filter((x) => x.debtor === f.userId && isPendingDebt(x) && creditorOf(x, hh.members) === f.data.creditorId))
      const total = debts.reduce((s, x) => s + remainingOf(x), 0)
      const amount = f.data.amount ?? 0
      const note = debts.length === 0
        ? `No le debes nada registrado a <b>${esc(f.data.creditorLabel)}</b>: el abono quedará como un pago general.`
        : `Le debes <b>${cop(total)}</b> en ${debts.length} deuda${debts.length === 1 ? '' : 's'}.${amount > total ? ` Tu abono (${cop(amount)}) es mayor: lo que sobre quedará como pago general.` : ''}`
      return {
        text: `${head}${body}${note}\n¿A qué deuda va el abono?`,
        kb: [
          [{ text: debts.length ? '🔀 Repartir entre sus deudas (la más antigua primero)' : '➡️ Continuar', data: 'f:td:auto' }],
          ...debts.slice(0, 8).map((x) => [{ text: clip(`${x.concept} · ${cop(remainingOf(x))}`, 48), data: `f:td:${x.id}` }]),
          NAV[0],
        ],
      }
    }
    case 'debtor': {
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === f.data.householdId)
      if (!hh) return { text: `${head}${body}Ese hogar ya no está disponible.`, kb: [NAV[0]] }
      if (hh.members.length < 2) return { text: `${head}${body}En este hogar solo estás tú.`, kb: [NAV[0]] }
      // anyone can pay: what each one still owes overall (the same plan the app shows), whoever owes most first
      const owes = (m: string) => (hh.person(m)?.pays ?? []).reduce((s, l) => s + l.amount, 0)
      const people = [...hh.members].sort((a, b) => owes(b) - owes(a))
      return {
        text: `${head}${body}¿<b>Quién paga</b>? Luego eliges a quién.`,
        kb: [...people.map((m) => [{ text: clip(`${personLabel(f, m, hh.name(m))}${owes(m) ? ` · ${m === f.userId ? 'debes' : 'debe'} ${cop(owes(m))}` : ''}`, 46), data: `f:db:${m}` }]), NAV[0]],
      }
    }
    case 'rtarget': {
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === f.data.householdId)
      if (!hh) return { text: `${head}${body}Ese hogar ya no está disponible.`, kb: [NAV[0]] }
      const who = esc(f.data.debtorLabel)
      const toWhom = f.data.creditorId === f.userId ? 'ti' : esc(f.data.creditorLabel)
      const owe = f.data.debtorId === f.userId ? 'le debes' : 'le debe'
      if ((hh.h as any).settlementPlan || (hh.h as any).payMode === 'plan') {
        return {
          text: `${head}${body}Este hogar ya <b>cruzó las cuentas</b>: el pago cuenta como pago del plan, no para una deuda suelta.`,
          kb: [[{ text: '➡️ Continuar', data: 'f:rt:auto' }], NAV[0]],
        }
      }
      const debts = inPaymentOrder((hh.debts as any[]).filter((x) => x.debtor === f.data.debtorId && isPendingDebt(x) && creditorOf(x, hh.members) === f.data.creditorId))
      const total = debts.reduce((s, x) => s + remainingOf(x), 0)
      const amount = f.data.amount ?? 0
      const note = debts.length === 0
        ? `${who} no ${owe} nada registrado a ${toWhom}: el pago quedará como un pago general a favor de quien paga.`
        : `${who} ${owe} <b>${cop(total)}</b> a ${toWhom} en ${debts.length} deuda${debts.length === 1 ? '' : 's'}.${amount > total ? ` El pago (${cop(amount)}) es mayor: lo que sobre quedará a favor de quien paga.` : ''}`
      return {
        text: `${head}${body}${note}\n¿A qué deuda va el pago?`,
        kb: [
          [{ text: debts.length ? '🔀 Repartir entre sus deudas (la más antigua primero)' : '➡️ Continuar', data: 'f:rt:auto' }],
          ...debts.slice(0, 8).map((x) => [{ text: clip(`${x.concept} · ${cop(remainingOf(x))}`, 48), data: `f:rt:${x.id}` }]),
          NAV[0],
        ],
      }
    }
    case 'hcategory':
      return { text: `${head}${body}¿En qué <b>categoría</b> del hogar lo pones?`, kb: [...rows(HOUSEHOLD_DEBT_CATEGORIES.map((c) => ({ text: clip(c.label, 22), data: `f:hc:${c.id}` })), 2), NAV[0]] }
    case 'participants':
    case 'payers': {
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === f.data.householdId)
      if (!hh) return { text: `${head}${body}Ese hogar ya no está disponible.`, kb: [NAV[0]] }
      const isPart = f.step === 'participants'
      const chosen = new Set((isPart ? f.data.participants : f.data.payers) ?? [])
      const guests: string[] = (hh.h as any).guestIds ?? []
      const label = (m: string) => `${m === f.userId ? 'Tú' : hh.name(m)}${guests.includes(m) ? ' (invitado)' : ''}`
      const code = isPart ? 'pt' : 'py'
      return {
        text: isPart
          ? `${head}${body}👥 ¿Entre quiénes se <b>divide</b>? Toca para quitar o poner a cada persona y luego continúa.`
          : `${head}${body}💳 ¿Quién <b>puso el dinero</b>? Puede ser más de una persona.\n<i>Si alguien con cuenta en la app (no un invitado) puso dinero, su aporte queda por confirmar en su app: hasta que lo acepte nadie le debe nada, igual que en la app.</i>`,
        kb: [
          ...rows(hh.members.map((m, i) => ({ text: `${chosen.has(m) ? '✅' : '▫️'} ${clip(label(m), 20)}`, data: `f:${code}:${i}` })), 2),
          [{ text: chosen.size ? `➡️ Continuar (${chosen.size})` : '⚠️ Elige al menos a una persona', data: `f:${code}:done` }],
          NAV[0],
        ],
      }
    }
    case 'split':
      return {
        text: `${head}${body}¿Cómo se <b>divide</b>?`,
        kb: [[{ text: '⚖️ Partes iguales', data: 'f:sp:equal' }], [{ text: '% Por porcentaje', data: 'f:sp:percentage' }], [{ text: '💵 Montos fijos', data: 'f:sp:fixed' }], NAV[0]],
      }
    case 'shares': {
      const names = (f.data.participants ?? []).map((u) => f.data.memberNames?.[u] ?? 'alguien')
      const pct = f.data.splitMode === 'percentage'
      const example = pct ? names.map((_, i) => (i === 0 ? 100 - 10 * (names.length - 1) : 10)).join(' ') : names.map(() => Math.floor((f.data.amount ?? 0) / names.length)).join(' ')
      return {
        text: `${head}${body}✏️ Escribe ${pct ? 'el <b>porcentaje</b>' : 'el <b>monto</b>'} de cada uno, separados por espacios, en este orden:\n<b>${esc(names.join(', '))}</b>\n${pct ? 'Deben sumar 100.' : `Deben sumar ${cop(f.data.amount ?? 0)}.`} Ej.: <code>${example}</code>`,
        kb: [NAV[0]],
      }
    }
    case 'payamounts': {
      const names = (f.data.payers ?? []).map((u) => f.data.memberNames?.[u] ?? 'alguien')
      return {
        text: `${head}${body}✏️ Escribe <b>cuánto puso</b> cada uno, separados por espacios, en este orden:\n<b>${esc(names.join(', '))}</b>\nDeben sumar ${cop(f.data.amount ?? 0)}.`,
        kb: [NAV[0]],
      }
    }
    case 'due':
      return {
        text: `${head}${body}⏰ ¿Hay una <b>fecha acordada</b> para pagar las partes? Escríbela (ej. 30/11/2026) o toca Sin fecha.`,
        kb: [[{ text: 'Sin fecha acordada', data: 'f:due:none' }], NAV[0]],
      }
    case 'account': {
      const accounts = await accountsOf(d, f.userId)
      const moneyIn = f.data.kind === 'income' || (f.data.kind === 'received' && f.data.creditorId === f.userId)
      const effect = moneyIn ? 'sumará' : 'descontará'
      const myPart = f.data.kind === 'shared' ? payersOf(f.data).find((p) => p.memberId === f.userId)?.amount ?? 0 : 0
      const question = moneyIn ? 'lo recibiste' : f.data.kind === 'shared' ? `salió tu parte (${cop(myPart)})` : 'se pagó'
      return {
        text: `${head}${body}¿En qué <b>cuenta</b> ${question}?\n<i>Al confirmarlo en la app, el saldo de la cuenta se ${effect}.</i>`,
        kb: [...accounts.map((a) => [{ text: clip(a.name, 40), data: `f:acc:${a.id}` }]), [{ text: 'Sin cuenta', data: 'f:acc:none' }], NAV[0]],
      }
    }
    case 'comment':
      return { text: `${head}${body}💬 ¿Quieres agregar un <b>comentario</b>? Escríbelo, o toca Omitir.`, kb: [[{ text: 'Omitir', data: 'f:skip' }], NAV[0]] }
    case 'confirm': {
      const c = f.data.comment
      let extra = ''
      if (f.data.kind === 'shared') {
        // what will be written, worked out with the same functions the app uses
        const p = sharedPreview(f)
        const who = (u: string) => f.data.memberNames?.[u] ?? 'alguien'
        if ('error' in p) extra = `⚠️ ${esc(p.error)} Usa ⬅️ Atrás para corregirlo.\n\n`
        else {
          const owes = p.edges.length ? p.edges.map((e) => `• ${e.debtor === f.userId ? "Tú le debes" : `${esc(who(e.debtor))} le debe`} ${cop(e.amount)} a ${e.creditor === f.userId ? "ti" : esc(who(e.creditor))}`).join('\n') : '• Nadie le queda debiendo a nadie.'
          const waiting = (f.data.payers ?? []).filter((u) => u !== f.userId && !(f.data.guestIds ?? []).includes(u))
          extra = `<b>Así queda:</b>\n${owes}\n${waiting.length ? `<i>El aporte de ${esc(waiting.map(who).join(', '))} queda por confirmar en su app; sus deudas aparecen cuando lo acepte.</i>\n` : ''}\n`
        }
      } else if (f.data.kind === 'received') {
        const x = f.data
        const guestTo = (x.guestIds ?? []).includes(x.creditorId ?? '')
        extra = x.debtorId === f.userId
          ? `<i>Es tu abono: sale de tu cuenta${x.accountId ? '' : ' (sin cuenta: no mueve saldos)'} y ${guestTo ? 'queda registrado' : `a ${esc(x.creditorLabel)} le llega para confirmar que lo recibió`}.</i>\n\n`
          : x.creditorId === f.userId
            ? `<i>Al confirmarlo queda como tu ingreso${x.accountId ? ' en esa cuenta' : ''} y baja lo que ${esc(x.debtorLabel)} debe en el hogar.</i>\n\n`
            : `<i>Ninguna de tus cuentas se mueve: solo baja lo que ${esc(x.debtorLabel)} le debe a ${esc(x.creditorLabel)}${guestTo ? '' : `, y a ${esc(x.creditorLabel)} le llega para confirmar que lo recibió`}.</i>\n\n`
      }
      return {
        text: `${head}${body}${c ? `💬 Comentario: <b>${esc(c)}</b>\n\n` : ''}${extra}Esto <b>no se registra todavía</b>: queda pendiente para que lo confirmes dentro de la app.`,
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
  // the person's family, if any: a transfer with one of them can reach them too
  let family: Flow['family'] = null
  try {
    const fam = (await d.db.query('families', [{ field: 'members', op: 'ARRAY_CONTAINS', value: userId }]))[0]
    if (fam) {
      const names = (fam.memberNames ?? {}) as Record<string, string>
      const members = ((fam.members ?? []) as string[]).filter((u) => u !== userId).map((u) => ({ uid: u, name: (names[u] ?? 'Familiar').split(' ')[0] }))
      if (members.length) family = { id: fam.id, myName: (names[userId] ?? '').split(' ')[0], members }
    }
  } catch (e) { console.error('family:', (e as Error)?.message) }
  // the person's tags (kept in their profile): offered for an expense of its own
  let tags: Flow['tags'] = []
  try {
    const profile = await d.db.get(`users/${userId}`)
    tags = ((profile?.tags ?? []) as any[]).filter((t) => t?.id && t?.name).map((t) => ({ id: String(t.id), name: String(t.name) }))
  } catch (e) { console.error('tags:', (e as Error)?.message) }
  const flow: Flow = { userId, chatId, step: 'amount', history: [], awaiting: null, editing: false, extracted, data: {}, messageId, attachmentId, family, tags, updatedAt: new Date(clock(d)) }
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
      if (f.step !== 'kind' || !['income', 'fixed', 'occasional', 'abono', 'received', 'shared'].includes(a)) break
      if (d0.kind !== a) {
        // another type: what belonged to the previous one no longer applies
        delete d0.concept; delete d0.category; delete d0.fixedExpenseId; delete d0.occMonth; delete d0.fixedLabel
        delete d0.budgetId; delete d0.budgetLabel; delete d0.accountId; delete d0.accountLabel
        delete d0.householdId; delete d0.householdLabel; delete d0.creditorId; delete d0.creditorLabel; delete d0.targetDebtId; delete d0.targetLabel
        delete d0.familyWith; delete d0.familyName; delete d0.tagIds
        clearHouseholdChoices(d0)
        delete d0.memberNames; delete d0.guestIds
      }
      d0.kind = a as Kind
      advance(f)
      break
    }
    case 'fam': {
      if (f.step !== 'family') break
      const wasFamily = !!d0.familyWith
      if (a === 'none') {
        d0.familyWith = null; delete d0.familyName
        // what the family choice had filled in no longer applies
        if (wasFamily) { delete d0.concept; delete d0.category; delete d0.budgetId; delete d0.budgetLabel }
      } else {
        const m = f.family?.members.find((x) => x.uid === a)
        if (!m) { notice = 'Esa persona ya no está en tu familia'; break }
        d0.familyWith = m.uid; d0.familyName = m.name; delete d0.tagIds
        if (d0.kind === 'income') d0.concept = `Transferencia de ${m.name}`
        else { d0.budgetId = 'other'; delete d0.budgetLabel; d0.concept = `Transferencia a ${m.name}`; d0.category = 'transferencias' }
      }
      advance(f)
      break
    }
    case 'hh': {
      if (f.step !== 'household') break
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === a)
      if (!hh) { notice = 'Ese hogar ya no está disponible'; break }
      if (d0.householdId !== a) {
        delete d0.creditorId; delete d0.creditorLabel; delete d0.targetDebtId; delete d0.targetLabel
        clearHouseholdChoices(d0)
        // like the app's form: everyone takes part, and the user put the money
        if (d0.kind === 'shared') { d0.participants = [...hh.members]; d0.payers = [f.userId] }
      }
      d0.householdId = hh.h.id; d0.householdLabel = String(hh.h.name)
      d0.memberNames = Object.fromEntries(hh.members.map((m) => [m, m === f.userId ? 'Tú' : hh.name(m)]))
      d0.guestIds = ((hh.h as any).guestIds ?? []) as string[]
      advance(f)
      break
    }
    case 'db': {
      if (f.step !== 'debtor') break
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === d0.householdId)
      if (!hh || !hh.members.includes(a)) { notice = 'Esa persona ya no está disponible'; break }
      // another payer: whom they pay and which debt are chosen again
      if (d0.debtorId !== a) { delete d0.creditorId; delete d0.creditorLabel; delete d0.targetDebtId; delete d0.targetLabel }
      d0.debtorId = a; d0.debtorLabel = personLabel(f, a, hh.name(a))
      advance(f)
      break
    }
    case 'rt': {
      if (f.step !== 'rtarget') break
      if (a === 'auto') { d0.targetDebtId = 'auto'; delete d0.targetLabel }
      else {
        const hh = (await households(d.db, f.userId)).find((x) => x.h.id === d0.householdId)
        const debt = (hh?.debts as any[] | undefined)?.find((x) => x.id === a && x.debtor === d0.debtorId && isPendingDebt(x))
        if (!debt) { notice = 'Esa deuda ya no está disponible'; break }
        d0.targetDebtId = debt.id; d0.targetLabel = `${debt.concept} · ${cop(remainingOf(debt))}`
      }
      advance(f)
      break
    }
    case 'hc':
      if (f.step === 'hcategory' && HOUSEHOLD_DEBT_CATEGORIES.some((c) => c.id === a)) { d0.category = a; advance(f) }
      break
    case 'pt': case 'py': {
      const isPart = action === 'pt'
      if (f.step !== (isPart ? 'participants' : 'payers')) break
      const current = (isPart ? d0.participants : d0.payers) ?? []
      if (a === 'done') {
        if (current.length === 0) { notice = 'Elige al menos a una persona'; break }
        if (isPart) delete d0.shareValues // the typed values were for the previous list
        else {
          delete d0.payerAmounts
          // the account is only asked for the user's own part: someone else's money is not theirs to move
          if (current.includes(f.userId)) { if (d0.accountId === null) delete d0.accountId }
          else { d0.accountId = null; delete d0.accountLabel }
        }
        advance(f)
        break
      }
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === d0.householdId)
      const m = hh?.members[Number(a)]
      if (!m) { notice = 'Esa persona ya no está disponible'; break }
      // kept in the household's order, so typed values line up with the names shown
      const next = new Set(current)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      const ordered = hh!.members.filter((x) => next.has(x))
      if (isPart) d0.participants = ordered
      else d0.payers = ordered
      break
    }
    case 'sp':
      if (f.step === 'split' && (a === 'equal' || a === 'percentage' || a === 'fixed')) {
        if (d0.splitMode !== a) delete d0.shareValues
        d0.splitMode = a
        advance(f)
      }
      break
    case 'due':
      if (f.step === 'due' && a === 'none') { d0.dueDate = null; advance(f) }
      break
    case 'cr': {
      if (f.step !== 'creditor') break
      const hh = (await households(d.db, f.userId)).find((x) => x.h.id === d0.householdId)
      if (!hh || !hh.members.includes(a) || a === (payerOf(f) ?? f.userId)) { notice = 'Esa persona ya no está disponible'; break }
      if (d0.creditorId !== a) { delete d0.targetDebtId; delete d0.targetLabel }
      d0.creditorId = a; d0.creditorLabel = d0.kind === 'received' ? personLabel(f, a, hh.name(a)) : hh.name(a)
      if (d0.kind === 'received') syncAccountAsk(f)
      advance(f)
      break
    }
    case 'td': {
      if (f.step !== 'target') break
      if (a === 'auto') { d0.targetDebtId = 'auto'; delete d0.targetLabel }
      else {
        const hh = (await households(d.db, f.userId)).find((x) => x.h.id === d0.householdId)
        const debt = (hh?.debts as any[] | undefined)?.find((x) => x.id === a && x.debtor === f.userId && isPendingDebt(x))
        if (!debt) { notice = 'Esa deuda ya no está disponible'; break }
        d0.targetDebtId = debt.id; d0.targetLabel = `${debt.concept} · ${cop(remainingOf(debt))}`
      }
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
        // a budget's spend carries the budget's own tags
        d0.budgetId = bd.id; d0.budgetLabel = bd.concept; d0.concept = bd.concept; d0.category = bd.category; delete d0.tagIds
      }
      advance(f)
      break
    }
    case 'cat':
      if (f.step === 'category' && PERSONAL_CATEGORIES.some((c) => c.id === a)) { d0.category = a; advance(f) }
      break
    case 'tg': {
      if (f.step !== 'tags') break
      if (a === 'done') { advance(f); break }
      const tag = f.tags?.[Number(a)]
      if (!tag) { notice = 'Esa etiqueta ya no está disponible'; break }
      const chosen = new Set(d0.tagIds ?? [])
      if (chosen.has(tag.id)) chosen.delete(tag.id)
      else chosen.add(tag.id)
      d0.tagIds = [...chosen]
      break
    }
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
  } else if (f.awaiting === 'shares') {
    const parts = f.data.participants ?? []
    const tokens = t.split(/[\s;]+/).filter(Boolean)
    if (tokens.length !== parts.length) { await d.tg.send(chatId, `Escribe ${parts.length} valores, uno por persona, separados por espacios.`); return true }
    const pct = f.data.splitMode === 'percentage'
    const values = tokens.map((x) => (pct ? Number(x.replace('%', '').replace(',', '.')) : parseAmount(x) ?? NaN))
    if (values.some((v) => !Number.isFinite(v) || v < 0)) { await d.tg.send(chatId, 'No entendí alguno de los valores. Usa solo números, por ejemplo 50 30 20.'); return true }
    const previous = f.data.shareValues
    f.data.shareValues = values
    // checked with the same function the app uses to split it
    const p = sharedPreviewShares(f)
    if (p) { f.data.shareValues = previous; await d.tg.send(chatId, `${p} Escríbelos otra vez.`); return true }
    advance(f)
  } else if (f.awaiting === 'payamounts') {
    const payers = f.data.payers ?? []
    const tokens = t.split(/[\s;]+/).filter(Boolean)
    const values = tokens.map((x) => parseAmount(x) ?? NaN)
    if (values.length !== payers.length || values.some((v) => !Number.isFinite(v))) { await d.tg.send(chatId, `Escribe ${payers.length} montos, uno por persona, separados por espacios.`); return true }
    const sum = values.reduce((s, v) => s + v, 0)
    if (sum !== f.data.amount) { await d.tg.send(chatId, `Entre todos suman ${cop(sum)} y el gasto es de ${cop(f.data.amount ?? 0)}: deben coincidir.`); return true }
    f.data.payerAmounts = values
    advance(f)
  } else if (f.awaiting === 'due') {
    const v = parseDate(t, today)
    if (!v) { await d.tg.send(chatId, 'No entendí esa fecha. Prueba con 30/11/2026 o toca Sin fecha acordada.'); return true }
    f.data.dueDate = v
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
          : x.kind === 'abono' && !x.householdId ? 'el hogar'
            : x.kind === 'abono' && !x.creditorId ? 'a quién le pagaste'
              : x.kind === 'abono' && !x.targetDebtId ? 'a qué deuda va'
                : (x.kind === 'received' || x.kind === 'shared') && !x.householdId ? 'el hogar'
                  : x.kind === 'received' && !x.debtorId ? 'quién paga'
                    : x.kind === 'received' && !x.creditorId ? 'a quién le paga'
                    : x.kind === 'received' && !x.targetDebtId ? 'a qué deuda va'
                      : x.kind === 'shared' && !x.category ? 'la categoría'
                        : x.kind === 'shared' && !x.participants?.length ? 'entre quiénes se divide'
                          : x.kind === 'shared' && !x.splitMode ? 'cómo se divide'
                            : x.kind === 'shared' && !x.payers?.length ? 'quién puso el dinero'
                              : x.kind === 'shared' && x.dueDate === undefined ? 'la fecha acordada'
          : x.kind !== 'fixed' && x.kind !== 'abono' && x.kind !== 'received' && !x.concept ? 'el concepto'
            : x.kind === 'occasional' && x.budgetId === 'other' && !x.category ? 'la categoría' : ''
  if (missing) { await d.tg.edit(f.chatId, f.messageId!, `Falta ${missing}. Usa ⬅️ Atrás para completarlo.`, NAV); return }
  let split: { mode: SplitMode; shares: { memberId: string; value?: number }[] } | undefined
  let detail: string | undefined
  if (x.kind === 'shared') {
    // never sent unless it splits and settles exactly as the app will write it
    const p = sharedPreview(f)
    if ('error' in p) { await d.tg.edit(f.chatId, f.messageId!, `${esc(p.error)} Usa ⬅️ Atrás para corregirlo.`, NAV); return }
    split = { mode: x.splitMode!, shares: x.participants!.map((u, i) => (x.splitMode === 'equal' ? { memberId: u } : { memberId: u, value: x.shareValues![i] })) }
    const who = (u: string) => x.memberNames?.[u] ?? 'alguien'
    detail = `Pagó ${x.payers!.map(who).join(', ')} · entre ${x.participants!.map(who).join(', ')} (${SPLIT_LABEL[x.splitMode!]})${x.dueDate ? ` · fecha acordada ${dateLabel(x.dueDate)}` : ''} · hogar «${x.householdLabel}»`
  } else if (x.kind === 'received') {
    detail = `${x.debtorLabel} → ${x.creditorLabel} en «${x.householdLabel}»: ${x.targetDebtId === 'auto' ? 'se reparte entre sus deudas, la más antigua primero' : `va a ${x.targetLabel}`}.`
  }
  // the user paying is their own abono, written exactly as before
  const asAbono = x.kind === 'received' && x.debtorId === f.userId
  const due = x.dueDate ? x.dueDate.split('-').map(Number) : null

  const [y, m, dd] = x.date!.split('-').map(Number)
  const ownId = await d.db.add('pendingMovements', {
    userId: f.userId,
    kind: asAbono ? 'abono' : x.kind,
    amount: x.amount,
    // midnight in Colombia (UTC-5), like the dates the app writes
    date: new Date(Date.UTC(y, m - 1, dd, 5, 0, 0)),
    concept: x.kind === 'abono' || asAbono ? `Abono a ${x.creditorLabel} · ${x.householdLabel}`
      : x.kind === 'received' ? (x.creditorId === f.userId ? `Pago de ${x.debtorLabel} · ${x.householdLabel}` : `Pago de ${x.debtorLabel} a ${x.creditorLabel} · ${x.householdLabel}`)
        : (x.concept ?? ''),
    category: x.category,
    householdId: x.householdId,
    creditorId: x.creditorId,
    debtorId: x.kind === 'received' && !asAbono ? x.debtorId : undefined,
    split,
    payers: x.kind === 'shared' ? payersOf(x) : undefined,
    dueDate: x.kind === 'shared' ? (due ? new Date(Date.UTC(due[0], due[1] - 1, due[2], 17, 0, 0)) : null) : undefined,
    detail,
    targetDebtId: x.targetDebtId && x.targetDebtId !== 'auto' ? x.targetDebtId : undefined,
    fixedExpenseId: x.fixedExpenseId,
    occMonth: x.occMonth,
    budgetId: x.budgetId && x.budgetId !== 'other' ? x.budgetId : undefined,
    tagIds: x.kind === 'occasional' && x.budgetId === 'other' && x.tagIds?.length ? x.tagIds : undefined,
    accountId: x.accountId ?? undefined,
    comment: x.comment ?? undefined,
    source: 'telegram',
    status: 'pending',
    read: { amount: f.extracted.amount, date: f.extracted.date, concept: f.extracted.concept, counterparty: f.extracted.counterparty, reference: f.extracted.reference, app: f.extracted.app },
    attachmentId: f.attachmentId,
    ...(x.familyWith && f.family ? { familyTransfer: { with: x.familyWith, name: x.familyName ?? '', direction: x.kind === 'income' ? 'in' : 'out', familyId: f.family.id } } : {}),
    createdAt: new Date(clock(d)),
  })
  // a transfer with a family member: their side is created right away, with the same screenshot, so they only confirm it
  let forwarded = ''
  if (x.familyWith && f.family) {
    try {
      const me = f.family.myName || 'Un familiar'
      const out = x.kind !== 'income' // I sent it: it is their income; they sent it: it is their spend
      if (f.attachmentId) await d.db.patch(`attachments/${f.attachmentId}`, { sharedWith: [x.familyWith] }).catch(() => {})
      // fixed id (the app uses the same): their side of this movement can only exist once
      await d.db.set(`pendingMovements/fam_${ownId}_${x.familyWith}`, {
        userId: x.familyWith,
        kind: out ? 'income' : 'occasional',
        amount: x.amount,
        date: new Date(Date.UTC(y, m - 1, dd, 5, 0, 0)),
        concept: out ? `Transferencia de ${me}` : `Transferencia a ${me}`,
        ...(out ? {} : { category: 'transferencias' }),
        ...(x.comment ? { comment: x.comment } : {}),
        ...(f.attachmentId ? { attachmentId: f.attachmentId } : {}),
        source: 'family', fromUid: f.userId, fromName: me, familyId: f.family.id,
        status: 'pending', createdAt: new Date(clock(d)),
      })
      await d.db.add('notifications', {
        userId: x.familyWith, fromUid: f.userId, zone: 'familia', severity: 'info',
        title: out ? `${me} te transfirió dinero` : `${me} registró que le transferiste dinero`,
        body: `${cop(x.amount!)}. ${out ? 'Confirma en qué cuenta te llegó' : 'Confirma de qué cuenta salió'} y queda registrado: no tienes que subir la captura.`,
        link: '/pendientes', read: false, createdAt: new Date(clock(d)),
      })
      forwarded = `\n\n💞 A <b>${esc(x.familyName ?? '')}</b> le llegó a su app para confirmarlo${out ? ' como ingreso' : ' como gasto'}, con esta misma captura.`
    } catch (e: any) {
      console.error('family transfer:', e?.message)
      forwarded = `\n\n⚠️ No se pudo avisar a ${esc(x.familyName ?? 'tu familiar')}: puede registrarlo desde su app.`
    }
  }
  await d.db.remove(path(f.chatId)).catch(() => {})
  const pending = (await d.db.query('pendingMovements', [{ field: 'userId', op: 'EQUAL', value: f.userId }])).filter((p) => p.status === 'pending').length
  await d.tg.edit(
    f.chatId, f.messageId!,
    `✅ <b>Enviado a la app.</b>\n\n${recap(f)}Queda <b>pendiente por confirmar</b>: ábrela y confírmalo para que se registre. Tienes ${pending} movimiento${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'}.${forwarded}`,
    [],
  )
}

const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** A person of one of the user's households whose name appears in what the screenshot says (a hint, never a decision). */
async function memberNamed(d: FlowDeps, f: Flow): Promise<{ name: string; household: string; guest: boolean } | null> {
  const text = plain(`${f.extracted.counterparty ?? ''} ${f.extracted.concept ?? ''}`)
  if (text.trim().length < 3) return null
  for (const hh of await households(d.db, f.userId)) {
    for (const m of hh.members.filter((x) => x !== f.userId)) {
      const name = hh.name(m)
      const first = plain(name).split(/\s+/)[0]
      if (first.length >= 3 && text.includes(first)) return { name, household: String(hh.h.name), guest: ((hh.h as any).guestIds ?? []).includes(m) }
    }
  }
  return null
}
