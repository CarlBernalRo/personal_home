import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { clsx } from 'clsx'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Coins } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { Button } from '@/components/ui/Button'
import { formatCOP, HOUSEHOLD_DEBT_CATEGORIES, remainingOf, creditorOf, owedByCreditor, isPendingDebt, inPaymentOrder } from '@/shared'
import type { Rec } from './ledger'

/** One more payment that goes out with the main one: either another debt of the payer's own (to a different
 *  creditor) or someone else's debt. Settled straight away, same as a guest's abono already is: no confirmation
 *  step on the covered person's side — the money really did move. `targetDebtId` aims it at one specific debt. */
export interface ExtraAbonoLine { id: string; debtor: string; amount: number; creditor: string | null; targetDebtId?: string | null }

export const CAT_OPTIONS = HOUSEHOLD_DEBT_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))

// 'Deuda' is no longer created by hand: every debt is born from a shared expense (see
// HouseholdExpenseModal), which computes each person's share. This form only registers abonos.
export const debtSchema = z.object({
  concept:  z.string().optional(),
  tipo:     z.literal('Abono'),
  amount:   z.coerce.number().positive('El monto debe ser mayor a 0'),
  debtor:   z.string().min(1),
  /** Whom the abono is paid to (several people can be owed in a household). */
  creditor: z.string().optional(),
  /** Account the money comes out of ('' = none). */
  accountId: z.string().optional(),
  category: z.string().min(1),
  date:     z.string().min(1),
  notas:    z.string().optional(),
})
export type DebtForm = z.infer<typeof debtSchema>

interface Props {
  /** The signed-in user: account balances are shown only when the payment is theirs. */
  currentUserId: string
  open: boolean
  onClose: () => void
  form: UseFormReturn<DebtForm>
  /** `mainTargetId` is the debt the main payment is aimed at (null = spread over that creditor's debts). */
  onSubmit: (data: DebtForm, extraLines: ExtraAbonoLine[], mainTargetId: string | null) => void
  debts: Rec[]
  /** The debts this payment is about: one debt, or every creditor of one shared expense. null = a general abono. */
  scopeIds: string[] | null
  /** The payments the report says this person has to make to end even: the form opens with them filled in. */
  planPays?: { to: string; name: string; amount: number }[] | null
  /** The household has a payment plan everybody was told: paying a debt on its own still works, but changes the plan. */
  planActive?: boolean
  /** debt picked in the old selector (cleared: the modal now picks whom to pay instead) */
  selectedTargetDebtId: string | null
  onPickTarget: (id: string | null) => void
  members: string[]
  guestIds: string[]
  colorOf: (uid: string) => string
  photoOf: (uid: string) => string | null
  accounts: { id: string; name: string; balance: number }[]
  nameOf: (uid?: string | null) => string
  debtorOptions: { value: string; label: string }[]
  saving: boolean
  /** Receipt of the payment, optional. */
  file: File | null
  onFile: (file: File | null) => void
}

const keyOf = (c: string | null | undefined) => c ?? ''
const fromKey = (k: string) => (k === '' ? null : k)

/** What the payer can pay in step 1: one debt of the chosen expense, or (general abono) everything owed to a creditor. */
interface PayItem { key: string; creditor: string | null; owed: number; debtId: string | null; label: string | null; /** What the report says to pay them (plan mode). */ planned?: number }

type StepNo = 1 | 2 | 3
const STEP_TITLE: Record<StepNo, string> = { 1: 'A quién le pagas', 2: 'Deuda de alguien más', 3: 'Detalles del pago' }

/** Abono modal in steps, like the shared-expense one: whom you pay → someone else's debt too (optional) → details. */
export function AbonoModal({
  currentUserId, open, onClose, form, onSubmit, debts, scopeIds, planPays, planActive, selectedTargetDebtId, onPickTarget, members, guestIds,
  colorOf, photoOf, accounts, nameOf, debtorOptions, saving, file, onFile,
}: Props) {
  const watchedDebtor = form.watch('debtor')

  // The debts the payment is about, as long as they still belong to the person paying (the payer can be switched in step 3)
  const scopeDebts = scopeIds
    ? scopeIds.map((id) => debts.find((d) => d.id === id)).filter((d): d is Rec => !!d && d.debtor === watchedDebtor && remainingOf(d) > 0)
    : null
  const scoped = !!scopeDebts && scopeDebts.length > 0
  const planned = !scoped && !!planPays && planPays.length > 0
  const title = scoped ? `Abonar a: ${scopeDebts![0].concept}` : planned ? 'Registrar los pagos del reporte' : 'Registrar abono al hogar'

  // with a plan, the people to pay are the ones the report says — even someone this person has no registered debt with
  const registeredOwed = (uid: string) => owedByCreditor(debts as any[], watchedDebtor, members).find((l) => l.creditor === uid)?.owed ?? 0
  const ownItems: PayItem[] = planned
    ? planPays!.map((pp) => ({ key: `c>${pp.to}`, creditor: pp.to, owed: registeredOwed(pp.to), debtId: null, label: null, planned: pp.amount }))
    : scoped
    ? scopeDebts!.map((d) => ({ key: d.id as string, creditor: (creditorOf(d as any, members) as string | null | undefined) ?? null, owed: remainingOf(d), debtId: d.id as string, label: d.concept as string }))
    : owedByCreditor(debts as any[], watchedDebtor, members).filter((l) => l.owed > 0).map((l) => ({ key: `c>${keyOf(l.creditor)}`, creditor: l.creditor ?? null, owed: l.owed, debtId: null, label: null }))
  const totalOwn = ownItems.reduce((s, i) => s + i.owed, 0)
  const capOf = (key: string) => ownItems.find((i) => i.key === key)?.owed ?? 0

  const [step, setStep] = useState<StepNo>(1)
  // Step 1 — whom the payer pays (item key → amount)
  const [paying, setPaying] = useState<Record<string, number>>({})
  // Step 2 — someone else's debts also covered (debt id → amount), and which person is unfolded
  const [covering, setCovering] = useState<Record<string, number>>({})
  const [unfolded, setUnfolded] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (selectedTargetDebtId) onPickTarget(null)
    // a single thing to pay starts chosen; with several, the person picks whom
    setPaying(planned ? Object.fromEntries(ownItems.map((i) => [i.key, i.planned ?? i.owed])) : ownItems.length === 1 ? { [ownItems[0].key]: ownItems[0].owed } : {})
    setCovering({})
    setUnfolded(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, watchedDebtor, scopeIds, planPays])

  // a new payment always starts at step 1; switching who pays from the last step only clears what was chosen
  useEffect(() => { if (open) setStep(1) }, [open, scopeIds, planPays])

  function togglePaying(key: string) {
    setPaying((prev) => {
      if (key in prev) { const { [key]: _gone, ...rest } = prev; return rest }
      return { ...prev, [key]: capOf(key) }
    })
  }
  // paying more than is owed is fine: what is left over stays as a balance in the payer's favor with that creditor
  const setPayingAmount = (key: string, v: number) => setPaying((prev) => ({ ...prev, [key]: Math.max(0, v) }))

  const payingTotal = Object.values(paying).reduce((s, v) => s + (Number(v) || 0), 0)
  /** What of the payer's debts step 1 covers (an overpayment to one creditor never covers another's debt). */
  const coveredOwn = ownItems.reduce((s, i) => s + Math.min(Number(paying[i.key]) || 0, i.owed), 0)
  /** Paid above what was owed, per item: it becomes a saldo a favor with that creditor. */
  const surplusOf = (i: PayItem) => Math.max(0, (Number(paying[i.key]) || 0) - i.owed)
  const totalSurplus = ownItems.reduce((s, i) => s + surplusOf(i), 0)
  /** What the payer still owes after step 1: other people's debts can only be covered once this is zero. */
  const ownLeft = Math.max(0, totalOwn - coveredOwn)
  const step2Open = totalOwn > 0 && ownLeft === 0

  // Other people with something owed: each pending debt of theirs, in the order it is paid
  const others = members
    .filter((uid) => uid !== watchedDebtor)
    .map((uid) => ({ uid, list: inPaymentOrder(debts.filter((d) => d.debtor === uid && isPendingDebt(d))) as Rec[] }))
    .filter((p) => p.list.length > 0)
  function toggleCovering(id: string, owed: number) {
    setCovering((prev) => {
      if (id in prev) { const { [id]: _gone, ...rest } = prev; return rest }
      return { ...prev, [id]: owed }
    })
  }
  const setCoveringAmount = (id: string, v: number, owed: number) => setCovering((prev) => ({ ...prev, [id]: Math.max(0, Math.min(v, owed)) }))

  // What gets written: the first thing chosen is the "main" payment, the rest ride along as extra lines
  const payingItems = ownItems.filter((i) => (Number(paying[i.key]) || 0) > 0)
  const mainItem = payingItems[0]
  const mainAmount = mainItem ? paying[mainItem.key] : 0
  const ownExtra: ExtraAbonoLine[] = payingItems.slice(1).map((i) => ({ id: `own>${i.key}`, debtor: watchedDebtor, creditor: i.creditor, amount: paying[i.key], targetDebtId: i.debtId }))
  const othersExtra: ExtraAbonoLine[] = step2Open
    ? others.flatMap((p) => p.list
        .filter((d) => (Number(covering[d.id as string]) || 0) > 0)
        .map((d) => ({ id: d.id as string, debtor: p.uid, creditor: (creditorOf(d as any, members) as string | null | undefined) ?? null, amount: covering[d.id as string], targetDebtId: d.id as string })))
    : []
  const total = payingTotal + othersExtra.reduce((s, l) => s + l.amount, 0)
  const canSubmit = mainAmount > 0 && !saving

  // the form's own fields follow the main payment
  useEffect(() => {
    form.setValue('amount', mainAmount, { shouldValidate: mainAmount > 0 })
    form.setValue('creditor', mainItem?.creditor ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainAmount, mainItem?.key])

  const confirmPayment = form.handleSubmit((data) => onSubmit({ ...data, amount: mainAmount, creditor: mainItem?.creditor ?? '' }, [...ownExtra, ...othersExtra], mainItem ? mainItem.debtId : null))

  const avatar = (uid: string | null, size = 24) => uid
    ? <Avatar name={nameOf(uid)} photoURL={photoOf(uid)} color={colorOf(uid)} size={size} />
    : <span className="inline-flex items-center justify-center rounded-full bg-white/10 text-[10px] text-[#8a929a]" style={{ width: size, height: size }}>?</span>
  const guestTag = (uid: string) => (guestIds.includes(uid) ? ' (invitado)' : '')
  const you = watchedDebtor === currentUserId

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          // Never submits by itself: Enter only moves on a step, and the payment is saved ONLY by the final button
          e.preventDefault()
          if (step < 3 && (step === 1 ? mainAmount > 0 : true)) setStep((v) => (v + 1) as StepNo)
        }}
        className="space-y-4"
      >
        <input type="hidden" {...form.register('tipo')} value="Abono" />

        <div className="flex items-center gap-1.5">
          {([1, 2, 3] as StepNo[]).map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-brand-400' : 'bg-white/10'}`} />
          ))}
        </div>
        <p className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Paso {step} de 3 · {STEP_TITLE[step]}</p>

        {/* 1 — whom the payer pays */}
        {step === 1 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold text-[#f0fae8]">{`¿A quién le paga${you ? 's' : ` ${nameOf(watchedDebtor)}`}?`}</h3>
            {ownItems.length > 0 && (planned
              ? <p className="text-[11px] text-[#8a929a] leading-snug">Esto es lo que dice el reporte para que quedes a mano con todos: ya está puesto cada pago. Si a alguien no le debes nada registrado, ese pago queda como saldo a tu favor con esa persona y se aplica solo a lo que debes a los demás.</p>
              : <p className="text-[11px] text-[#8a929a] leading-snug">Toca a cada persona a la que se le debe. Puedes pagarle a varias en el mismo pago. Si pagas más de lo que debes, lo que sobra queda como saldo a tu favor.</p>)}
            {planActive && !planned && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200">
                Hay un plan de pagos fijado. Si pagas una deuda por fuera de lo que dice el plan, el plan se ajusta solo con una línea extra para que todos sigan quedando a mano; lo más simple es pagar lo que dice el reporte.
              </p>
            )}
          </div>
          {ownItems.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-[#0d263a] p-3 text-xs text-[#8a929a]">{nameOf(watchedDebtor)} no tiene deudas pendientes.</p>
          ) : (
            <div className="space-y-2">
              {ownItems.map((it) => {
                const picked = it.key in paying
                return (
                  <div key={it.key} className={clsx('rounded-xl border p-2.5 transition', picked ? 'border-brand-400/60 bg-brand-500/10' : 'border-white/10 bg-[#0d263a]')}>
                    <button type="button" onClick={() => togglePaying(it.key)} aria-pressed={picked} className="flex w-full items-center gap-2.5 text-left">
                      {avatar(it.creditor, 30)}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#f0fae8]">{it.creditor ? nameOf(it.creditor) : 'Sin definir'}{it.creditor ? guestTag(it.creditor) : ''}</span>
                        <span className="block text-[10px] font-mono text-[#8a929a]">{it.label ? `${it.label} · ` : ''}{planned && it.owed === 0 ? 'Sin deuda registrada con esta persona' : `Se le debe ${formatCOP(it.owed)}`}</span>
                      </span>
                      <span className={clsx('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border', picked ? 'border-brand-400 bg-brand-400 text-[#04141f]' : 'border-white/25')} aria-hidden="true">
                        {picked && <Check size={13} />}
                      </span>
                    </button>
                    {picked && (
                      <div className="mt-2 flex items-center gap-2 pl-[38px]">
                        <div className="currency-field flex-1">
                          <span className="currency-affix-prefix">$</span>
                          <MoneyInput
                            placeholder="0"
                            value={String(paying[it.key])}
                            onChange={(e) => setPayingAmount(it.key, Number(e.target.value) || 0)}
                            className="w-full rounded-lg border border-brand-500/20 bg-[#0a1f2f] px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500"
                            aria-label={`Monto a pagar a ${nameOf(it.creditor)}`}
                          />
                        </div>
                        <button type="button" onClick={() => setPayingAmount(it.key, it.planned ?? it.owed)} className="rounded-lg border border-brand-500/30 bg-brand-500/15 px-2 py-1.5 text-[10px] font-semibold text-brand-300 hover:bg-brand-500/25 transition whitespace-nowrap">
                          {it.planned !== undefined ? 'Según el reporte' : 'Todo'} {formatCOP(it.planned ?? it.owed)}
                        </button>
                      </div>
                    )}
                    {picked && surplusOf(it) > 0 && (
                      <p className="mt-1.5 pl-[38px] text-[11px] leading-snug text-emerald-300">
                        Pagas {formatCOP(surplusOf(it))} de más: quedan <strong className="font-mono">{formatCOP(surplusOf(it))}</strong> a favor {you ? 'tuyo' : `de ${nameOf(watchedDebtor)}`} con {it.creditor ? nameOf(it.creditor) : 'esa persona'}.
                      </p>
                    )}
                  </div>
                )
              })}
              {ownLeft > 0 && payingTotal > 0 && (
                <p className="text-[11px] text-amber-300/90">Después de este pago {you ? 'quedarías' : `quedaría ${nameOf(watchedDebtor)}`} debiendo {formatCOP(ownLeft)}.</p>
              )}
            </div>
          )}
        </div>
        )}

        {/* 2 — someone else's debt, only once the payer's own are covered */}
        {step === 2 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold text-[#f0fae8]">¿Pagas también la deuda de alguien más?</h3>
            {step2Open && <p className="text-[11px] text-[#8a929a] leading-snug">Opcional. Abre a la persona y marca qué deuda suya cubres, completa o parcial.</p>}
          </div>
          {planned ? (
            <p className="rounded-xl border border-white/10 bg-[#0d263a] p-3 text-[11px] leading-snug text-[#8a929a]">El reporte ya tiene en cuenta lo que debes a todos y lo que te deben: con los pagos del paso 1 quedas a mano. Puedes pasar al siguiente paso.</p>
          ) : !step2Open ? (
            <p className="rounded-xl border border-white/10 bg-[#0d263a] p-3 text-[11px] leading-snug text-[#8a929a]">
              {totalOwn === 0
                ? 'Aquí no hay deudas propias que pagar.'
                : <>Primero se cubren las deudas propias: {payingTotal > 0 ? <>faltan <strong className="font-mono text-[#dcf1eb]">{formatCOP(ownLeft)}</strong> en el paso 1.</> : 'elige a quién pagas en el paso 1.'}</>}
            </p>
          ) : others.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-[#0d263a] p-3 text-[11px] text-[#8a929a]">Nadie más tiene deudas pendientes en el hogar.</p>
          ) : (
            <div className="space-y-2">
              {others.map((p) => {
                const isOpen = unfolded === p.uid
                const chosen = p.list.filter((d) => (d.id as string) in covering).length
                const owedTotal = p.list.reduce((s, d) => s + remainingOf(d), 0)
                return (
                  <div key={p.uid} className={clsx('rounded-xl border transition', chosen > 0 ? 'border-sky-400/50 bg-sky-500/10' : 'border-white/10 bg-[#0d263a]')}>
                    <button type="button" onClick={() => setUnfolded(isOpen ? null : p.uid)} aria-expanded={isOpen} className="flex w-full items-center gap-2.5 p-2.5 text-left">
                      {avatar(p.uid, 30)}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#f0fae8]">{nameOf(p.uid)}{guestTag(p.uid)}</span>
                        <span className="block text-[10px] font-mono text-[#8a929a]">Debe {formatCOP(owedTotal)}{chosen > 0 ? ` · cubres ${chosen}` : ''}</span>
                      </span>
                      <ChevronDown size={16} className={clsx('flex-shrink-0 text-[#8a929a] transition-transform', isOpen && 'rotate-180')} />
                    </button>
                    {isOpen && (
                      <div className="space-y-2 border-t border-white/10 p-2.5">
                        {p.list.map((d) => {
                          const id = d.id as string
                          const owed = remainingOf(d)
                          const cred = (creditorOf(d as any, members) as string | null | undefined) ?? null
                          const on = id in covering
                          return (
                            <div key={id} className="space-y-1.5">
                              <button type="button" onClick={() => toggleCovering(id, owed)} aria-pressed={on} className="flex w-full items-center gap-2 text-left">
                                <span className={clsx('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border', on ? 'border-sky-400 bg-sky-400 text-[#04141f]' : 'border-white/25')} aria-hidden="true">
                                  {on && <Check size={13} />}
                                </span>
                                <span className="flex flex-shrink-0 items-center gap-1">
                                  {avatar(p.uid, 22)}
                                  <span aria-hidden="true" className="text-sky-300">→</span>
                                  {avatar(cred, 22)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[11px] font-semibold text-[#dcf1eb]">{d.concept}</span>
                                  <span className="block truncate text-[10px] text-[#8a929a]">con {cred ? nameOf(cred) : 'sin definir'}</span>
                                </span>
                                <span className="font-mono text-[11px] text-[#9aa4ac] flex-shrink-0">{formatCOP(owed)}</span>
                              </button>
                              {on && (
                                <div className="flex items-center gap-2 pl-7">
                                  <div className="currency-field flex-1">
                                    <span className="currency-affix-prefix">$</span>
                                    <MoneyInput
                                      placeholder="0"
                                      value={String(covering[id])}
                                      onChange={(e) => setCoveringAmount(id, Number(e.target.value) || 0, owed)}
                                      className="w-full rounded-lg border border-sky-400/30 bg-[#0a1f2f] px-2.5 py-1.5 text-sm text-white outline-none focus:border-sky-400"
                                      aria-label={`Monto que cubres de ${d.concept} de ${nameOf(p.uid)}`}
                                    />
                                  </div>
                                  <button type="button" onClick={() => setCoveringAmount(id, owed, owed)} className="rounded-lg border border-sky-400/30 bg-sky-500/15 px-2 py-1.5 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/25 transition whitespace-nowrap">
                                    Toda
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}

        {/* 3 — details of the payment */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Revisa antes de confirmar</p>
              <ul className="space-y-1">
                {payingItems.map((i) => (
                  <li key={i.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-[#dcf1eb]">{you ? 'Tú' : nameOf(watchedDebtor)} → {i.creditor ? nameOf(i.creditor) : 'sin definir'}{i.label ? ` · ${i.label}` : ''}</span>
                    <span className="font-mono text-[#f0fae8] flex-shrink-0">{formatCOP(paying[i.key])}</span>
                  </li>
                ))}
                {othersExtra.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-sky-200">{nameOf(l.debtor)} → {l.creditor ? nameOf(l.creditor) : 'sin definir'} (su deuda)</span>
                    <span className="font-mono text-sky-100 flex-shrink-0">{formatCOP(l.amount)}</span>
                  </li>
                ))}
              </ul>
              {totalSurplus > 0 && (
                <p className="text-[11px] text-emerald-300">Saldo a favor que queda: <strong className="font-mono">{formatCOP(totalSurplus)}</strong></p>
              )}
              <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                <span className="text-xs text-[#9aa4ac]">Total del pago</span>
                <span className="font-mono text-lg font-bold text-brand-300">{formatCOP(total)}</span>
              </div>
            </div>
            {mainAmount <= 0 && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">Falta elegir a quién se le paga: vuelve al paso 1.</p>
            )}
            <Input label="Concepto (opcional)" placeholder="ej. Abono de mercado…" {...form.register('concept')} error={form.formState.errors.concept?.message} />
            <Select label="¿Quién abona?" options={debtorOptions} {...form.register('debtor')} />
            <AccountSelect
              label="¿De qué cuenta sale el pago?"
              accounts={accounts}
              value={form.watch('accountId') ?? ''}
              onChange={(id) => form.setValue('accountId', id)}
              noneLabel="Sin descontar de una cuenta"
              outflow={total}
              hideBalance={!you}
            />
            <Select label="Categoría" options={CAT_OPTIONS} {...form.register('category')} />
            <Input label="Fecha del abono" type="date" {...form.register('date')} />
            <Input label="Notas (opcional)" placeholder="ej. Transferencia Nequi…" {...form.register('notas')} />
            <AttachmentPicker file={file} onChange={onFile} />
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {step > 1 && (
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep((v) => (v - 1) as StepNo)}>
              <ArrowLeft size={14} /> Atrás
            </Button>
          )}
          {step === 1 && <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>}
          {step < 3 ? (
            <Button key="next" type="button" notched className="flex-1" disabled={step === 1 && mainAmount <= 0} onClick={() => setStep((v) => (v + 1) as StepNo)}>
              Siguiente <ArrowRight size={14} />
            </Button>
          ) : (
            <Button key="confirm" type="button" notched className="flex-1" disabled={!canSubmit} onClick={() => void confirmPayment()}>
              <Coins size={14} /> {saving ? 'Guardando…' : 'Confirmar y registrar'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
