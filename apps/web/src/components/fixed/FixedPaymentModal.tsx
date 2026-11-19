import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarCog, CalendarX2, Check, Pencil, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { IconActionButton } from '@/components/ui/IconActionButton'
import { Select } from '@/components/ui/Select'
import { NotesCard, PaymentComment } from '@/components/fixed/NotesCard'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { removeAttachment, saveAttachment, withAttachment } from '@/lib/attachments'
import { addFixedExpensePayments, deleteFixedExpensePayment, deleteFixedExpense, updateFixedExpensePayment } from '@/lib/firestore'
import { formatCOP, paymentKey, amountFor, effectiveDue, monthKey, type MonthEntry, type OwedLine } from '@/shared'
import type { SalaryState } from '@/hooks/useSalary'
import { TagChip } from '@/components/ui/TagPicker'
import { useTags } from '@/hooks/useTags'
import { tagsOf } from '@/shared'

/** The tags of a fixed expense, under its amount (its payments carry them). */
function FixedTags({ fe }: { fe: any }) {
  const { tags } = useTags()
  const mine = tagsOf(fe.tagIds, tags)
  if (mine.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[#9aa4ac]">Etiquetas:</span>
      {mine.map((t) => <TagChip key={t.id} tag={t} size="sm" />)}
    </div>
  )
}

const paySchema = z.object({
  paymentDate: z.string().min(1, 'Fecha requerida'),
})
type PayForm = z.infer<typeof paySchema>

const monthLabelOf = (m: string) => {
  const [y, mm] = m.split('-').map(Number)
  return format(new Date(y, mm - 1, 1), 'MMM yyyy', { locale: es })
}

interface Props {
  /** The fixed expense of a period that was picked (null = closed). */
  entry: MonthEntry<any> | null
  onClose: () => void
  expenses: any[]
  paymentIndex: Map<string, any>
  salary: SalaryState
  /** Something was paid, corrected or removed: read the fixed expenses again. */
  onChanged: () => Promise<void> | void
  /** Change a scheduled (one-off) expense in its own dialog. */
  onEditScheduled: (fe: any) => void
}

/**
 * The dialog of one fixed expense in a period: pay what is owed (one or several months at once, from an account,
 * with a comment and a receipt), or, once paid, see the payment, correct it or remove it.
 */
export function FixedPaymentModal({ entry, onClose, expenses, paymentIndex, salary, onChanged, onEditScheduled }: Props) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const ask = useConfirm()
  const accounts = salary.accounts
  const today = new Date()
  const currentMonth = monthKey(today)
  const payForm = useForm<PayForm>({ resolver: zodResolver(paySchema) as any })

  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<{ fe: any; month: string; owed: OwedLine[] } | null>(null)
  const [lines, setLines] = useState<OwedLine[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [lineError, setLineError] = useState<string | null>(null)
  const [editPay, setEditPay] = useState<{ amount: string; date: string; accountId: string; comment: string } | null>(null)
  const [savingPay, setSavingPay] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [comment, setComment] = useState('')
  const [payFile, setPayFile] = useState<File | null>(null)
  const [editFile, setEditFile] = useState<File | null>(null)
  const [dropAttachment, setDropAttachment] = useState(false)

  // a new pick prepares the form: what is owed, all of it checked, today's date and the usual account
  useEffect(() => {
    if (!entry) { setSelected(null); return }
    const { fe, hostMonth, owed } = entry
    if (owed.length > 0) {
      const due = effectiveDue(fe, hostMonth)
      const defaultDate = hostMonth <= currentMonth || !due ? today : due
      payForm.reset({ paymentDate: format(defaultDate, 'yyyy-MM-dd') })
      setLines(owed.map((l) => ({ ...l })))
      setChecked(owed.map((l) => l.occMonth))
      setLineError(null)
      setComment('')
      setPayFile(null)
      setAccountId(salary.pickAccount(fe.accountId))
    }
    setSelected({ fe, month: hostMonth, owed })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry])

  const close = () => { setSelected(null); onClose() }
  const load = async () => { await onChanged() }
  const setProgramming = ({ editing }: { editing: any }) => onEditScheduled(editing)

  // For a scheduled (one-off) expense: change the schedule itself, or remove it
  const scheduledIcons = selected?.fe.oneTime ? (
    <>
      <span className="w-px h-6 bg-white/15" aria-hidden="true" />
      <IconActionButton icon={CalendarCog} tone="edit" label="Editar el gasto programado: concepto, fecha, monto o cuenta" onClick={() => { const fe = selected.fe; close(); setProgramming({ editing: fe }) }} />
      <IconActionButton icon={CalendarX2} tone="danger" label="Eliminar el gasto programado (si ya lo pagaste, el pago se conserva)" onClick={() => deleteScheduled(selected.fe)} />
    </>
  ) : null

  // closing or switching payment leaves the correction form
  useEffect(() => { setEditPay(null) }, [selected])

  const selectedPayment = selected ? paymentIndex.get(paymentKey(selected.fe.id, selected.month)) : undefined

  async function onPay(data: PayForm) {
    if (!user || !selected) return
    const toPay = lines.filter((l) => checked.includes(l.occMonth))
    if (toPay.length === 0) {
      setLineError('Selecciona al menos un pago')
      return
    }
    if (toPay.some((l) => !(l.amount > 0))) {
      setLineError('Escribe cuánto pagaste (mayor a 0)')
      return
    }
    setSaving(true)
    try {
      const [y, m, d] = data.paymentDate.split('-').map(Number)
      // One payment per owed month, so each month keeps its own history
      // one picture for the whole payment: every month paid in it points to the same copy
      await withAttachment(user.uid, payFile, (attachmentId) => addFixedExpensePayments(toPay.map((l) => ({
        fixedExpenseId: selected.fe.id,
        userId:         user.uid,
        concept:        selected.fe.concept,
        paidAmount:     l.amount,
        ...(accountId ? { accountId } : {}),
        month:          l.occMonth,
        paymentDate:    new Date(y, m - 1, d),
        notes:          comment.trim(),
        ...(selected.fe.sharedWith?.length ? { sharedWith: selected.fe.sharedWith } : {}),
        ...(attachmentId ? { attachmentId } : {}),
      }))))
      salary.rememberAccount(accountId)
      close()
      await load()
      showToast(toPay.length > 1 ? `${toPay.length} pagos registrados` : 'Pago registrado', 'success')
    } catch {
      showToast('Error al registrar pago', 'error')
    } finally {
      setSaving(false)
    }
  }

  // A scheduled payment can be removed from its own dialog; what was already paid stays registered
  async function deleteScheduled(fe: any) {
    const wasPaid = [...paymentIndex.keys()].some((k) => k.startsWith(`${fe.id}|`))
    const ok = await ask(
      `¿Eliminar el gasto programado "${fe.concept}"?${wasPaid ? ' El pago que ya registraste se conserva.' : ''}`,
      { title: 'Eliminar gasto programado', confirmLabel: 'Eliminar' },
    )
    if (!ok) return
    try {
      await deleteFixedExpense(fe.id)
      close()
      await load()
      showToast('Gasto programado eliminado', 'delete')
    } catch {
      showToast('No se pudo eliminar el gasto programado', 'error')
    }
  }

  // The payment is real (stored) unless it is an automatic debit that has not been stored yet
  const canEditPayment = !!selectedPayment && !String((selectedPayment as any).id ?? '').startsWith('auto|')

  function startEditPayment() {
    if (!selectedPayment) return
    setEditFile(null)
    setDropAttachment(false)
    const when = selectedPayment.paymentDate instanceof Date ? selectedPayment.paymentDate : new Date(selectedPayment.paymentDate)
    setEditPay({ amount: String(selectedPayment.paidAmount), date: format(when, 'yyyy-MM-dd'), accountId: ((selectedPayment as any).accountId as string | undefined) ?? '', comment: (selectedPayment as any).notes ?? '' })
  }

  async function saveEditPayment() {
    if (!selectedPayment || !editPay) return
    const amount = Number(editPay.amount)
    if (!(amount > 0)) { showToast('Escribe un monto mayor a 0', 'error'); return }
    if (!editPay.date) { showToast('Elige la fecha de pago', 'error'); return }
    const [y, m, d] = editPay.date.split('-').map(Number)
    setSavingPay(true)
    const oldAttachment = (selectedPayment as any).attachmentId as string | undefined
    let newAttachment: string | undefined
    try {
      if (editFile) newAttachment = await saveAttachment(user!.uid, editFile)
      await updateFixedExpensePayment(
        (selectedPayment as any).id,
        { paidAmount: amount, paymentDate: new Date(y, m - 1, d), accountId: editPay.accountId || undefined, notes: editPay.comment.trim(), attachmentId: newAttachment ?? (dropAttachment ? null : undefined) },
        { paidAmount: selectedPayment.paidAmount, accountId: (selectedPayment as any).accountId },
      )
      if (oldAttachment && (newAttachment || dropAttachment)) await removeAttachment(oldAttachment)
      setEditPay(null)
      close()
      await load()
      showToast('Pago corregido', 'edit')
    } catch {
      await removeAttachment(newAttachment)
      showToast('No se pudo corregir el pago', 'error')
    } finally {
      setSavingPay(false)
    }
  }

  async function handleUnpay() {
    if (!selectedPayment || (selectedPayment as any).auto) return
    try {
      const accId = (selectedPayment as any).accountId as string | undefined
      // The money goes back to the account it came out of, if that account still exists
      await deleteFixedExpensePayment(
        selectedPayment.id,
        accId && accounts.some((a) => a.id === accId) ? { accountId: accId, amount: selectedPayment.paidAmount } : undefined,
      )
      close()
      await load()
      showToast('Pago eliminado', 'delete')
    } catch {
      showToast('Error al eliminar el pago', 'error')
    }
  }

  return (
      <Modal
        open={!!selected}
        onClose={close}
        title={selected ? `${selected.fe.concept} · ${monthLabelOf(selected.month)}` : ''}
      >
        {selected && selected.owed.length === 0 && selectedPayment ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-brand-300 text-sm font-semibold">
                <Check size={16} /> {(selectedPayment as any).auto ? 'Pagado automáticamente' : 'Pagado'}
              </div>
              <div className="flex items-center gap-2">
                {canEditPayment && !editPay && <IconActionButton icon={Pencil} tone="edit" label="Editar este pago: corregir monto, fecha o cuenta" onClick={startEditPayment} />}
                {!(selectedPayment as any).auto && !editPay && <IconActionButton icon={Trash2} tone="danger" label="Eliminar este pago: vuelve a quedar pendiente y la cuenta recupera el dinero" onClick={handleUnpay} />}
                {scheduledIcons}
              </div>
            </div>
            {(selectedPayment as any).auto && (
              <p className="text-xs text-cyan-200">
                Este gasto se debita automáticamente de tu cuenta: se marcó como pagado el día de pago.
              </p>
            )}
            {editPay ? (
              <div className="space-y-3 rounded-xl border border-brand-400/30 bg-brand-500/5 p-3">
                <p className="text-xs font-semibold text-brand-200">Corregir este pago</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input label="Monto pagado (COP)" money value={editPay.amount} onChange={(e) => setEditPay({ ...editPay, amount: e.target.value })} />
                  <Input label="Fecha de pago" type="date" value={editPay.date} onChange={(e) => setEditPay({ ...editPay, date: e.target.value })} />
                </div>
                <AccountSelect label="Cuenta de la que salió" accounts={accounts} value={editPay.accountId} onChange={(id) => setEditPay({ ...editPay, accountId: id })} noneLabel="Sin cuenta" />
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#9aa4ac] block">Comentario del pago</label>
                  <textarea
                    value={editPay.comment}
                    onChange={(e) => setEditPay({ ...editPay, comment: e.target.value })}
                    rows={2}
                    maxLength={500}
                    placeholder="Opcional"
                    className="w-full bg-[#0d263a] border border-white/10 rounded-xl px-3 py-2 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none focus:border-brand-400 transition resize-y"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#9aa4ac] block">Comprobante</label>
                  {(selectedPayment as any).attachmentId && !editFile && (
                    dropAttachment ? (
                      <p className="flex items-center gap-2 text-xs text-amber-300">
                        Se quitará el comprobante actual.
                        <button type="button" onClick={() => setDropAttachment(false)} className="font-semibold underline">Deshacer</button>
                      </p>
                    ) : (
                      <div className="flex items-center gap-3">
                        <AttachmentButton attachmentId={(selectedPayment as any).attachmentId} label="Ver comprobante actual" />
                        <button type="button" onClick={() => setDropAttachment(true)} className="text-xs font-semibold text-rose-300 hover:text-rose-200">Quitar</button>
                      </div>
                    )
                  )}
                  <AttachmentPicker file={editFile} onChange={setEditFile} />
                  {(selectedPayment as any).attachmentId && editFile && <p className="text-[10px] text-[#8a929a]">Reemplazará al comprobante actual.</p>}
                </div>
                <p className="text-[10px] text-[#8a929a]">El saldo de las cuentas se ajusta solo: si cambias el monto o la cuenta, la anterior recupera lo que corresponde y la nueva lo paga.</p>
                <div className="flex items-center justify-end gap-2">
                  <IconActionButton icon={X} tone="warning" label="Cancelar: no cambiar el pago" onClick={() => setEditPay(null)} disabled={savingPay} />
                  <IconActionButton icon={Check} tone="success" label={savingPay ? 'Guardando…' : 'Guardar la corrección del pago'} onClick={saveEditPayment} disabled={savingPay} />
                </div>
              </div>
            ) : (
              <p className="text-sm font-mono">
                {formatCOP(selectedPayment.paidAmount)} el{' '}
                {format(selectedPayment.paymentDate instanceof Date ? selectedPayment.paymentDate : new Date(selectedPayment.paymentDate), "d 'de' MMMM yyyy", { locale: es })}
              </p>
            )}
            <p className="text-xs text-[#9aa4ac]">
              Estimado: <span className="font-mono">{formatCOP(amountFor(selected.fe, selected.month))}</span>
            </p>
            {(selectedPayment as any).accountId && (
              <p className="text-xs text-[#9aa4ac]">
                Pagado desde: <span className="font-semibold text-[#f3f5f6]">{accounts.find((a) => a.id === (selectedPayment as any).accountId)?.name ?? 'una cuenta que ya no existe'}</span>
              </p>
            )}
            <FixedTags fe={expenses.find((e) => e.id === selected.fe.id) ?? selected.fe} />
            <NotesCard notes={(expenses.find((e) => e.id === selected.fe.id) ?? selected.fe).notes} />
            {!editPay && <PaymentComment comment={(selectedPayment as any).notes} />}
            {!editPay && (selectedPayment as any).attachmentId && <AttachmentButton attachmentId={(selectedPayment as any).attachmentId} />}
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={close}>Cerrar</Button>
            </div>
          </div>
        ) : selected ? (
          <form onSubmit={payForm.handleSubmit(onPay)} className="space-y-4">
            {selected.fe.oneTime && <div className="flex items-center justify-end gap-2">{scheduledIcons}</div>}
            <div className="space-y-2">
              <p className="text-xs text-[#9aa4ac]">
                {lines.length > 1 ? 'Marca los pagos que vas a registrar como pagados:' : 'Se registrará este pago:'}
              </p>
              {lines.map((l) => {
                const isChecked = checked.includes(l.occMonth)
                return (
                  <label
                    key={l.occMonth}
                    className={clsx(
                      'flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer select-none transition',
                      isChecked ? 'bg-brand-500/10 border-brand-500/40' : 'bg-[#0d263a] border-white/10',
                    )}
                  >
                    <span className="flex items-center gap-2.5 text-sm text-[#f3f5f6] capitalize">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setLineError(null)
                          setChecked((prev) => prev.includes(l.occMonth) ? prev.filter((m) => m !== l.occMonth) : [...prev, l.occMonth])
                        }}
                      />
                      {monthLabelOf(l.occMonth)}
                    </span>
                    {/* only an expense configured with a variable amount lets you type what was really paid */}
                    {selected.fe.isVariable ? (
                      <MoneyInput
                        aria-label={`Valor pagado de ${monthLabelOf(l.occMonth)}`}
                        placeholder="0"
                        value={l.amount || ''}
                        onChange={(e) => {
                          setLineError(null)
                          const amount = Number(e.target.value) || 0
                          setLines((prev) => prev.map((x) => (x.occMonth === l.occMonth ? { ...x, amount } : x)))
                        }}
                        className="w-32 rounded-lg border border-brand-500/30 bg-[#0a1f2f] px-2.5 py-1.5 text-right text-sm font-mono tabular-nums text-white outline-none focus:border-brand-500"
                      />
                    ) : (
                      <span className="font-mono text-sm tabular-nums">{formatCOP(l.amount)}</span>
                    )}
                  </label>
                )
              })}
              <p className="text-xs text-[#c7ccd1] font-mono flex justify-between border-t border-white/10 pt-2">
                <span>Total a pagar</span>
                <strong className="text-[#f3f5f6]">
                  {formatCOP(lines.filter((l) => checked.includes(l.occMonth)).reduce((sum, l) => sum + l.amount, 0))}
                </strong>
              </p>
              {selected.fe.isVariable && (
                <p className="text-[11px] text-amber-200/90">Monto variable: escribe lo que realmente pagaste en cada mes (el estimado de este mes es {formatCOP(amountFor(selected.fe, selected.month))}).</p>
              )}
              {lineError && <p className="text-xs text-red-400">{lineError}</p>}
            </div>
            {accounts.length > 0 ? (
              <div className="space-y-1">
                <Select
                  label="¿De qué cuenta sale el dinero?"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  options={[
                    ...accounts.map((a) => ({ value: a.id as string, label: `${a.name} · ${formatCOP(a.balance as number)}` })),
                    { value: '', label: 'Sin descontar de una cuenta' },
                  ]}
                />
                {(() => {
                  const acc = accounts.find((a) => a.id === accountId)
                  const total = lines.filter((l) => checked.includes(l.occMonth)).reduce((sum, l) => sum + l.amount, 0)
                  if (!acc) return null
                  // a cuenta hija spends the money of its parent account
                  const parent = acc.parentId ? accounts.find((x: any) => x.id === acc.parentId) : undefined
                  if (parent) return parent.balance < total
                    ? <p className="text-[11px] text-red-300">{parent.name} tiene {formatCOP(parent.balance)} y el pago es de {formatCOP(total)}: quedaría en negativo.</p>
                    : <p className="text-[11px] text-[#8a929a]">Sale del dinero de {parent.name} (le quedarán {formatCOP(parent.balance - total)}) y queda anotado aparte en {acc.name}.</p>
                  return acc.balance < total
                    ? <p className="text-[11px] text-red-300">Esta cuenta tiene {formatCOP(acc.balance)} y el pago es de {formatCOP(total)}: quedaría en negativo.</p>
                    : <p className="text-[11px] text-[#8a929a]">Le quedarán {formatCOP(acc.balance - total)}.</p>
                })()}
              </div>
            ) : (
              <p className="text-[11px] text-[#8a929a]">Agrega tus cuentas en Finanzas para elegir de cuál sale cada pago.</p>
            )}
            <Input
              label="Fecha de pago"
              type="date"
              {...payForm.register('paymentDate')}
              error={payForm.formState.errors.paymentDate?.message}
            />
            <FixedTags fe={expenses.find((e) => e.id === selected.fe.id) ?? selected.fe} />
            <NotesCard notes={(expenses.find((e) => e.id === selected.fe.id) ?? selected.fe).notes} />
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#9aa4ac] block">Comentario del pago <span className="font-normal text-[#5f6a72]">(opcional)</span></label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="ej. pagué con retraso, referencia del recibo…"
                className="w-full bg-[#0d263a] border border-white/10 rounded-xl px-3 py-2 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none focus:border-brand-400 transition resize-y"
              />
            </div>
            <AttachmentPicker file={payFile} onChange={setPayFile} />
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={close}>Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Confirmando…' : checked.length > 1 ? 'Pagar seleccionados' : 'Confirmar pago'}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
  )
}
