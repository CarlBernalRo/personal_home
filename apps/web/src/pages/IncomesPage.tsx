import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Banknote, ChevronDown, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { AccountSelect } from '@/components/ui/AccountSelect'
import { AccountFilter, NO_ACCOUNT } from '@/components/ui/AccountFilter'
import { AttachmentPicker } from '@/components/pending/AttachmentPicker'
import { withAttachment } from '@/lib/attachments'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { usePeriodReveal } from '@/hooks/usePeriodReveal'
import { useMoneyMask } from '@/hooks/useMoneyMask'
import { useLayoutStore } from '@/store/layout'
import { addIncome, getAccounts, getIncomes, deleteIncome } from '@/lib/firestore'
import { EmptyMark } from '@/components/ui/AppIcon'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { MovementTimeline, type Movement } from '@/components/finance/MovementTimeline'

const incomeSchema = z.object({
  concept: z.string().min(1, 'Concepto requerido'),
  amount:  z.coerce.number().positive('El monto debe ser mayor a 0'),
  date:    z.string().min(1),
})
type IncomeForm = z.infer<typeof incomeSchema>

const asDate = (d: unknown) => (d instanceof Date ? d : new Date(d as any))

/**
 * Ingresos: the money that came in, as the same vertical timeline as the Gastos Fijos history (spine, a node per
 * day, one bordered row each). Only the current salary period shows at first; "Cargar período anterior" reveals one more.
 */
export default function IncomesPage() {
  const { user, profile } = useAuth()
  const { showToast } = useToast()
  const ask = useConfirm()
  const cop = useMoneyMask()
  const leftCollapsed = useLayoutStore((s) => s.leftCollapsed)

  const [accounts, setAccounts] = useState<any[]>([])
  const [incomes, setIncomes]   = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [accountFilter, setAccountFilter] = useState<string | null>(null)

  const [openInc, setOpenInc]     = useState(false)
  const [savingInc, setSavingInc] = useState(false)
  const [incAccount, setIncAccount] = useState('')
  const [incFile, setIncFile]     = useState<File | null>(null)

  const incForm = useForm<IncomeForm>({
    resolver: zodResolver(incomeSchema),
    defaultValues: { date: format(new Date(), 'yyyy-MM-dd') },
  })

  async function load() {
    if (!user) return
    const [acc, inc] = await Promise.all([getAccounts(user.uid), getIncomes(user.uid)])
    setAccounts(acc as any[])
    setIncomes(inc as any[])
    setLoading(false)
  }
  useEffect(() => { load().catch(() => setLoading(false)) }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (openInc) { setIncAccount((accounts.find((a) => a.isDefault) ?? accounts[0])?.id ?? ''); setIncFile(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openInc])

  async function onSubmitInc(data: IncomeForm) {
    if (!user) return
    setSavingInc(true)
    try {
      const date = new Date(data.date + 'T12:00:00')
      await withAttachment(user.uid, incFile, (attachmentId) => addIncome({
        userId:  user.uid,
        concept: data.concept,
        amount:  data.amount,
        month:   format(date, 'yyyy-MM'),
        date,
        ...(incAccount ? { accountId: incAccount } : {}),
        ...(attachmentId ? { attachmentId } : {}),
      }))
      incForm.reset({ date: format(new Date(), 'yyyy-MM-dd') })
      setOpenInc(false)
      await load() // the chosen account's balance went up too
      showToast('Ingreso agregado', 'success')
    } catch {
      showToast('Error al guardar', 'error')
    } finally {
      setSavingInc(false)
    }
  }

  async function handleDelete(m: Movement) {
    if (!(await ask('¿Eliminar este ingreso?', { title: 'Eliminar ingreso' }))) return
    await deleteIncome(m.id)
    setIncomes((prev) => prev.filter((i) => i.id !== m.id))
    showToast('Ingreso eliminado', 'delete')
  }

  // Only the current salary period at first; each "Cargar período anterior" reveals one more
  const salaries = useMemo(
    () => incomes.filter((i) => i.kind === 'salary').map((i) => ({ id: i.id as string, date: asDate(i.date), amount: i.amount as number })),
    [incomes],
  )
  const schedule = (profile as any)?.paySchedule ?? null
  const { cutoff, canLoadMore, loadMore } = usePeriodReveal(salaries, schedule)

  const inPeriod = cutoff ? incomes.filter((i) => asDate(i.date).getTime() >= cutoff.getTime()) : incomes
  const byAccount = (i: any) => accountFilter === null || (accountFilter === NO_ACCOUNT ? !i.accountId : i.accountId === accountFilter)
  const visible = inPeriod.filter(byAccount)

  const items: Movement[] = visible
    .map((i) => ({
      id: i.id as string,
      zone: 'income' as const,
      date: asDate(i.date),
      concept: i.concept as string,
      sub: i.kind === 'salary' ? 'Sueldo' : 'Ingreso',
      amount: i.amount as number,
      accountId: i.accountId as string | undefined,
      attachmentId: i.attachmentId as string | undefined,
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime())

  const total = visible.reduce((s, i) => s + (i.amount as number), 0)
  const currentMonth = format(new Date(), 'yyyy-MM')
  const monthTotal = incomes.filter((i) => i.month === currentMonth && byAccount(i)).reduce((s, i) => s + (i.amount as number), 0)

  const paneProps = {
    contentClassName: 'max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6',
    borderRadius: 24,
    offset: 7,
    variant: 'plain' as const,
    themeColor: 'brand' as const,
  }

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">
      {/* Left pane: what came in, and the account filter */}
      <CurvedScrollContainer
        className={clsx('lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50', leftCollapsed && 'lg:hidden')}
        corners="both"
        {...paneProps}
      >
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
            <Banknote size={11} className="text-brand-400" />
            <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Entradas</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f0fae8]">Ingresos</h1>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0a1f2f] p-4 sm:p-5 space-y-3 shadow-xl">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#9aa4ac]">{cutoff ? 'Ingresos del período' : 'Ingresos registrados'}</p>
              <p className="text-[10px] text-[#5f6a72]">{items.length} {items.length === 1 ? 'entrada' : 'entradas'}</p>
            </div>
            <p className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-300 flex-shrink-0">+{cop(total)}</p>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 pt-2.5 text-xs text-[#9aa4ac]">
            <span>Este mes</span>
            <span className="font-mono font-bold text-brand-300">{cop(monthTotal)}</span>
          </div>
        </div>

        <Button onClick={() => setOpenInc(true)} size="sm" notched className="w-full">
          <Plus size={15} /> Nuevo ingreso
        </Button>

        {accounts.length > 0 && (
          <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} hasUnassigned={inPeriod.some((i) => !i.accountId)} />
        )}
      </CurvedScrollContainer>

      {/* Right pane: the history */}
      <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
        <CurvedScrollContainer className="lg:flex-1 lg:min-h-0 rounded-3xl border border-white/10 bg-[#0a1f2f]/50" corners="both" {...paneProps}>
          {cutoff && (
            <p className="text-[11px] text-[#8a929a]">
              Mostrando desde el {format(cutoff, 'd MMM yyyy', { locale: es })}{canLoadMore ? ' (período actual)' : ''}
            </p>
          )}

          {loading ? (
            <SkeletonList count={4} />
          ) : incomes.length === 0 ? (
            <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
              <EmptyMark name="cash" />
              <p className="text-sm font-bold text-[#f0fae8]">Sin ingresos registrados</p>
              <p className="text-xs text-[#8a929a] mt-1">Registra tus entradas de dinero (salario, honorarios, etc.).</p>
            </div>
          ) : items.length === 0 ? (
            <div className="notch bg-[#0a1f2f] border border-white/10 text-center py-12 px-6">
              <EmptyMark name="cash" />
              <p className="text-sm font-bold text-[#f0fae8]">Sin ingresos con ese filtro</p>
              <p className="text-xs text-[#8a929a] mt-1">Quita el filtro de cuenta o carga el período anterior.</p>
            </div>
          ) : (
            <MovementTimeline items={items} accounts={accounts} onDelete={handleDelete} />
          )}

          {canLoadMore && (
            <div className="flex justify-center pt-1">
              <Button type="button" variant="secondary" size="sm" notched onClick={loadMore}>
                <ChevronDown size={14} /> Cargar período anterior
              </Button>
            </div>
          )}
        </CurvedScrollContainer>
      </div>

      <Modal open={openInc} onClose={() => setOpenInc(false)} title="Nuevo Ingreso">
        <form onSubmit={incForm.handleSubmit(onSubmitInc)} className="space-y-4">
          <Input label="Concepto" placeholder="ej. Sueldo quincena, Proyecto freelance…" {...incForm.register('concept')} error={incForm.formState.errors.concept?.message} />
          <Input label="Monto (COP)" money placeholder="0" {...incForm.register('amount')} error={incForm.formState.errors.amount?.message} />
          <Input label="Fecha" type="date" {...incForm.register('date')} />
          <AccountSelect label="¿A qué cuenta llegó?" accounts={accounts} value={incAccount} onChange={setIncAccount} noneLabel="Sin sumar a una cuenta" />
          <AttachmentPicker file={incFile} onChange={setIncFile} />
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenInc(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={savingInc} notched>{savingInc ? 'Guardando…' : 'Guardar Ingreso'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
