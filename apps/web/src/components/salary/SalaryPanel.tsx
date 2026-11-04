import { useMemo, useState } from 'react'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { withAttachment } from '@/lib/attachments'
import { Link } from 'react-router-dom'
import { format, isToday } from 'date-fns'
import { es } from 'date-fns/locale'
import { PartyPopper, Wallet, Settings, Plus, Trash2, Landmark, ArrowLeftRight } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { SegmentedBar } from '@/components/ui/SegmentedBar'
import { SERIES } from '@/components/dashboard/shared'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { SalaryState } from '@/hooks/useSalary'
import { useAuth } from '@/hooks/useAuth'
import { TransferModal } from '@/components/fixed/TransferModal'
import { cashOnHand, formatCOP, nextPayDate, salaryLedgers } from '@/shared'

interface Props {
  salary: SalaryState
  /** Fixed expenses and their payments, to work out what the current salary has to cover. */
  expenses: any[]
  paymentIndex: Map<string, { paidAmount: number; paymentDate?: Date | string }>
  /** 'pending' draws only the "ya me pagaron" prompt (for the home, which has its own summary cards). */
  variant?: 'full' | 'pending'
}

const shortDate = (d: Date) => format(d, "d 'de' MMM", { locale: es })

export function SalaryPanel({ salary, expenses, paymentIndex, variant = 'full' }: Props) {
  const full = variant === 'full'
  const { schedule, periods, extras, addExtra, removeExtra, currentPeriod, pending, confirm, loading } = salary
  const { showToast } = useToast()
  const ask = useConfirm()
  const { user } = useAuth()
  const [moving, setMoving] = useState(false)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extraOpen, setExtraOpen] = useState(false)
  const [extra, setExtra] = useState({ concept: '', amount: '', date: format(new Date(), 'yyyy-MM-dd') })
  const [extraError, setExtraError] = useState<string | null>(null)
  // Account the salary / extra income is deposited into
  const [salaryAccount, setSalaryAccount] = useState('')
  const [extraAccount, setExtraAccount] = useState('')
  const [salaryFile, setSalaryFile] = useState<File | null>(null)
  const [extraFile, setExtraFile] = useState<File | null>(null)
  const accountOptions = salary.accounts.map((a: any) => ({ value: a.id as string, label: `${a.name} · ${formatCOP(a.balance as number)}` }))

  // Chained over all periods, so the current one starts with what the previous one left over
  const ledger = useMemo(
    () => (currentPeriod ? (salaryLedgers(periods, expenses, paymentIndex, new Date(), extras, salary.variable).get(currentPeriod.id) ?? null) : null),
    [periods, currentPeriod, expenses, paymentIndex, extras, salary.variable],
  )

  // What is actually in the account now (not counting what is still pending to pay)
  const cash = useMemo(
    () => cashOnHand(salary.salaries, extras, [...paymentIndex.values()], new Date(), salary.spends),
    [salary.salaries, extras, paymentIndex, salary.spends],
  )

  const periodExtras = currentPeriod
    ? extras.filter((x) => x.date >= currentPeriod.start && x.date < currentPeriod.end)
    : []

  if (loading) return null

  if (!schedule) {
    return (
      <Link
        to="/perfil"
        className="flex items-center gap-3 rounded-xl border border-dashed border-white/20 bg-[#0a1f2f] px-4 py-3 text-xs text-[#9aa4ac] hover:border-brand-500/50 hover:text-white transition"
      >
        <Settings size={16} className="text-brand-400" />
        Configura tu sueldo y su frecuencia de pago en tu perfil para ver cuánto te queda después de tus gastos.
      </Link>
    )
  }

  function openConfirm() {
    if (!pending) return
    setAmount(String(pending.amount))
    setSalaryAccount(salary.depositAccountId)
    setSalaryFile(null)
    setError(null)
    setOpen(true)
  }

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    if (!pending || !(value > 0)) {
      setError('Ingresa un monto mayor a 0')
      return
    }
    setSaving(true)
    try {
      await withAttachment(user!.uid, salaryFile, (attachmentId) => confirm(pending, value, salaryAccount, attachmentId))
      setOpen(false)
      showToast('Sueldo confirmado', 'success')
    } catch {
      showToast('No se pudo confirmar el sueldo', 'error')
    } finally {
      setSaving(false)
    }
  }

  function openExtra() {
    setExtra({ concept: '', amount: '', date: format(new Date(), 'yyyy-MM-dd') })
    setExtraAccount(salary.depositAccountId)
    setExtraFile(null)
    setExtraError(null)
    setExtraOpen(true)
  }

  async function onAddExtra(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(extra.amount)
    if (!extra.concept.trim()) return setExtraError('Escribe de qué es el ingreso')
    if (!(value > 0)) return setExtraError('Ingresa un monto mayor a 0')
    const [y, m, d] = extra.date.split('-').map(Number)
    setSaving(true)
    try {
      await withAttachment(user!.uid, extraFile, (attachmentId) => addExtra(extra.concept.trim(), value, new Date(y, m - 1, d), extraAccount, attachmentId))
      setExtraOpen(false)
      showToast('Ingreso agregado', 'success')
    } catch {
      showToast('No se pudo guardar el ingreso', 'error')
    } finally {
      setSaving(false)
    }
  }

  const nextPay = pending ? nextPayDate(schedule, pending.date) : null

  return (
    <>
      {pending && (
        <div className="rounded-2xl border border-brand-400/40 bg-gradient-to-r from-brand-500/15 to-[#0a1f2f] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl bg-brand-500/20 border border-brand-400/40 flex items-center justify-center text-brand-300">
              <PartyPopper size={22} />
            </span>
            <div>
              <p className="text-sm font-bold text-[#f0fae8]">
                {isToday(pending.date) ? 'Hoy es día de pago' : salary.salaries.length === 0 ? 'Confirma tu último pago' : 'Tienes un pago por confirmar'}
              </p>
              <p className="text-xs text-[#9aa4ac]">
                {isToday(pending.date)
                  ? `Confirma tu sueldo de ${format(pending.date, 'MMMM', { locale: es })} para ver cuánto te queda.`
                  : salary.salaries.length === 0
                    ? `Tu fecha de pago configurada fue el ${format(pending.date, "d 'de' MMMM", { locale: es })}. Confirma cuánto te pagaron ese día para calcular tu período y lo que te queda.`
                    : `Tu pago del ${format(pending.date, "d 'de' MMMM", { locale: es })} aún no está confirmado.`}
              </p>
            </div>
          </div>
          <Button onClick={openConfirm} notched>¡Ya me pagaron!</Button>
        </div>
      )}

      {full && salary.accounts.length > 0 && (() => {
        // With accounts, the money on hand is what the accounts hold: the total and what each one has
        const total = salary.accounts.reduce((sum: number, a: any) => sum + (a.balance as number), 0)
        return (
          <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/40 flex items-center justify-center text-sky-300 flex-shrink-0">
                  <Landmark size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#9aa4ac]">Dinero en tus cuentas</p>
                  <p className="text-[10px] text-[#5f6a72]">Total de {salary.accounts.length} {salary.accounts.length === 1 ? 'cuenta' : 'cuentas'}</p>
                </div>
              </div>
              <p className={clsx('text-xl sm:text-2xl font-bold font-mono tabular-nums flex-shrink-0', total < 0 ? 'text-red-400' : 'text-sky-200')}>
                {formatCOP(total)}
              </p>
            </div>
            <div className="space-y-1.5 border-t border-white/10 pt-3 text-xs font-mono">
              {salary.accounts.map((a: any) => (
                <p key={a.id} className="flex items-center justify-between gap-3 text-[#c7ccd1]">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: (a.color as string) ?? '#52b69a' }} aria-hidden="true" />
                    <span className="truncate">{a.name as string}</span>
                  </span>
                  <span className={clsx('font-bold', (a.balance as number) < 0 ? 'text-red-300' : 'text-[#f0fae8]')}>{formatCOP(a.balance as number)}</span>
                </p>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <Link to="/finanzas" className="text-[11px] font-semibold text-brand-300 hover:text-brand-200 transition">Administrar cuentas</Link>
              {salary.accounts.length > 1 && (
                <button
                  type="button"
                  onClick={() => setMoving(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0d263a] px-3 py-1.5 text-[11px] font-semibold text-[#c7ccd1] hover:border-brand-400/50 hover:text-white transition"
                >
                  <ArrowLeftRight size={12} aria-hidden="true" /> Mover saldo
                </button>
              )}
            </div>
            <TransferModal open={moving} onClose={() => setMoving(false)} userId={user?.uid ?? ''} accounts={salary.accounts} onDone={() => salary.reloadAccounts()} />
          </div>
        )
      })()}

      {full && salary.accounts.length === 0 && cash !== null && (
        <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 flex items-center justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-400/40 flex items-center justify-center text-sky-300 flex-shrink-0">
              <Landmark size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#9aa4ac]">Dinero en tu cuenta ahora</p>
              <p className="text-[10px] text-[#5f6a72]">Ingresos recibidos menos lo que ya has pagado</p>
            </div>
          </div>
          <p className={clsx('text-xl sm:text-2xl font-bold font-mono tabular-nums flex-shrink-0', cash < 0 ? 'text-red-400' : 'text-sky-200')}>
            {formatCOP(cash)}
          </p>
        </div>
      )}

      {full && currentPeriod && ledger && (
        <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#9aa4ac] min-w-0">
              <Wallet size={14} className="text-brand-400 flex-shrink-0" />
              <span className="min-w-0">
                <span className="max-sm:block">Sueldo de este período<span className="sm:inline hidden"> · </span></span>
                <span className="max-sm:block max-sm:text-[11px] max-sm:font-normal max-sm:text-[#8a929a]">{shortDate(currentPeriod.start)} al {shortDate(new Date(currentPeriod.end.getTime() - 86_400_000))}</span>
              </span>
            </div>
            <button
              type="button"
              onClick={openExtra}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500/15 border border-violet-400/40 text-violet-200 hover:bg-violet-500/25 transition flex-shrink-0"
            >
              <Plus size={12} /> <span className="max-sm:hidden">Ingreso adicional</span><span className="sm:hidden">Ingreso</span>
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#8a929a]"><i className="not-italic inline-block w-2 h-2 rounded-[3px] mr-1.5 align-middle" style={{ backgroundColor: SERIES.left }} aria-hidden="true" />Te queda</p>
              <p className={clsx('text-2xl font-bold font-mono tabular-nums', ledger.remaining < 0 ? 'text-red-400' : 'text-brand-300')}>
                {formatCOP(ledger.remaining)}
              </p>
            </div>
            <div className="text-xs font-mono space-y-1.5 max-sm:border-t max-sm:border-white/10 max-sm:pt-3 sm:space-y-0.5 sm:text-right">
              <p className="flex justify-between gap-3 sm:block text-[#c7ccd1]">Sueldo <span className="font-bold text-[#f0fae8]">{formatCOP(currentPeriod.amount)}</span></p>
              {ledger.carryIn !== 0 && (
                <p className={clsx('flex justify-between gap-3 sm:block', ledger.carryIn > 0 ? 'text-sky-300' : 'text-red-300')}>
                  {ledger.carryIn > 0 ? 'Sobrante anterior' : 'Faltante anterior'}{' '}
                  <span className="font-bold">{ledger.carryIn > 0 ? '+' : '−'}{formatCOP(Math.abs(ledger.carryIn))}</span>
                </p>
              )}
              {ledger.extraTotal > 0 && (
                <p className="flex justify-between gap-3 sm:block text-violet-300">Ingresos adicionales <span className="font-bold">+{formatCOP(ledger.extraTotal)}</span></p>
              )}
              <p className="flex justify-between gap-3 sm:block text-[#c7ccd1]"><i className="not-italic inline-block w-2 h-2 rounded-[3px] mr-1.5 align-middle" style={{ backgroundColor: SERIES.fixed }} aria-hidden="true" />Gastos fijos <span className="font-bold text-[#f0fae8]">−{formatCOP(ledger.committed)}</span></p>
              {ledger.additionalSpent > 0 && (
                <p className="flex justify-between gap-3 sm:block text-[#c7ccd1]"><i className="not-italic inline-block w-2 h-2 rounded-[3px] mr-1.5 align-middle" style={{ backgroundColor: SERIES.additional }} aria-hidden="true" />Gastos adicionales <span className="font-bold text-[#f0fae8]">−{formatCOP(ledger.additionalSpent)}</span></p>
              )}
              {ledger.variableSpent > 0 && (
                <p className="flex justify-between gap-3 sm:block text-[#c7ccd1]"><i className="not-italic inline-block w-2 h-2 rounded-[3px] mr-1.5 align-middle" style={{ backgroundColor: SERIES.occasional }} aria-hidden="true" />Gastos ocasionales <span className="font-bold text-[#f0fae8]">−{formatCOP(ledger.variableSpent)}</span></p>
              )}
              {ledger.variableReserved > 0 && (
                <p className="flex justify-between gap-3 sm:block text-amber-300"><i className="not-italic inline-block w-2 h-2 rounded-[3px] mr-1.5 align-middle" style={{ backgroundColor: SERIES.reserved }} aria-hidden="true" />Reservado para ocasionales <span className="font-bold">−{formatCOP(ledger.variableReserved)}</span></p>
              )}
            </div>
          </div>

          {(() => {
            const used = ledger.committed + ledger.additionalSpent + ledger.variableSpent + ledger.variableReserved
            const available = currentPeriod.amount + ledger.carryIn + ledger.extraTotal
            // Same colors as the home's "¿A dónde se fue el sueldo?": the dots in the list above are this bar's legend
            return (
              <div className="space-y-1.5">
                <SegmentedBar
                  label="Reparto de tu sueldo del período"
                  total={Math.max(used, available)}
                  parts={[
                    { key: 'fixed', label: 'Gastos fijos', value: ledger.committed, color: SERIES.fixed },
                    { key: 'additional', label: 'Adicionales', value: ledger.additionalSpent, color: SERIES.additional },
                    { key: 'occasional', label: 'Ocasionales', value: ledger.variableSpent, color: SERIES.occasional },
                    { key: 'reserved', label: 'Reservado', value: ledger.variableReserved, color: SERIES.reserved },
                    { key: 'left', label: 'Te queda', value: Math.max(0, ledger.remaining), color: SERIES.left },
                  ]}
                />
                <p className="text-[11px] text-[#8a929a]">
                  {available > 0
                    ? `Ya está comprometido el ${Math.round((used / available) * 100)}% de tus ${formatCOP(available)} del período.`
                    : 'Aún no hay ingresos en este período.'}
                </p>
              </div>
            )
          })()}
          {ledger.remaining < 0 && (
            <p className="text-xs text-red-300">Los gastos de este período superan tus ingresos en {formatCOP(-ledger.remaining)}.</p>
          )}

          {periodExtras.length > 0 && (
            <div className="space-y-1 border-t border-white/10 pt-2">
              {periodExtras.map((x) => (
                <div key={x.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 text-violet-200">
                    <span className="flex items-start gap-1"><Plus size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> <span className="break-words">{x.concept} <span className="text-[#8a929a]">· {shortDate(x.date)}</span></span></span>
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    {x.attachmentId && <AttachmentButton compact attachmentId={x.attachmentId} />}
                    <span className="font-mono text-emerald-300 whitespace-nowrap">+{formatCOP(x.amount)}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (await ask(`¿Eliminar el ingreso "${x.concept}"?`, { title: 'Eliminar ingreso adicional' })) {
                          removeExtra(x.id).catch(() => showToast('No se pudo eliminar', 'error'))
                        }
                      }}
                      className="p-1 text-[#8a929a] hover:text-red-400 transition"
                      aria-label={`Eliminar ${x.concept}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={extraOpen} onClose={() => setExtraOpen(false)} title="Ingreso adicional">
        <form onSubmit={onAddExtra} className="space-y-4">
          <p className="text-xs text-[#9aa4ac]">
            Dinero extra que recibiste además de tu sueldo (por ejemplo, alguien te pagó una deuda). Se suma a lo que te queda del período en que cae su fecha.
          </p>
          <Input label="Concepto" placeholder="ej. Me pagaron una deuda" value={extra.concept} onChange={(e) => { setExtra({ ...extra, concept: e.target.value }); setExtraError(null) }} />
          <Input label="Monto (COP)" money placeholder="0" value={extra.amount} onChange={(e) => { setExtra({ ...extra, amount: e.target.value }); setExtraError(null) }} />
          <Input label="Fecha en que lo recibiste" type="date" value={extra.date} onChange={(e) => setExtra({ ...extra, date: e.target.value })} />
          {accountOptions.length > 0 && (
            <Select label="¿A qué cuenta llegó?" value={extraAccount} onChange={(e) => setExtraAccount(e.target.value)} options={[...accountOptions, { value: '', label: 'Sin sumar a una cuenta' }]} />
          )}
          <AttachmentPicker file={extraFile} onChange={setExtraFile} />
          {extraError && <p className="text-xs text-red-400">{extraError}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setExtraOpen(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : 'Agregar ingreso'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title="¡Felicidades, ya te pagaron!">
        <form onSubmit={onConfirm} className="space-y-4">
          <p className="text-sm text-[#c7ccd1] leading-relaxed">
            Tu esfuerzo da frutos. Confirma cuánto te pagaron
            {pending ? ` el ${shortDate(pending.date)}` : ''} para cubrir tus gastos
            {nextPay ? ` hasta tu próximo pago, el ${shortDate(nextPay.date)}` : ''}.
          </p>
          <Input
            label="Sueldo recibido (COP)" money
                        value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null) }}
            error={error ?? undefined}
          />
          {accountOptions.length > 0 && (
            <Select label="¿A qué cuenta se consignó?" value={salaryAccount} onChange={(e) => setSalaryAccount(e.target.value)} options={[...accountOptions, { value: '', label: 'Sin sumar a una cuenta' }]} />
          )}
          <AttachmentPicker file={salaryFile} onChange={setSalaryFile} />
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Confirmando…' : 'Confirmar sueldo'}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
