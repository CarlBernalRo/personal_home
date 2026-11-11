import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { ArrowLeft, ArrowRight, Check, ShoppingBag, UserPlus2, Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Input, preventNegativeNumberKey } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createHouseholdExpense, notifyHouseholdMembers } from '@/lib/firestore'
import { saveAttachment } from '@/lib/attachments'
import { formatCOP, resolveExpenseShares, settleExpenseContributions, SplitValidationError, HOUSEHOLD_DEBT_CATEGORIES } from '@/shared'
import type { ExpensePayerInput, ExpenseShareInput, SplitMode } from '@/shared'

const CAT_OPTIONS = HOUSEHOLD_DEBT_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))
const SPLIT_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'equal',      label: 'Partes iguales' },
  { value: 'percentage', label: 'Porcentaje por persona' },
  { value: 'fixed',      label: 'Monto fijo por persona' },
]

const basicsSchema = z.object({
  description: z.string().min(1, 'Describe el gasto'),
  amount:      z.coerce.number().positive('El monto debe ser mayor a 0'),
  category:    z.string().min(1),
  date:        z.string().min(1),
  hasDueDate:  z.boolean(),
  dueDate:     z.string().optional(),
  notes:       z.string().optional(),
}).refine((d) => !d.hasDueDate || !!d.dueDate, { message: 'Indica la fecha acordada', path: ['dueDate'] })

type BasicsForm = z.infer<typeof basicsSchema>

export interface HouseholdExpenseMember {
  uid: string
  name: string
  photoURL?: string | null
  color?: string
}

type Step = 1 | 2 | 3 | 4

const STEP_TITLE: Record<Step, string> = {
  1: 'Datos del gasto',
  2: '¿Quiénes participan?',
  3: '¿Quién puso el dinero?',
  4: 'Reparto y resumen',
}

export function HouseholdExpenseModal({ open, onClose, householdId, members, guestIds, currentUserUid, accounts, onCreated, onAddGuest }: {
  open: boolean
  onClose: () => void
  householdId: string
  members: HouseholdExpenseMember[]
  guestIds: string[]
  currentUserUid: string
  /** The creator's own accounts, so they can say which one their share of the payment came out of. */
  accounts: { id: string; name: string; balance: number }[]
  onCreated: () => void
  /** Adds a guest to the household without leaving this form — optional only so the modal still works if a caller doesn't wire it. */
  onAddGuest?: (name: string) => Promise<{ id: string; name: string }>
}) {
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState<Step>(1)
  const [guestName, setGuestName] = useState('')
  const [addingGuest, setAddingGuest] = useState(false)
  const [showGuestInput, setShowGuestInput] = useState(false)
  const [payerAccountId, setPayerAccountId] = useState('')
  const [file, setFile] = useState<File | null>(null)

  // Step 2 — who shares the expense. The person filling the form gets their own explicit yes/no; everyone
  // else (real members and guests alike) is a plain multi-select, defaulting to everyone in.
  const [iParticipate, setIParticipate] = useState(true)
  const [otherParticipants, setOtherParticipants] = useState<Set<string>>(
    () => new Set(members.filter((m) => m.uid !== currentUserUid).map((m) => m.uid)),
  )

  // Step 3 — who fronted money, and how much. Defaults to "I paid for all of it" once the person reaches this
  // step, the common case — they can uncheck themselves or add others.
  const [payerIds, setPayerIds] = useState<Set<string>>(new Set())
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({})

  // Step 4 — how the total is divided among the participants.
  const [splitMode, setSplitMode] = useState<SplitMode>('equal')
  const [shareValues, setShareValues] = useState<Record<string, string>>({})

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<BasicsForm>({
    resolver: zodResolver(basicsSchema),
    defaultValues: {
      date: format(new Date(), 'yyyy-MM-dd'), category: HOUSEHOLD_DEBT_CATEGORIES[0].id, hasDueDate: false,
    },
  })
  const basics = watch()
  const amount = Number(basics.amount) || 0

  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.name ?? 'Alguien'
  const isGuest = (uid: string) => guestIds.includes(uid)
  const needsConfirmation = (uid: string) => uid !== currentUserUid && !isGuest(uid)

  const participantIds = useMemo(
    () => [...(iParticipate ? [currentUserUid] : []), ...otherParticipants],
    [iParticipate, otherParticipants],
  )
  // anyone can have fronted money — not only participants (e.g. someone pays entirely for others, without owing a share)
  const payerCandidates = members

  function resetAll() {
    setStep(1)
    setIParticipate(true)
    setOtherParticipants(new Set(members.filter((m) => m.uid !== currentUserUid).map((m) => m.uid)))
    setPayerIds(new Set())
    setPayerAmounts({})
    setPayerAccountId('')
    setSplitMode('equal')
    setShareValues({})
    setGuestName('')
    setShowGuestInput(false)
    setFile(null)
    reset({ date: format(new Date(), 'yyyy-MM-dd'), category: HOUSEHOLD_DEBT_CATEGORIES[0].id, hasDueDate: false })
  }

  async function addGuestInline() {
    if (!onAddGuest || !guestName.trim()) return
    setAddingGuest(true)
    try {
      const guest = await onAddGuest(guestName.trim())
      setOtherParticipants((prev) => new Set(prev).add(guest.id))
      setGuestName('')
      showToast(`${guest.name} agregado — ya puedes incluirlo en el reparto`, 'success')
    } catch (err: any) {
      showToast(err?.message ?? 'No se pudo agregar el invitado', 'error')
    } finally {
      setAddingGuest(false)
    }
  }

  function close() { onClose(); resetAll() }

  // Entering step 3 fresh: default to "I paid for the whole thing" — the common case.
  function goToPayers() {
    if (payerIds.size === 0 && iParticipate) {
      setPayerIds(new Set([currentUserUid]))
      setPayerAmounts({ [currentUserUid]: String(amount) })
    }
    setStep(3)
  }

  function togglePayer(uid: string) {
    setPayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) { next.delete(uid); setPayerAmounts((a) => { const { [uid]: _drop, ...rest } = a; return rest }) }
      else next.add(uid)
      return next
    })
  }

  const totalPaid = [...payerIds].reduce((s, uid) => s + (Number(payerAmounts[uid]) || 0), 0)
  const payersValid = payerIds.size > 0 && totalPaid === amount

  const shareInputs: ExpenseShareInput[] = useMemo(() => participantIds.map((uid) => ({
    memberId: uid,
    percentage: splitMode === 'percentage' ? Number(shareValues[uid]) || 0 : undefined,
    fixedAmount: splitMode === 'fixed' ? Number(shareValues[uid]) || 0 : undefined,
  })), [participantIds, splitMode, shareValues])

  // Live preview of the split and the settlement — the exact same pure functions firestore.ts uses, so what's
  // shown here is exactly what gets written.
  const preview = useMemo(() => {
    if (amount <= 0 || participantIds.length === 0) return null
    try {
      const shares = resolveExpenseShares(amount, participantIds[0], splitMode, shareInputs)
      const payers: ExpensePayerInput[] = [...payerIds].map((uid) => ({ memberId: uid, amount: Number(payerAmounts[uid]) || 0 }))
      const edges = settleExpenseContributions(shares.map((s) => ({ memberId: s.memberId, amount: s.amount })), payers)
      return { shares, edges, error: null as string | null }
    } catch (e) {
      return { shares: [], edges: [], error: e instanceof SplitValidationError ? e.message : 'No se pudo calcular la división' }
    }
  }, [amount, participantIds, splitMode, shareInputs, payerIds, payerAmounts])

  // Paid vs. owed per person — makes the settlement edges below legible instead of a black box.
  const balanceRows = useMemo(() => {
    const uids = new Set<string>([...participantIds, ...payerIds])
    return [...uids].map((uid) => {
      const paid = payerIds.has(uid) ? Number(payerAmounts[uid]) || 0 : 0
      const owed = preview?.shares.find((s) => s.memberId === uid)?.amount ?? 0
      return { uid, paid, owed, net: paid - owed }
    })
  }, [participantIds, payerIds, payerAmounts, preview])

  async function onSubmit() {
    if (!preview || preview.error) return
    setSaving(true)
    try {
      const payers: ExpensePayerInput[] = [...payerIds].map((uid) => ({ memberId: uid, amount: Number(payerAmounts[uid]) || 0 }))
      // shared with the whole household (minus guests, who have no account to read it from)
      const attachmentId = file ? await saveAttachment(currentUserUid, file, members.filter((m) => m.uid !== currentUserUid && !isGuest(m.uid)).map((m) => m.uid)) : undefined
      const { pendingFor } = await createHouseholdExpense({
        householdId,
        description:  basics.description,
        amount,
        category:     basics.category,
        date:         new Date(basics.date + 'T12:00:00'),
        splitMode,
        shareInputs,
        payers,
        dueDate:      basics.hasDueDate && basics.dueDate ? new Date(basics.dueDate + 'T12:00:00') : null,
        notes:        basics.notes ?? '',
        registeredBy: currentUserUid,
        registeredByAccountId: payerAccountId || null,
        ...(attachmentId ? { attachmentId } : {}),
      }, guestIds)

      close()
      onCreated()
      showToast('Gasto compartido registrado', 'success')

      const me = nameOf(currentUserUid)
      notifyHouseholdMembers(participantIds.filter((id) => id !== currentUserUid && !isGuest(id)), {
        fromUid: currentUserUid, zone: 'hogar', severity: 'info',
        title: `${me} registró un gasto compartido`, body: `${basics.description} · ${formatCOP(amount)}.`, link: `/hogar?id=${householdId}`,
      }).catch(() => {})
      for (const uid of pendingFor) {
        notifyHouseholdMembers([uid], {
          fromUid: currentUserUid, zone: 'hogar', severity: 'info',
          title: `${me} dice que pusiste dinero para "${basics.description}"`,
          body: `${formatCOP(payerAmounts[uid] ? Number(payerAmounts[uid]) : 0)}. Confírmalo para que se registre como tu gasto y te empiecen a deber.`,
          link: `/hogar?id=${householdId}`,
        }).catch(() => {})
      }
    } catch (err: any) {
      showToast(err?.message ?? 'Error al registrar el gasto', 'error')
    } finally {
      setSaving(false)
    }
  }

  const canNext1 = !errors.description && !errors.amount && !errors.dueDate && basics.description && amount > 0 && basics.category && basics.date && (!basics.hasDueDate || basics.dueDate)
  const canNext2 = participantIds.length > 0
  const canNext3 = payersValid

  return (
    <Modal open={open} onClose={close} title="Nuevo gasto compartido">
      <div className="space-y-4">
        <div className="flex items-center gap-1.5">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-brand-400' : 'bg-white/10'}`} />
          ))}
        </div>
        <p className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Paso {step} de 4 · {STEP_TITLE[step]}</p>

        {step === 1 && (
          <div className="space-y-4">
            <Input label="Descripción" placeholder="ej. Hotel del viaje" {...register('description')} error={errors.description?.message} />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[#dcf1eb]">Monto total</label>
              <div className="currency-field has-suffix">
                <span className="currency-affix-prefix">$</span>
                <MoneyInput placeholder="0" {...register('amount')} className="w-full rounded-xl border border-brand-500/20 bg-[#0a1f2f] px-3 py-2.5 text-sm text-white outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" aria-label="Monto total en pesos colombianos" />
                <span className="currency-affix-suffix">COP</span>
              </div>
              {errors.amount?.message && <p className="text-xs text-red-400">{errors.amount.message}</p>}
            </div>
            <Select label="Categoría" options={CAT_OPTIONS} {...register('category')} />
            <Input label="Fecha del gasto" type="date" {...register('date')} />
            <label className="flex items-center gap-2 text-sm text-[#dcf1eb] cursor-pointer select-none">
              <input type="checkbox" {...register('hasDueDate')} className="cursor-pointer" />
              Acordamos una fecha límite de pago
            </label>
            {basics.hasDueDate ? (
              <Input label="Fecha límite" type="date" {...register('dueDate')} error={errors.dueDate?.message} />
            ) : (
              <p className="text-xs text-[#8a929a]">Sin fecha pactada: la deuda queda abierta hasta que se liquide.</p>
            )}
            <Input label="Notas (opcional)" placeholder="ej. Acordado el 29 oct" {...register('notes')} />
            <AttachmentPicker file={file} onChange={setFile} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-[#dcf1eb]">Toca a quienes les toca pagar una parte</p>
              <p className="text-xs text-[#8a929a]">Es decir, entre quiénes se divide el gasto. Más adelante eliges aparte quién puso el dinero — no tienen que ser las mismas personas.</p>
            </div>
            {members.length <= 1 && <p className="text-xs text-[#8a929a]">Todavía no hay nadie más en este hogar — agrega un invitado con el botón "+".</p>}

            <div className="flex flex-wrap gap-3">
              {members.map((m) => {
                const selected = m.uid === currentUserUid ? iParticipate : otherParticipants.has(m.uid)
                return (
                  <button
                    key={m.uid}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Quitar' : 'Incluir'} a ${m.name}`}
                    onClick={() => {
                      if (m.uid === currentUserUid) setIParticipate((v) => !v)
                      else setOtherParticipants((prev) => { const n = new Set(prev); n.has(m.uid) ? n.delete(m.uid) : n.add(m.uid); return n })
                    }}
                    className="flex w-16 flex-col items-center gap-1.5"
                  >
                    <span className={`flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 ease-out ${selected ? 'scale-105 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]' : 'scale-100 opacity-70 hover:opacity-100'}`}>
                      <Avatar name={m.name} photoURL={m.photoURL} color={m.color} size={56} className={selected ? '!ring-brand-400' : '!ring-white/15'} />
                    </span>
                    <span className={`max-w-full truncate text-[11px] transition-colors ${selected ? 'font-semibold text-brand-300' : 'text-[#8a929a]'}`}>
                      {m.uid === currentUserUid ? 'Tú' : m.name}{isGuest(m.uid) ? ' · inv.' : ''}
                    </span>
                  </button>
                )
              })}

              {onAddGuest && (
                <button
                  type="button"
                  onClick={() => setShowGuestInput(true)}
                  aria-label="Agregar invitado"
                  className="flex w-16 flex-col items-center gap-1.5"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-white/20 text-[#8a929a] transition hover:border-brand-400/60 hover:text-brand-300">
                    <UserPlus2 size={18} />
                  </span>
                  <span className="text-[11px] text-[#8a929a]">Invitado</span>
                </button>
              )}
            </div>

            {onAddGuest && showGuestInput && (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Nombre del invitado"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="flex-1"
                  aria-label="Nombre del nuevo invitado"
                />
                <Button type="button" variant="secondary" disabled={!guestName.trim() || addingGuest} onClick={addGuestInline}>
                  {addingGuest ? 'Agregando…' : 'Agregar'}
                </Button>
              </div>
            )}
            {participantIds.length === 0 && <p className="text-xs text-red-400">Elige al menos a una persona.</p>}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-[#dcf1eb]">¿Quién puso el dinero?</p>
              <p className="text-xs text-[#9aa4ac]">Marca a quien pagó y cuánto puso cada uno. No tienen que ser quienes participan: alguien puede pagar sin que le toque una parte. Entre todos debe sumar el total del gasto.</p>
            </div>
            <div className="space-y-2">
              {payerCandidates.map((m) => {
                const on = payerIds.has(m.uid)
                return (
                  <div key={m.uid} className="space-y-1.5">
                    <div className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${on ? 'border-brand-400/50 bg-brand-500/10' : 'border-white/10 bg-[#0d263a]'}`}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => togglePayer(m.uid)}
                        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border transition ${on ? 'border-brand-400 bg-brand-500 text-[#051018]' : 'border-white/20 text-transparent'}`}
                      ><Check size={14} /></button>
                      <span className="min-w-0 flex-1 truncate text-sm text-[#f0fae8]">{m.name}{isGuest(m.uid) ? <span className="ml-1.5 text-[10px] text-[#8a929a]">invitado</span> : null}</span>
                      {on && (
                        <div className="currency-field w-36 flex-shrink-0">
                          <span className="currency-affix-prefix">$</span>
                          <MoneyInput
                            placeholder="0"
                            value={payerAmounts[m.uid] ?? ''}
                            onChange={(e) => { const v = e.target.value; setPayerAmounts((prev) => ({ ...prev, [m.uid]: v })) }}
                            className="w-full rounded-lg border border-brand-500/20 bg-[#0a1f2f] px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500"
                            aria-label={`Monto puesto por ${m.name}`}
                          />
                        </div>
                      )}
                    </div>
                    {on && m.uid === currentUserUid && accounts.length > 0 && (
                      <div className="ml-3 border-l-2 border-brand-400/30 pl-3">
                        <AccountSelect
                          label="¿De qué cuenta salió tu parte?"
                          accounts={accounts}
                          value={payerAccountId}
                          onChange={setPayerAccountId}
                          noneLabel="Sin cuenta (solo queda registrado)"
                          outflow={Number(payerAmounts[m.uid]) || 0}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className={`flex items-center justify-between rounded-xl border p-3 text-xs ${totalPaid === amount ? 'border-brand-500/30 bg-brand-500/10 text-brand-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
              <span className="flex-shrink-0">Puesto entre todos</span>
              <span className="flex-shrink-0 font-mono font-semibold">{formatCOP(totalPaid)} / {formatCOP(amount)}</span>
            </div>
            {payerIds.size === 0 && <p className="text-xs text-red-400">Marca al menos a quien puso el dinero.</p>}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0d263a] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#f3f5f6]">{basics.description}</p>
                <p className="text-[11px] text-[#9aa4ac]">{format(new Date(basics.date + 'T12:00:00'), 'dd MMM yyyy')}</p>
              </div>
              <span className="flex-shrink-0 font-mono text-base font-bold text-white">{formatCOP(amount)}</span>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-[#dcf1eb]">¿Cómo se reparte entre quienes participan?</p>
                <p className="text-xs text-[#9aa4ac]">Esto decide cuánto le toca a cada uno, sin importar quién puso el dinero.</p>
              </div>
              <Select label="Modo de reparto" options={SPLIT_OPTIONS} value={splitMode} onChange={(e) => setSplitMode(e.target.value as SplitMode)} />
              {splitMode === 'equal' ? (
                amount > 0 && (
                  <p className="text-xs text-[#9aa4ac] bg-[#0d263a] border border-white/10 rounded-xl p-3">
                    A cada uno de los {participantIds.length} le corresponden <span className="font-semibold font-mono text-amber-300">{formatCOP(Math.round(amount / participantIds.length))}</span>.
                  </p>
                )
              ) : (
                <div className="space-y-2">
                  {participantIds.map((uid) => (
                    <div key={uid} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm text-[#dcf1eb]">{nameOf(uid)}{uid === currentUserUid ? ' (tú)' : ''}</span>
                      <div className="currency-field w-36 flex-shrink-0">
                        <span className="currency-affix-prefix">{splitMode === 'percentage' ? '%' : '$'}</span>
                        {splitMode === 'percentage' ? (
                          <input
                            type="number" min="0" step="any" placeholder="0" onKeyDown={preventNegativeNumberKey}
                            value={shareValues[uid] ?? ''}
                            onChange={(e) => setShareValues((prev) => ({ ...prev, [uid]: e.target.value }))}
                            className="w-full rounded-lg border border-brand-500/20 bg-[#0a1f2f] px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500"
                            aria-label={`Porcentaje para ${nameOf(uid)}`}
                          />
                        ) : (
                          <MoneyInput
                            placeholder="0"
                            value={shareValues[uid] ?? ''}
                            onChange={(e) => { const v = e.target.value; setShareValues((prev) => ({ ...prev, [uid]: v })) }}
                            className="w-full rounded-lg border border-brand-500/20 bg-[#0a1f2f] px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500"
                            aria-label={`Monto para ${nameOf(uid)}`}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {preview?.error && <p className="text-xs text-red-400">{preview.error}</p>}
            </div>

            {preview && !preview.error && (
              <div className="space-y-3 border-t border-white/10 pt-4">
                <div>
                  <p className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Balance por persona</p>
                  <p className="mb-1 text-[11px] text-[#8a929a]">Lo que puso cada uno contra lo que le tocaba. <span className="text-brand-300">Verde</span> = le deben, <span className="text-amber-300">ámbar</span> = debe.</p>
                  <div className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0d263a]">
                    {balanceRows.map((row) => (
                      <div key={row.uid} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs text-[#dcf1eb]">{nameOf(row.uid)}{row.uid === currentUserUid ? ' (tú)' : ''}</span>
                        {row.paid > 0 && <span className="flex-shrink-0 text-[11px] text-[#8a929a]">puso {formatCOP(row.paid)}</span>}
                        <span className={`flex-shrink-0 font-mono text-xs font-bold ${row.net > 0 ? 'text-brand-300' : row.net < 0 ? 'text-amber-300' : 'text-[#6f7a83]'}`}>
                          {row.net === 0 ? '—' : `${row.net > 0 ? '+' : ''}${formatCOP(row.net)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Para quedar en paz</p>
                  <p className="mb-1 text-[11px] text-[#8a929a]">Las transferencias que hacen falta para saldar todo.</p>
                  {preview.edges.length === 0 ? (
                    <p className="text-xs text-[#8a929a]">Nadie queda debiendo nada.</p>
                  ) : (
                    <div className="divide-y divide-amber-500/10 rounded-xl border border-amber-500/20 bg-amber-500/[0.04]">
                      {preview.edges.map((e, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-xs text-[#dcf1eb]">{nameOf(e.debtor)} <ArrowRight size={11} className="inline -mt-0.5 text-amber-400" /> {nameOf(e.creditor)}</span>
                          <span className="flex-shrink-0 font-mono text-xs font-bold text-amber-300">{formatCOP(e.amount)}</span>
                          {needsConfirmation(e.creditor) && (
                            <span className="flex-shrink-0 rounded-full border border-sky-400/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-300">pend.</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {preview.edges.some((e) => needsConfirmation(e.creditor)) && (
                    <p className="mt-1 flex items-start gap-1.5 text-[11px] text-[#9aa4ac]">
                      <Users size={12} className="mt-0.5 flex-shrink-0" /> "Pend." no cuenta como deuda todavía — se activa cuando esa persona confirme.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {step > 1 && (
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep((s) => (s - 1) as Step)}>
              <ArrowLeft size={14} /> Atrás
            </Button>
          )}
          {step === 1 && <Button type="button" variant="secondary" className="flex-1" onClick={close}>Cancelar</Button>}
          {step < 4 ? (
            <Button
              type="button"
              notched
              className="flex-1"
              disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2) || (step === 3 && !canNext3)}
              onClick={() => (step === 2 ? goToPayers() : setStep((s) => (s + 1) as Step))}
            >
              Siguiente <ArrowRight size={14} />
            </Button>
          ) : (
            <Button type="button" notched className="flex-1" disabled={saving || !preview || !!preview.error} onClick={onSubmit}>
              <ShoppingBag size={14} /> {saving ? 'Guardando…' : 'Guardar gasto'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
