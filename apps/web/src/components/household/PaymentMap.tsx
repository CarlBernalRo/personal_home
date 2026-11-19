import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Avatar } from '@/components/ui/Avatar'
import { formatCOP } from '@/shared'
import type { HouseholdReport, PersonReport } from './report'
import type { Rec } from './ledger'

interface Props {
  report: HouseholdReport
  /** The household's debt rows: the abonos in them are the money that already changed hands. */
  debts: Rec[]
  nameOf: (uid?: string | null) => string
  photoOf: (uid: string) => string | null
  colorOf: (uid: string) => string
}

/**
 * The rows of a person's account, the same ones the report shows:
 * put (+ from their own pocket), paid (+ to others), recv (− received from others), share (− their part), and what
 * the plan says is still to move (open).
 */
type Kind = 'put' | 'paid' | 'recv' | 'share' | 'open'

interface Item {
  /** whose account the row belongs to (for paid / open: who pays) */
  from: string
  /** who gets the money — only for paid / open, the rows drawn as lines */
  to: string
  kind: Kind
  concept: string
  amount: number
  /** for a received row: who paid it */
  who?: string
}

const KIND: Record<Kind, { color: string; sign: string }> = {
  put:   { color: '#2dd4bf', sign: '+' },
  paid:  { color: '#34d399', sign: '+' },
  recv:  { color: '#38bdf8', sign: '−' },
  share: { color: '#94a3b8', sign: '−' },
  open:  { color: '#fbbf24', sign: '' },
}
const LEFT_ORDER: Kind[] = ['put', 'paid', 'recv', 'share']
const RIGHT_ORDER: Kind[] = ['paid', 'open']
const LINE_KINDS: Kind[] = ['paid', 'open']
// card geometry: every row has a fixed height, so the line of each item can start and end exactly on its row
const PAD = 8
const HEAD = 30
const GROUP = 18
const ITEM = 17
const SALDO = 22
const GAP = 12

const keyOf = (i: Item) => `${i.from}>${i.to}>${i.kind}>${i.concept}>${i.who ?? ''}`

/** Every row of every account, itemized: what was put into which expense, each payment, each part. */
function itemsOf(report: HouseholdReport, debts: Rec[]): Item[] {
  const out: Item[] = []
  const byId = new Map(debts.map((d) => [d.id as string, d]))
  for (const d of debts) {
    if (d.tipo !== 'Abono' || !d.creditor || d.creditor === d.debtor) continue
    // a payment is drawn whole, from who paid to who received, whatever debt the app tied it to
    const debt = d.saldaId ? byId.get(d.saldaId as string) : undefined
    const concept = debt ? ((debt.concept as string) ?? '') : 'pago de más (saldo a favor)'
    out.push({ from: d.debtor as string, to: d.creditor as string, kind: 'paid', concept, amount: d.amount as number })
    out.push({ from: d.creditor as string, to: '', kind: 'recv', concept, amount: d.amount as number, who: d.debtor as string })
  }
  for (const p of report.people) {
    for (const l of p.lines) {
      if (l.put > 0) out.push({ from: p.uid, to: '', kind: 'put', concept: l.description, amount: l.put })
      if (l.share > 0) out.push({ from: p.uid, to: '', kind: 'share', concept: '', amount: l.share })
    }
    for (const x of p.pays) out.push({ from: p.uid, to: x.to, kind: 'open', concept: '', amount: x.amount })
    // who still owes them shows up among what they received, at $0, with what is still due
    for (const x of p.receives) out.push({ from: p.uid, to: '', kind: 'recv', concept: `le debe ${formatCOP(x.amount)}`, amount: 0, who: x.from })
  }
  const merged = new Map<string, Item>()
  for (const i of out) {
    const cur = merged.get(keyOf(i))
    if (cur) cur.amount += i.amount
    else merged.set(keyOf(i), { ...i })
  }
  return [...merged.values()]
}

interface Row { type: 'group' | 'item' | 'saldo'; kind: Kind; amount: number; item?: Item; y: number }
interface Card { uid: string; top: number; height: number; total: number; rows: Row[] }

/** Stacks the cards of one column and works out where every row sits. */
function layout(
  uids: string[], items: Item[], side: 'L' | 'R', nameOf: (u: string) => string, expanded: string | null,
  person: (u: string) => PersonReport | undefined,
) {
  const cards: Card[] = []
  const anchor = new Map<string, number>()
  let y = 0
  const other = (i: Item) => (side === 'L' ? i.to || i.who || '' : i.from)
  for (const uid of uids) {
    const mine = items.filter((i) => (side === 'L' ? i.from === uid : i.to === uid))
    // only the selected person's card is itemized; the others itemize just what they have with that person
    const compact = uid !== expanded
    const rows: Row[] = []
    let h = PAD + HEAD
    const groups = side === 'L' ? [...LEFT_ORDER, 'saldo' as const, 'open' as const] : RIGHT_ORDER
    for (const k of groups) {
      if (k === 'saldo') {
        rows.push({ type: 'saldo', kind: 'share', amount: person(uid)?.position ?? 0, y: h })
        h += SALDO
        continue
      }
      const group = mine.filter((i) => i.kind === k)
        .sort((a, b) => nameOf(other(a)).localeCompare(nameOf(other(b))) || b.amount - a.amount)
      if (group.length === 0) continue
      rows.push({ type: 'group', kind: k, amount: group.reduce((n, i) => n + i.amount, 0), y: h })
      // their part stays one total: split by expense it reads as if each part were paid to whoever put that expense
      const shown = k === 'share' ? [] : compact ? group.filter((i) => !!expanded && (i.from === expanded || i.to === expanded || i.who === expanded)) : group
      const rest = group.filter((i) => !shown.includes(i))
      const step = rest.length > 1 ? Math.min(3, (GROUP - 6) / (rest.length - 1)) : 0
      rest.forEach((i, n) => anchor.set(`${keyOf(i)}|${side}`, y + h + GROUP / 2 + (n - (rest.length - 1) / 2) * step))
      h += GROUP
      for (const i of shown) {
        rows.push({ type: 'item', kind: k, amount: i.amount, item: i, y: h })
        anchor.set(`${keyOf(i)}|${side}`, y + h + ITEM / 2)
        h += ITEM
      }
    }
    h += PAD
    const total = side === 'L' ? person(uid)?.position ?? 0 : mine.reduce((n, i) => n + i.amount, 0)
    cards.push({ uid, top: y, height: h, total, rows })
    y += h + GAP
  }
  return { cards, anchor, height: Math.max(0, y - GAP) }
}

/**
 * How the payments connect. On the left, each person's account exactly as the report has it — what they put in, what
 * they paid, what they received, their part, their saldo — and what the plan says they still pay. On the right, whoever
 * receives money: what they already got and what is still coming. Each payment is a line between the two.
 */
export function PaymentMap({ report, debts, nameOf, photoOf, colorOf }: Props) {
  const [focus, setFocus] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<Kind>>(new Set())

  const all = useMemo(() => itemsOf(report, debts), [report, debts])
  // the selected person's rows stay itemized; everybody else's lines are one per pair of people and kind
  const items = useMemo(() => {
    const visible = all.filter((i) => !hidden.has(i.kind))
    const merged = new Map<string, Item>()
    for (const i of visible) {
      if (focus && (i.from === focus || i.to === focus || i.who === focus)) { merged.set(keyOf(i), i); continue }
      const k = `${i.from}>${i.to}>${i.kind}`
      const cur = merged.get(k)
      if (cur) cur.amount += i.amount
      else merged.set(k, { ...i, concept: '', who: undefined })
    }
    return [...merged.values()]
  }, [all, hidden, focus])

  const person = (uid: string) => report.people.find((p) => p.uid === uid)
  const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b))
  // everyone with an account on the left; on the right, whoever receives money
  // ordered by state, like the report: who has to pay the most first, then who is al día, then who is owed the most
  const lefts = useMemo(() => {
    const rank = (n: number) => (n < 0 ? 0 : n === 0 ? 1 : 2)
    return [...report.people]
      .sort((a, b) => rank(a.position) - rank(b.position) || (a.position < 0 ? a.position - b.position : b.position - a.position) || a.name.localeCompare(b.name))
      .map((p) => p.uid)
  }, [report.people])
  const rights = useMemo(() => [...new Set(items.filter((i) => LINE_KINDS.includes(i.kind)).map((i) => i.to).filter(Boolean))].sort(byName), [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const L = useMemo(() => layout(lefts, items, 'L', nameOf, focus, person), [lefts, items, nameOf, focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const R = useMemo(() => layout(rights, items, 'R', nameOf, focus, person), [rights, items, nameOf, focus]) // eslint-disable-line react-hooks/exhaustive-deps
  const H = Math.max(L.height, R.height, 200)
  const offL = (H - L.height) / 2
  const offR = (H - R.height) / 2

  const lines = items.filter((i) => LINE_KINDS.includes(i.kind) && i.to)
  const maxAmount = Math.max(1, ...lines.map((i) => i.amount))
  const widthOf = (i: Item) => 1 + 4 * Math.sqrt(i.amount / maxAmount)

  const sel = items.find((i) => keyOf(i) === picked) ?? null
  const touches = (i: Item) => !focus || i.from === focus || i.to === focus
  const active = (i: Item) => (picked ? keyOf(i) === picked : touches(i))
  const choose = (i: Item) => setPicked(picked === keyOf(i) ? null : keyOf(i))
  const toggleKind = (k: Kind) => setHidden((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const sum = (xs: Item[]) => xs.reduce((n, i) => n + i.amount, 0)

  // "Everybody pays the same": the biggest group of equal shares, and who is the exception
  const equity = useMemo(() => {
    const shares = report.people.filter((p) => p.share > 0)
    let best: typeof shares = []
    for (const s of shares) {
      const group = shares.filter((x) => Math.abs(x.share - s.share) <= 5)
      if (group.length > best.length) best = group
    }
    const avg = best.length ? Math.round(best.reduce((n, p) => n + p.share, 0) / best.length) : 0
    return { same: best, avg, others: shares.filter((p) => !best.includes(p)) }
  }, [report.people])

  const groupWord = (k: Kind, side: 'L' | 'R', uid: string) => {
    if (side === 'R') return k === 'paid' ? 'Ya recibió' : 'Le falta recibir'
    const n = person(uid)?.lines.filter((l) => l.share > 0).length ?? 0
    return { put: 'Puso de su bolsillo', paid: 'Ya pagó a otros', recv: 'Ya recibió de otros', share: `Su parte de los gastos (${n} ${n === 1 ? 'gasto' : 'gastos'})`, open: 'Le falta pagar (plan)' }[k]
  }
  // the same states, words and colours as the person cards of the Hogar screen
  const saldoText = (n: number) => (n < 0 ? `Debe pagar ${formatCOP(-n)}` : n > 0 ? `Le deben ${formatCOP(n)}` : 'Al día')
  const saldoChip = (n: number) => (n < 0 ? 'text-amber-300 bg-amber-500/15 border-amber-500/30' : n > 0 ? 'text-sky-300 bg-sky-500/15 border-sky-500/30' : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30')
  const saldoTone = (n: number) => (n < 0 ? 'text-amber-300' : n > 0 ? 'text-sky-300' : 'text-emerald-300')

  const itemText = (i: Item, side: 'L' | 'R') => {
    if (i.kind === 'put') return <span className="text-[#dcf1eb]">{i.concept}</span>
    if (i.kind === 'share') return null
    const name = i.kind === 'recv' ? `← ${nameOf(i.who)}` : side === 'L' ? `→ ${nameOf(i.to)}` : `← ${nameOf(i.from)}`
    return <>{name}{i.concept && <span className="text-[#8a929a]"> · {i.concept}</span>}</>
  }

  const card = (c: Card, side: 'L' | 'R', off: number) => {
    const on = focus === c.uid
    return (
      <div
        key={`${side}${c.uid}`}
        style={{ position: 'absolute', left: 0, right: 0, top: off + c.top, height: c.height, paddingTop: PAD, paddingBottom: PAD }}
        className={clsx('rounded-xl border px-3 transition', on ? 'border-brand-400/70 bg-brand-500/10' : 'border-white/10 bg-[#0d263a]')}
      >
        <button
          type="button"
          onClick={() => { setPicked(null); setFocus(on ? null : c.uid) }}
          aria-pressed={on}
          style={{ height: HEAD }}
          className="flex w-full items-center gap-2 text-left"
        >
          <Avatar name={nameOf(c.uid)} photoURL={photoOf(c.uid)} size={22} color={colorOf(c.uid)} className="!ring-white/15 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#f0fae8]">{nameOf(c.uid)}</span>
          {side === 'L'
            ? <span className={clsx('flex-shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider', saldoChip(c.total))}>{saldoText(c.total)}</span>
            : <span className="flex-shrink-0 font-mono text-xs font-bold text-[#f3f5f6]">{formatCOP(c.total)}</span>}
        </button>
        {c.rows.map((r, idx) => {
          if (r.type === 'saldo') {
            return (
              <div key={idx} style={{ height: SALDO }} className="flex items-center gap-1.5 border-t-2 border-white/15 text-[11px] font-bold">
                <span className="w-3 text-center text-[#8a929a]">=</span>
                <span className="min-w-0 flex-1 text-[#f3f5f6]">Saldo</span>
                <span className={clsx('flex-shrink-0 font-mono', saldoTone(r.amount))}>{r.amount < 0 ? '−' : ''}{formatCOP(Math.abs(r.amount))}</span>
              </div>
            )
          }
          if (r.type === 'group') {
            return (
              <div key={idx} style={{ height: GROUP }} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                <span className="w-3 flex-shrink-0 text-center font-mono text-[11px]" style={{ color: KIND[r.kind].color }}>{side === 'L' ? KIND[r.kind].sign || '•' : '•'}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: KIND[r.kind].color }}>{groupWord(r.kind, side, c.uid)}</span>
                <span className="flex-shrink-0 font-mono text-[#c7ccd1]">{formatCOP(r.amount)}</span>
              </div>
            )
          }
          return (
            <button
              key={idx}
              type="button"
              onClick={() => choose(r.item!)}
              onMouseEnter={() => setHover(keyOf(r.item!))}
              onMouseLeave={() => setHover(null)}
              style={{ height: ITEM }}
              className={clsx('flex w-full items-center gap-1.5 rounded pl-5 text-left text-[11px] transition hover:bg-white/[0.06]', picked === keyOf(r.item!) && 'bg-white/[0.08]')}
            >
              <span className="min-w-0 flex-1 truncate text-[#dcf1eb]">{itemText(r.item!, side)}</span>
              <span className="flex-shrink-0 font-mono text-[10px] text-[#c7ccd1]">{formatCOP(r.amount)}</span>
            </button>
          )
        })}
      </div>
    )
  }

  const explain = (i: Item) => {
    const me = nameOf(i.from)
    const what = i.concept ? ` en "${i.concept}"` : ''
    switch (i.kind) {
      case 'put': return `${me} pagó ${formatCOP(i.amount)} de su bolsillo${what}: suma a su favor.`
      case 'share': return `Su parte de los gastos es ${formatCOP(i.amount)}.`
      case 'recv':
        if (i.amount === 0) return `${nameOf(i.who)} todavía no le ha pagado nada a ${me}: según el plan ${i.concept}.`
        return `${me} recibió ${formatCOP(i.amount)} de ${nameOf(i.who)}${i.concept ? ` (${i.concept})` : ''}: es plata que le devolvieron, y se resta.`
      case 'paid': {
        if (i.concept === 'pago de más (saldo a favor)') {
          const uses = person(i.from)?.credit.uses ?? []
          return `${me} le pagó ${formatCOP(i.amount)} a ${nameOf(i.to)} por encima de lo que le debía a esa persona. Igual suma a su favor; en las deudas registradas se descontó de lo que debía a otros${uses.length ? ` (${uses.map((u) => `${u.name} ${formatCOP(u.amount)}`).join(', ')})` : ''}.`
        }
        return `${me} le pagó ${formatCOP(i.amount)} a ${nameOf(i.to)}${i.concept ? ` por "${i.concept}"` : ''}: suma a su favor.`
      }
      default: return `Según el plan, falta que ${me} le pague ${formatCOP(i.amount)} a ${nameOf(i.to)}. Con eso su saldo queda en cero.`
    }
  }

  return (
    <section aria-label="Mapa de pagos" className="w-full space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {LINE_KINDS.map((k) => {
          const off = hidden.has(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleKind(k)}
              aria-pressed={!off}
              className={clsx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition', off ? 'border-white/10 text-[#6f7a83]' : 'border-white/20 bg-white/[0.04] text-[#f3f5f6]')}
            >
              <i className="h-2 w-5 rounded-full" style={{ background: off ? '#3b4650' : KIND[k].color }} />
              {k === 'paid' ? 'Pagos hechos' : 'Pendiente según el plan'}
              <span className="font-mono text-[10px] opacity-70">{formatCOP(sum(all.filter((i) => i.kind === k)))}</span>
            </button>
          )
        })}
        {equity.same.length > 1 && (
          <span className="ml-auto rounded-lg border border-emerald-400/25 bg-emerald-500/[0.06] px-3 py-1.5 text-[11px] text-[#dcf1eb]">
            <b className="text-emerald-300">{equity.same.length} personas pagan lo mismo:</b> {formatCOP(equity.avg)}
            {equity.others.length > 0 && <> · distinto: {equity.others.map((p) => `${p.name} ${formatCOP(p.share)}`).join(', ')}</>}
          </span>
        )}
      </div>

      {sel ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-[#0d263a] px-4 py-2.5 text-sm text-[#dcf1eb]">
          <span className="flex items-center gap-2 font-semibold text-[#f3f5f6]">
            <i className="h-2 w-5 rounded-full" style={{ background: KIND[sel.kind].color }} />
            {formatCOP(sel.amount)}
          </span>
          <span className="min-w-0 flex-1 text-[13px]">{explain(sel)}</span>
        </div>
      ) : (
        <p className="text-[12px] leading-snug text-[#8a929a]">
          A la izquierda, la cuenta de cada persona igual que en el reporte (puso, pagó, recibió, su parte y saldo). A la derecha, quien recibe plata. Cada pago es una línea. Toca el nombre de una persona para ver su desglose.
        </p>
      )}

      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#081a28] p-4">
        <div className="mb-2 grid text-[10px] font-bold uppercase tracking-widest text-[#8a929a]" style={{ gridTemplateColumns: 'minmax(0,1fr) 22% minmax(0,1fr)' }}>
          <span>La cuenta de cada quien</span>
          <span />
          <span className="text-right">Quien recibe · cómo le llega</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 22% minmax(0,1fr)' }}>
          <div className="relative" style={{ height: H }}>{L.cards.map((c) => card(c, 'L', offL))}</div>
          <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden="true">
            {lines.map((i) => {
              const y1 = offL + (L.anchor.get(`${keyOf(i)}|L`) ?? 0)
              const y2 = offR + (R.anchor.get(`${keyOf(i)}|R`) ?? 0)
              const d = `M0 ${y1} C50 ${y1}, 50 ${y2}, 100 ${y2}`
              const hot = hover === keyOf(i) || picked === keyOf(i)
              return (
                <g key={keyOf(i)} style={{ opacity: active(i) ? 1 : 0.07, transition: 'opacity .2s' }}>
                  <path
                    d={d} fill="none" stroke={KIND[i.kind].color} strokeWidth={widthOf(i) + (hot ? 1.5 : 0)} strokeLinecap="round"
                    strokeDasharray={i.kind === 'open' ? '5 4' : undefined} vectorEffect="non-scaling-stroke" opacity={hot ? 1 : 0.6}
                  />
                  <path
                    d={d} fill="none" stroke="transparent" strokeWidth={10} vectorEffect="non-scaling-stroke" style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHover(keyOf(i))} onMouseLeave={() => setHover(null)} onClick={() => choose(i)}
                  />
                </g>
              )
            })}
          </svg>
          <div className="relative" style={{ height: H }}>{R.cards.map((c) => card(c, 'R', offR))}</div>
        </div>
        <p className="mt-3 text-[11px] text-[#8a929a]">
          {focus ? `Desglose de ${nameOf(focus)}. Toca de nuevo su nombre para cerrarlo.` : 'Toca el nombre de una persona para ver su desglose.'} Línea continua = pago hecho; punteada = pendiente según el plan.
        </p>
      </div>
    </section>
  )
}
