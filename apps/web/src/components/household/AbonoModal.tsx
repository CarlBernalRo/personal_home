import { useEffect, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { clsx } from 'clsx'
import { Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { Button } from '@/components/ui/Button'
import { formatCOP, HOUSEHOLD_DEBT_CATEGORIES, remainingOf, isPendingDebt, inPaymentOrder, creditorOf, owedByCreditor } from '@/shared'
import type { Rec } from './ledger'

/** One more debtor whose debt — to any creditor, not just the one this payment already goes to — this payment
 *  also covers. Settled straight away, same as a guest's abono already is: no confirmation step, the money
 *  really did move (just not necessarily through the primary payer's own creditor). */
export interface ExtraAbonoLine { id: string; debtor: string; amount: number; creditor: string | null }

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
  open: boolean
  onClose: () => void
  form: UseFormReturn<DebtForm>
  onSubmit: (data: DebtForm, extraLines: ExtraAbonoLine[]) => void
  debts: Rec[]
  /** abono aimed at one specific debt (from "Abonar" on a debt) */
  saldaTargetId: string | null
  /** debt picked in the general abono's selector */
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

const quickBtn = 'px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[#f3f5f6] text-[11px] font-semibold transition'

/** Abono modal with live simulation of the remaining balance. */
export function AbonoModal({ open, onClose, form, onSubmit, debts, saldaTargetId, selectedTargetDebtId, onPickTarget, members, guestIds, colorOf, photoOf, accounts, nameOf, debtorOptions, saving, file, onFile }: Props) {
  const watchedAmount = Number(form.watch('amount')) || 0
  const watchedDebtor = form.watch('debtor')
  const effectiveTargetId = saldaTargetId || selectedTargetDebtId
  const targetDebt = effectiveTargetId ? debts.find((d) => d.id === effectiveTargetId) : null
  const targetRemaining = targetDebt ? remainingOf(targetDebt) : 0
  const targetPaid = targetDebt ? (targetDebt.paidAbono || 0) + (targetDebt.crossedAmount || 0) : 0
  // Whom the abono goes to: the creditor of the debt it settles, or the one chosen when several people are owed
  const creditorLines = owedByCreditor(debts as any[], watchedDebtor, members)
  const watchedCreditor = form.watch('creditor')
  const creditorId = targetDebt ? creditorOf(targetDebt as any, members) : (watchedCreditor || (creditorLines.length === 1 ? creditorLines[0].creditor : null))
  const debtorPending = inPaymentOrder(debts.filter((d) => d.debtor === watchedDebtor && isPendingDebt(d) && (!creditorId || creditorOf(d as any, members) === creditorId)))
  const totalDebtorPending = debtorPending.reduce((s, d) => s + remainingOf(d), 0)
  const maxAbonable = targetDebt ? targetRemaining : totalDebtorPending
  const simRemaining = Math.max(0, maxAbonable - watchedAmount)
  const isOverMax = maxAbonable > 0 && watchedAmount > maxAbonable
  const setAmount = (v: number) => form.setValue('amount', v, { shouldValidate: true })

  // Covering someone else's debt in the same payment — "isabel pays her own and also Andrés's, even to a
  // different creditor". Settled immediately, same as a guest's abono: no confirmation step. Each line keeps
  // its own creditor, since the person being covered may owe more than one.
  const [extraLines, setExtraLines] = useState<ExtraAbonoLine[]>([])
  useEffect(() => { if (open) setExtraLines([]) }, [open])
  /** Everything this uid still owes, split by whom — not just to the primary payment's creditor. */
  const creditorsOf = (uid: string) => owedByCreditor(debts as any[], uid, members).filter((l) => l.owed > 0)
  const totalOwedAny = (uid: string) => creditorsOf(uid).reduce((s, l) => s + l.owed, 0)
  const addableMembers = members.filter((uid) => uid !== watchedDebtor && !extraLines.some((l) => l.debtor === uid) && totalOwedAny(uid) > 0)
  const extraTotal = extraLines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  function addExtraLine() {
    const uid = addableMembers[0]
    if (!uid) return
    const first = creditorsOf(uid)[0]
    setExtraLines((prev) => [...prev, { id: crypto.randomUUID(), debtor: uid, amount: first?.owed ?? 0, creditor: first?.creditor ?? null }])
  }
  function updateExtraLine(id: string, patch: Partial<ExtraAbonoLine>) {
    setExtraLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l))
  }
  function removeExtraLine(id: string) {
    setExtraLines((prev) => prev.filter((l) => l.id !== id))
  }

  // Typed more than this debtor owes: offer to route the leftover to whoever owes the most elsewhere in the
  // household, instead of just refusing the amount. If that person owes more than one creditor, which debt the
  // excess goes to is picked by hand below (their avatar per creditor), not guessed.
  const excess = Math.max(0, watchedAmount - maxAbonable)
  const excessCandidate = excess > 0
    ? [...addableMembers].sort((a, b) => totalOwedAny(b) - totalOwedAny(a))[0]
    : undefined
  const excessCandidateCreditors = excessCandidate ? creditorsOf(excessCandidate) : []
  function coverExcessWith(uid: string, creditor: string | null, owed: number) {
    const amount = Math.min(excess, owed)
    setExtraLines((prev) => {
      const existing = prev.find((l) => l.debtor === uid && l.creditor === creditor)
      if (existing) return prev.map((l) => l.id === existing.id ? { ...l, amount: l.amount + amount } : l)
      return [...prev, { id: crypto.randomUUID(), debtor: uid, amount, creditor }]
    })
    setAmount(maxAbonable)
  }

  return (
    <Modal open={open} onClose={onClose} title={targetDebt ? `Abonar a: ${targetDebt.concept}` : 'Registrar abono al hogar'}>
      <form onSubmit={form.handleSubmit((data) => onSubmit(data, extraLines))} className="space-y-4">
        <input type="hidden" {...form.register('tipo')} value="Abono" />

        {!saldaTargetId && creditorLines.length > 1 && (
          <Select
            label="¿A quién le abonas?"
            options={creditorLines.map((l) => ({ value: l.creditor ?? '', label: `${l.creditor ? nameOf(l.creditor) : 'Sin definir'} · le debes ${formatCOP(l.owed)}` }))}
            value={creditorId ?? ''}
            onChange={(e) => {
              const c = e.target.value
              form.setValue('creditor', c)
              onPickTarget(null)
              const owed = creditorLines.find((l) => (l.creditor ?? '') === c)?.owed ?? 0
              form.setValue('amount', owed)
            }}
          />
        )}

        {!saldaTargetId && debtorPending.length > 0 && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-[#dcf1eb]">¿Cómo deseas aplicar el abono?</label>
            <select
              value={selectedTargetDebtId || ''}
              onChange={(e) => {
                const val = e.target.value
                onPickTarget(val || null)
                if (val) {
                  const chosen = debtorPending.find((d) => d.id === val)
                  if (chosen) {
                    form.setValue('category', chosen.category || 'otros_hogar')
                    form.setValue('amount', remainingOf(chosen))
                  }
                } else {
                  form.setValue('amount', totalDebtorPending > 0 ? totalDebtorPending : 0)
                }
              }}
              className="w-full rounded-xl border border-brand-500/20 bg-[#0a1f2f] px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-500"
            >
              <option value="">Distribuir entre deudas pendientes (antiguas primero)</option>
              {debtorPending.map((d) => (
                <option key={d.id} value={d.id}>Abonar a: {d.concept} (Saldo: {formatCOP(remainingOf(d))})</option>
              ))}
            </select>
          </div>
        )}
        {targetDebt ? (
          <div className="bg-[#0d263a] border border-white/10 rounded-xl p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-pixel text-[9px] text-brand-400 uppercase tracking-widest font-bold block">Deuda seleccionada</span>
                <p className="text-sm font-bold text-[#f3f5f6]">{targetDebt.concept}</p>
                {creditorId && <p className="text-[11px] text-[#9aa4ac]">Le abonas a {nameOf(creditorId)}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <span className="text-[10px] text-[#8a929a] block">Saldo pendiente</span>
                <p className="text-base font-bold text-amber-300 font-mono">{formatCOP(targetRemaining)}</p>
              </div>
            </div>
            {targetPaid > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-[#9aa4ac] pt-1 border-t border-white/10 flex-wrap">
                <span>Monto original: <strong className="text-[#f3f5f6] font-mono">{formatCOP(targetDebt.amount)}</strong></span>
                <span className="text-brand-300 font-mono">· {formatCOP(targetPaid)} cubierto</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-[#0d263a] border border-white/10 rounded-xl p-3 flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] text-[#8a929a] block">Saldo total adeudado</span>
                <p className="text-sm font-bold text-[#f3f5f6]">{nameOf(watchedDebtor)}{creditorId ? ` → ${nameOf(creditorId)}` : ''}</p>
              </div>
              <p className="text-base font-bold text-amber-300 font-mono">{formatCOP(totalDebtorPending)}</p>
            </div>

          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[#dcf1eb]">Monto a abonar</label>
          <div className="currency-field has-suffix">
            <span className="currency-affix-prefix">$</span>
            <MoneyInput
              placeholder="0"
              {...form.register('amount')}
              className="w-full rounded-xl border border-brand-500/20 bg-[#0a1f2f] px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              aria-label="Monto a abonar en pesos colombianos"
            />
            <span className="currency-affix-suffix">COP</span>
          </div>
          {form.formState.errors.amount?.message && <p className="text-xs text-red-400">{form.formState.errors.amount.message}</p>}

          {maxAbonable > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button type="button" onClick={() => setAmount(maxAbonable)} className="px-2.5 py-1 rounded-lg bg-brand-500/15 hover:bg-brand-500/25 border border-brand-500/30 text-brand-300 text-[11px] font-semibold transition">
                Saldar todo ({formatCOP(maxAbonable)})
              </button>
              {maxAbonable >= 20000 && <button type="button" onClick={() => setAmount(Math.round(maxAbonable / 2))} className={quickBtn}>50% ({formatCOP(Math.round(maxAbonable / 2))})</button>}
              {maxAbonable > 100000 && <button type="button" onClick={() => setAmount(100000)} className={quickBtn}>$100.000</button>}
              {maxAbonable > 200000 && <button type="button" onClick={() => setAmount(200000)} className={quickBtn}>$200.000</button>}
            </div>
          )}
        </div>

        {watchedAmount > 0 && maxAbonable > 0 && (
          <div className={clsx(
            'p-3.5 rounded-xl border text-xs space-y-1.5 transition-all',
            isOverMax && !excessCandidate ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : isOverMax ? 'bg-sky-500/10 border-sky-400/30 text-sky-200'
              : simRemaining === 0 ? 'bg-brand-500/20 border-brand-400/50 text-brand-300'
              : 'bg-[#0d263a] border-white/10 text-[#f0fae8]',
          )}>
            <div className="flex items-center justify-between font-mono">
              <span className="text-[#8a929a]">Saldo actual adeudado:</span>
              <span>{formatCOP(maxAbonable)}</span>
            </div>
            <div className="flex items-center justify-between font-mono text-sky-300 font-semibold">
              <span>− Tu abono:</span>
              <span>{formatCOP(watchedAmount)}</span>
            </div>
            <div className="border-t border-white/10 pt-1.5 flex items-center justify-between font-mono font-bold">
              <span>Nuevo saldo pendiente:</span>
              <span className={simRemaining === 0 ? 'text-emerald-300' : 'text-amber-300'}>{formatCOP(simRemaining)}</span>
            </div>
            {isOverMax && excessCandidate ? (
              <div className="pt-1 space-y-2">
                <p className="text-[11px]">
                  Estás pagando <strong className="font-mono">{formatCOP(excess)}</strong> más de lo que debes. Ese excedente puede cubrir parte de lo que <strong>{nameOf(excessCandidate)}</strong> debe{excessCandidateCreditors.length > 1 ? ' — elige a cuál de sus deudas:' : '.'}
                </p>
                {excessCandidateCreditors.length === 1 ? (
                  <button
                    type="button"
                    onClick={() => coverExcessWith(excessCandidate, excessCandidateCreditors[0].creditor, excessCandidateCreditors[0].owed)}
                    className="w-full py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 text-[11px] font-semibold transition"
                  >
                    Sí, cubrir {formatCOP(Math.min(excess, excessCandidateCreditors[0].owed))} de lo que le debe a {nameOf(excessCandidateCreditors[0].creditor)}
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {excessCandidateCreditors.map((l) => (
                      <button
                        key={l.creditor ?? 'sin-definir'}
                        type="button"
                        onClick={() => coverExcessWith(excessCandidate, l.creditor, l.owed)}
                        className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-100 text-[11px] font-semibold transition"
                      >
                        {l.creditor && <Avatar name={nameOf(l.creditor)} photoURL={photoOf(l.creditor)} color={colorOf(l.creditor)} size={20} className="!ring-sky-300/40" />}
                        {nameOf(l.creditor)} · {formatCOP(Math.min(excess, l.owed))}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-[#8a929a] pt-1">
                {isOverMax
                  ? `El abono no puede superar el saldo pendiente de ${formatCOP(maxAbonable)}.`
                  : simRemaining === 0
                    ? '¡Con este abono la deuda quedará 100% saldada!'
                    : `Se abonarán ${formatCOP(watchedAmount)} para disminuir la deuda. Quedará un saldo pendiente de ${formatCOP(simRemaining)}.`}
              </p>
            )}
          </div>
        )}

        {creditorId && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#dcf1eb]">¿Cubres también la deuda de alguien más?</label>
            {extraLines.map((line) => {
              const lineCreditors = creditorsOf(line.debtor)
              return (
                <div key={line.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Select
                      options={[
                        { value: line.debtor, label: `${nameOf(line.debtor)}${guestIds.includes(line.debtor) ? ' (invitado)' : ''} · debe ${formatCOP(totalOwedAny(line.debtor))}` },
                        ...addableMembers.map((uid) => ({ value: uid, label: `${nameOf(uid)}${guestIds.includes(uid) ? ' (invitado)' : ''} · debe ${formatCOP(totalOwedAny(uid))}` })),
                      ]}
                      value={line.debtor}
                      onChange={(e) => {
                        const uid = e.target.value
                        const first = creditorsOf(uid)[0]
                        updateExtraLine(line.id, { debtor: uid, amount: first?.owed ?? 0, creditor: first?.creditor ?? null })
                      }}
                      className="flex-1"
                    />
                    <div className="currency-field w-32 flex-shrink-0">
                      <span className="currency-affix-prefix">$</span>
                      <MoneyInput
                        placeholder="0"
                        value={String(line.amount)}
                        onChange={(e) => updateExtraLine(line.id, { amount: Number(e.target.value) || 0 })}
                        className="w-full rounded-lg border border-brand-500/20 bg-[#0a1f2f] px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500"
                        aria-label={`Monto que cubres por ${nameOf(line.debtor)}`}
                      />
                    </div>
                    <button type="button" onClick={() => removeExtraLine(line.id)} aria-label={`Quitar a ${nameOf(line.debtor)}`} className="p-2 rounded-lg text-[#8a929a] hover:text-red-300 hover:bg-red-500/10 transition flex-shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                  {lineCreditors.length > 1 && (
                    <div className="pl-1 space-y-1">
                      <p className="text-[10px] text-[#8a929a]">{nameOf(line.debtor)} le debe a varias personas — ¿a cuál le cubres?</p>
                      <div className="flex flex-wrap gap-2">
                        {lineCreditors.map((l) => (
                          <button
                            key={l.creditor ?? 'sin-definir'}
                            type="button"
                            onClick={() => updateExtraLine(line.id, { creditor: l.creditor, amount: l.owed })}
                            className={clsx(
                              'flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[11px] font-semibold transition',
                              line.creditor === l.creditor ? 'bg-brand-500/20 border-brand-400/60 text-brand-200' : 'bg-white/5 border-white/15 text-[#c7ccd1] hover:border-white/30',
                            )}
                          >
                            {l.creditor && <Avatar name={nameOf(l.creditor)} photoURL={photoOf(l.creditor)} color={colorOf(l.creditor)} size={20} className="!ring-white/15" />}
                            {nameOf(l.creditor)} · {formatCOP(l.owed)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {addableMembers.length > 0 && (
              <button type="button" onClick={addExtraLine} className={clsx(quickBtn, 'flex items-center gap-1')}>
                <Plus size={12} /> Agregar a alguien más
              </button>
            )}
            {extraTotal > 0 && (
              <p className="text-[11px] text-[#8a929a]">Total del pago: <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(watchedAmount + extraTotal)}</span> (tu parte + lo que cubres por otros).</p>
            )}
          </div>
        )}

        <Input label="Concepto (opcional)" placeholder="ej. Abono de mercado…" {...form.register('concept')} error={form.formState.errors.concept?.message} />
        <Select label="¿Quién abona?" options={debtorOptions} {...form.register('debtor')} />
        <AccountSelect
          label="¿De qué cuenta sale el pago?"
          accounts={accounts}
          value={form.watch('accountId') ?? ''}
          onChange={(id) => form.setValue('accountId', id)}
          noneLabel="Sin descontar de una cuenta"
          outflow={watchedAmount + extraTotal}
        />
        <Select label="Categoría" options={CAT_OPTIONS} {...form.register('category')} />
        <Input label="Fecha del abono" type="date" {...form.register('date')} />
        <Input label="Notas (opcional)" placeholder="ej. Transferencia Nequi…" {...form.register('notas')} />
        <AttachmentPicker file={file} onChange={onFile} />

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" notched className="flex-1" disabled={saving || isOverMax}>
            {saving ? 'Guardando…' : 'Registrar abono'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
