import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ChevronLeft, ChevronRight, Home, LayoutGrid, Sparkles } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { SkeletonList } from '@/components/ui/Skeleton'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { MobileCollapse } from '@/components/ui/MobileCollapse'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useDisplayName } from '@/hooks/useDisplayName'
import {
  createHousehold, joinHousehold, getHouseholds,
  addHouseholdDebt, getHouseholdDebts, deleteHouseholdDebt, deleteHouseholdExpense,
  calcNetBalance, renameHousehold, deleteHousehold, getHouseholdIds,
  addHouseholdCrossing, getHouseholdCrossings, notifyHouseholdMembers,
} from '@/lib/firestore'
import { formatCOP, remainingOf, allocateAbono, isPendingDebt } from '@/shared'
import { HouseholdExpenseModal } from '@/components/household/HouseholdExpenseModal'
import { FinanceExplorer } from '@/components/household/FinanceExplorer'
import { HouseholdPicker } from '@/components/household/HouseholdPicker'
import { BalanceCard } from '@/components/household/BalanceCard'
import { PersonCard, Tip } from '@/components/household/PersonCard'
import { HouseholdTimeline } from '@/components/household/HouseholdTimeline'
import { HouseholdDebtDetail } from '@/components/household/HouseholdDebtDetail'
import { HouseholdMenu } from '@/components/household/HouseholdMenu'
import { HouseholdSettingsModal } from '@/components/household/HouseholdSettingsModal'
import { InviteModal } from '@/components/household/InviteModal'
import { CrossingModal } from '@/components/household/CrossingModal'
import { AbonoModal, debtSchema, type DebtForm } from '@/components/household/AbonoModal'
import { buildLedger, balanceBreakdown, splitByMonth } from '@/components/household/ledger'
import { AppIcon, EmptyMark } from '@/components/ui/AppIcon'

const householdSchema = z.object({ name: z.string().min(1, 'Ingresa un nombre') })
const joinSchema      = z.object({ code: z.string().min(6).max(6) })

type HHForm   = z.infer<typeof householdSchema>
type JoinForm = z.infer<typeof joinSchema>

const framed = 'rounded-3xl border border-white/10 bg-[#0a1f2f]/50'
const scrollProps = {
  contentClassName: 'max-lg:!overflow-visible space-y-5 py-3 !pl-3 !pr-3 lg:py-4 lg:!pl-4 lg:!pr-6',
  corners: 'both' as const,
  borderRadius: 24,
  offset: 7,
  variant: 'plain' as const,
  themeColor: 'brand' as const,
}

export default function HouseholdPage() {
  const { user, profile }     = useAuth()
  const setProfile             = useAuthStore((s) => s.setProfile)
  const myDisplayName          = useDisplayName()
  const { showToast }          = useToast()
  const ask = useConfirm()

  const [households, setHouseholds]   = useState<any[]>([])
  const [activeId, setActiveId]       = useState<string | null>(null)
  const [debts, setDebts]             = useState<any[]>([])
  const [loading, setLoading]         = useState(true)
  const [debtsLoading, setDebtsLoading] = useState(false)

  const [crossings, setCrossings]     = useState<any[]>([])
  const [openDebt, setOpenDebt]       = useState(false)
  const [openExpense, setOpenExpense] = useState(false)
  const [viewMode, setViewMode]       = useState<'clasico' | 'interactivo'>('clasico')
  const [openCreate, setOpenCreate]   = useState(false)
  const [openJoin, setOpenJoin]       = useState(false)
  const [openInvite, setOpenInvite]   = useState(false)
  const [openSettings, setOpenSettings] = useState(false)
  const [crossTarget, setCrossTarget]     = useState<any | null>(null)
  const [saldaTargetId, setSaldaTargetId] = useState<string | null>(null)
  const [selectedTargetDebtId, setSelectedTargetDebtId] = useState<string | null>(null)
  const [saving, setSaving]               = useState(false)
  const [copied, setCopied]               = useState(false)
  const [renameVal, setRenameVal]         = useState('')
  const [myExpanded, setMyExpanded]       = useState(false)
  const [partnerExpanded, setPartnerExpanded] = useState(false)
  const [selectedDebt, setSelectedDebt]   = useState<any | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d })

  /** Same morph-on-navigate trick as HouseholdPicker/FinanceExplorer — any
   *  state change wrapped here animates via the native View Transitions API
   *  instead of jump-cutting, falling back to instant on unsupported browsers. */
  function withTransition(fn: () => void) {
    const anyDoc = document as any
    if (typeof anyDoc.startViewTransition === 'function') anyDoc.startViewTransition(fn)
    else fn()
  }

  function shiftMonth(delta: number) {
    setSelectedMonth((prev) => { const d = new Date(prev); d.setMonth(d.getMonth() + delta); return d })
  }
  const now = new Date()
  const isCurrentMonth = selectedMonth.getFullYear() === now.getFullYear() && selectedMonth.getMonth() === now.getMonth()

  const hhIds    = getHouseholdIds(profile as any)

  // A link like /hogar?id=<household> opens that household directly (and is consumed, so going
  // back to the household list afterwards doesn't reopen it)
  const [params, setParams] = useSearchParams()
  const requestedId = params.get('id')
  useEffect(() => {
    if (!requestedId || households.length === 0) return
    if (households.some((h) => h.id === requestedId)) setActiveId(requestedId)
    setParams({}, { replace: true })
  }, [requestedId, households])
  const household = households.find((h) => h.id === activeId) ?? null

  /** Lets the other members of the active household know about something that changes their accounts. */
  function tellHousehold(title: string, body: string) {
    if (!user || !household || !activeId) return
    notifyHouseholdMembers((household.members as string[] | undefined) ?? [], {
      fromUid: user.uid, zone: 'hogar', severity: 'info', title, body, link: `/hogar?id=${activeId}`,
    }).catch(() => { /* a failed notice must never undo what was saved */ })
  }

  const debtForm = useForm<DebtForm>({
    resolver: zodResolver(debtSchema),
    defaultValues: { date: format(new Date(), 'yyyy-MM-dd'), tipo: 'Abono', category: 'otros_hogar', debtor: user?.uid ?? '' },
  })
  const hhForm   = useForm<HHForm>({ resolver: zodResolver(householdSchema) })
  const joinForm = useForm<JoinForm>({ resolver: zodResolver(joinSchema) })

  // Load all households on mount
  useEffect(() => {
    if (!user) return
    async function loadHouseholds() {
      try {
        const hhs = await getHouseholds(hhIds)
        setHouseholds(hhs)
      } catch (err) {
        console.error('Error cargando hogares:', err)
        showToast('No se pudieron cargar los hogares', 'error')
      } finally {
        setLoading(false)
      }
    }
    loadHouseholds()
  }, [user, JSON.stringify(hhIds)])

  // Abonos created via "Saldar" link back to the debt they settle via saldaId
  // (a field the schema already had but never wired up). We compute each debt's
  // paidAbono client-side from that link so a settled debt actually stops
  // showing as pending instead of lingering forever, re-saldable indefinitely.
  function withPaidAbono(rawDebts: any[]) {
    const paidByTarget = new Map<string, number>()
    for (const x of rawDebts) {
      if (x.tipo === 'Abono' && x.saldaId) {
        paidByTarget.set(x.saldaId, (paidByTarget.get(x.saldaId) || 0) + (x.amount as number))
      }
    }
    return rawDebts.map((d) => d.tipo === 'Deuda' ? { ...d, paidAbono: paidByTarget.get(d.id) || 0 } : d)
  }

  // Load debts + crossings when active household changes
  useEffect(() => {
    if (!activeId) return
    setDebtsLoading(true)
    // Load debts first — always show them even if crossings fail
    getHouseholdDebts(activeId)
      .then((d) => {
        setDebts(withPaidAbono(d as any[]))
        setDebtsLoading(false)
        // Load crossings independently so a missing index doesn't block debts
        getHouseholdCrossings(activeId)
          .then((c) => setCrossings(c as any[]))
          .catch(() => setCrossings([]))
      })
      .catch(() => setDebtsLoading(false))
  }, [activeId])

  useEffect(() => { if (user) debtForm.setValue('debtor', user.uid) }, [user])

  async function reloadDebts() {
    if (!activeId) return
    const d = await getHouseholdDebts(activeId)
    setDebts(withPaidAbono(d as any[]))
    getHouseholdCrossings(activeId).then(c => setCrossings(c as any[])).catch(() => {})
  }

  async function onAddDebt(data: DebtForm) {
    if (!user || !activeId) return
    setSaving(true)
    try {
      const effectiveTargetId = saldaTargetId || selectedTargetDebtId
      const targetDebt = effectiveTargetId ? debts.find((d: any) => d.id === effectiveTargetId) : null

      if (effectiveTargetId && targetDebt) {
        await addHouseholdDebt({
          householdId: activeId,
          concept: `Abono: ${targetDebt.concept}`,
          tipo: 'Abono',
          amount: data.amount,
          debtor: data.debtor,
          category: targetDebt.category || data.category,
          date: new Date(data.date + 'T12:00:00'),
          registeredBy: user.uid,
          estado: '',
          saldaId: effectiveTargetId,
          notas: data.notas ?? '',
          cruzado: false,
        })
        const newRemaining = Math.max(0, remainingOf(targetDebt) - data.amount)
        if (newRemaining === 0) {
          showToast(`¡Deuda "${targetDebt.concept}" 100% saldada!`, 'success')
        } else {
          showToast(`Abono de ${formatCOP(data.amount)} registrado. Saldo pendiente: ${formatCOP(newRemaining)}`, 'success')
        }
        tellHousehold(`${myName} registró un abono`, `${formatCOP(data.amount)} a "${targetDebt.concept}".`)
      } else {
        // General abono: allocate across pending debts of this debtor (oldest first)
        const pending = debts.filter((d: any) => d.debtor === data.debtor && isPendingDebt(d))
        const allocations = allocateAbono(data.amount, pending)

        if (allocations.length > 0) {
          for (const alloc of allocations) {
            const d = pending.find((x: any) => x.id === alloc.debtId)
            await addHouseholdDebt({
              householdId: activeId,
              concept: `Abono: ${d?.concept ?? data.concept}`,
              tipo: 'Abono',
              amount: alloc.amount,
              debtor: data.debtor,
              category: d?.category ?? data.category,
              date: new Date(data.date + 'T12:00:00'),
              registeredBy: user.uid,
              estado: '',
              saldaId: alloc.debtId,
              notas: data.notas ?? '',
              cruzado: false,
            })
          }
          const allocatedTotal = allocations.reduce((s, a) => s + a.amount, 0)
          if (data.amount > allocatedTotal) {
            await addHouseholdDebt({
              householdId: activeId,
              concept: data.concept || 'Abono al hogar',
              tipo: 'Abono',
              amount: data.amount - allocatedTotal,
              debtor: data.debtor,
              category: data.category,
              date: new Date(data.date + 'T12:00:00'),
              registeredBy: user.uid,
              estado: '',
              saldaId: null,
              notas: data.notas ?? '',
              cruzado: false,
            })
          }
          showToast(`Abono de ${formatCOP(data.amount)} distribuido en ${allocations.length} deuda(s)`, 'success')
          tellHousehold(`${myName} registró un abono`, `${formatCOP(data.amount)} repartidos en ${allocations.length} deuda(s).`)
        } else {
          await addHouseholdDebt({
            householdId: activeId,
            concept: data.concept || 'Abono al hogar',
            tipo: 'Abono',
            amount: data.amount,
            debtor: data.debtor,
            category: data.category,
            date: new Date(data.date + 'T12:00:00'),
            registeredBy: user.uid,
            estado: '',
            saldaId: null,
            notas: data.notas ?? '',
            cruzado: false,
          })
          showToast(`Abono de ${formatCOP(data.amount)} registrado`, 'success')
          tellHousehold(`${myName} registró un abono`, `${formatCOP(data.amount)}${data.concept ? ` · ${data.concept}` : ''}.`)
        }
      }

      debtForm.reset({ date: format(new Date(), 'yyyy-MM-dd'), tipo: 'Abono', category: 'otros_hogar', debtor: user.uid })
      setSaldaTargetId(null)
      setSelectedTargetDebtId(null)
      setOpenDebt(false)
      await reloadDebts()
    } catch {
      showToast('Error al registrar abono', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onCreateHousehold(data: HHForm) {
    if (!user) return
    setSaving(true)
    let id: string
    try {
      id = (await createHousehold(user.uid, data.name, myDisplayName, user.photoURL)).id
    } catch (err) {
      console.error('Error creando hogar:', err)
      showToast('Error al crear hogar', 'error')
      setSaving(false)
      return
    }
    // The household was created successfully — from here on, any failure is
    // just a local UI refresh glitch, not a lost write, so don't alarm the user.
    try {
      const newIds = [...hhIds, id]
      setProfile({ ...profile, householdIds: newIds } as any)
      const hhs = await getHouseholds(newIds)
      setHouseholds(hhs)
      setActiveId(id)
      hhForm.reset(); setOpenCreate(false)
      showToast('Hogar creado', 'success')
    } catch (err) {
      console.error('Hogar creado, pero falló al refrescar la vista:', err)
      showToast('Hogar creado — recarga la página para verlo', 'info')
      hhForm.reset(); setOpenCreate(false)
    } finally {
      setSaving(false)
    }
  }

  async function onJoinHousehold(data: JoinForm) {
    if (!user) return
    setSaving(true)
    let id: string
    try {
      id = (await joinHousehold(user.uid, data.code, myDisplayName, user.photoURL)).id
    } catch (err: any) {
      console.error('Error al unirse al hogar:', err)
      joinForm.setError('code', { message: err?.message ?? 'Código inválido' })
      setSaving(false)
      return
    }
    try {
      const newIds = hhIds.includes(id) ? hhIds : [...hhIds, id]
      setProfile({ ...profile, householdIds: newIds } as any)
      const hhs = await getHouseholds(newIds)
      setHouseholds(hhs)
      setActiveId(id)
      joinForm.reset(); setOpenJoin(false)
      showToast('Te uniste al hogar', 'success')
    } catch (err) {
      console.error('Te uniste al hogar, pero falló al refrescar la vista:', err)
      showToast('Te uniste al hogar — recarga la página para verlo', 'info')
      joinForm.reset(); setOpenJoin(false)
    } finally {
      setSaving(false)
    }
  }

  // A debt born from a gasto compartido (has expenseId) is deleted through its
  // expense, which cascades to every share it generated — not just this row.
  async function handleDelete(d: any) {
    const fromExpense = Boolean(d.expenseId)
    if (!(await ask(
      fromExpense
        ? '¿Eliminar este gasto compartido? Se borrará junto con la(s) deuda(s) que generó.'
        : '¿Eliminar este registro?',
      { title: fromExpense ? 'Eliminar gasto compartido' : 'Eliminar registro' },
    ))) return
    try {
      if (fromExpense) await deleteHouseholdExpense(d.expenseId, d.householdId ?? activeId)
      else await deleteHouseholdDebt(d.id)
      await reloadDebts()
      showToast('Eliminado', 'delete')
    } catch (err) {
      console.error('No se pudo eliminar el registro:', err)
      showToast('Error al eliminar', 'error')
    }
  }

  async function handleCreateCrossing(
    allocations: { debtId: string; amount: number }[],
    counterPersonId: string,
    notes: string,
  ) {
    if (!user || !activeId || !crossTarget) return
    setSaving(true)
    try {
      await addHouseholdCrossing({
        householdId:   activeId,
        debt1Id:       crossTarget.id,
        debt2PersonId: counterPersonId,
        allocations,
        initiatedBy:   user.uid,
        notes,
      })
      setCrossTarget(null)
      await reloadDebts()
      showToast(allocations.length > 1 ? 'Cruce registrado contra varias deudas' : 'Cruce registrado', 'success')
      tellHousehold(`${myName} registró un cruce de cuentas`, `${formatCOP(allocations.reduce((sum, a) => sum + a.amount, 0))} compensados entre ambos.`)
    } catch (e: any) {
      showToast(e.message ?? 'Error al cruzar', 'error')
    } finally { setSaving(false) }
  }

  async function handleRename() {
    if (!activeId || !renameVal.trim()) return
    setSaving(true)
    try {
      await renameHousehold(activeId, renameVal.trim())
      setHouseholds((prev) => prev.map((h) => h.id === activeId ? { ...h, name: renameVal.trim() } : h))
      setOpenSettings(false)
      showToast('Hogar renombrado', 'edit')
    } catch { showToast('Error al renombrar', 'error') }
    finally { setSaving(false) }
  }

  async function handleDeleteHousehold() {
    if (!user || !activeId) return
    if (!(await ask('¿Eliminar el hogar? Esto borrará TODOS los registros de deudas compartidas y no se puede deshacer.', { title: 'Eliminar hogar', confirmLabel: 'Eliminar hogar' }))) return
    setSaving(true)
    try {
      await deleteHousehold(activeId, user.uid)
      const newIds = hhIds.filter((id) => id !== activeId)
      setProfile({ ...profile, householdIds: newIds } as any)
      const hhs = await getHouseholds(newIds)
      setHouseholds(hhs)
      setActiveId((hhs[0]?.id as string) ?? null)
      setDebts([])
      setOpenSettings(false)
      showToast('Hogar eliminado', 'delete')
    } catch { showToast('Error al eliminar hogar', 'error') }
    finally { setSaving(false) }
  }

  function copyCode() {
    navigator.clipboard.writeText(household?.inviteCode as string ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleAbonar(d: any) {
    setSaldaTargetId(d.id)
    setSelectedTargetDebtId(null)
    const rem = remainingOf(d)
    debtForm.reset({
      date: format(new Date(), 'yyyy-MM-dd'),
      tipo: 'Abono',
      concept: `Abono: ${d.concept}`,
      amount: rem,
      debtor: d.debtor,
      category: d.category || 'otros_hogar',
      notas: '',
    })
    setOpenDebt(true)
  }

  function handleOpenAbonoGeneral(debtorUid?: string) {
    setSaldaTargetId(null)
    setSelectedTargetDebtId(null)
    const targetUid = debtorUid || user?.uid || ''
    const debtorPending = debts.filter((d: any) => d.debtor === targetUid && isPendingDebt(d))
    const totalPending = debtorPending.reduce((s: number, d: any) => s + remainingOf(d), 0)
    debtForm.reset({
      date: format(new Date(), 'yyyy-MM-dd'),
      tipo: 'Abono',
      concept: 'Abono al saldo del hogar',
      amount: totalPending > 0 ? totalPending : 0,
      debtor: targetUid,
      category: 'otros_hogar',
      notas: '',
    })
    setOpenDebt(true)
  }

  const handleSaldar = handleAbonar

  // Names
  const members      = (household?.members as string[] | undefined) ?? []
  const memberNames  = (household?.memberNames as Record<string, string> | undefined) ?? {}
  const memberPhotos = (household?.memberPhotos as Record<string, string | null> | undefined) ?? {}
  const partnerUid  = members.find((m: string) => m !== user?.uid)
    ?? (debts.find((d) => d.debtor !== user?.uid)?.debtor as string | null)
    ?? null

  const myName = myDisplayName || user?.displayName?.split(' ')[0] || 'Yo'
  const partnerName = partnerUid
    ? (memberNames[partnerUid]?.split(' ')[0]
        || (partnerUid.includes('@') ? partnerUid.split('@')[0].replace(/\d+/g, '').replace(/^./, (c: string) => c.toUpperCase()) : 'Pareja'))
    : 'Pareja'
  const myPhoto      = user?.photoURL ?? null
  const partnerPhoto = partnerUid ? (memberPhotos[partnerUid] ?? null) : null

  // The month selector only scopes "this cycle" REPORTING metrics (new activity
  // generated that month, and the payment history list). It must NOT hide unpaid
  // debts from earlier months — those stay active and carry forward until they're
  // actually crossed/abonado, exactly like the real household ledger: whatever
  // wasn't settled by month's end simply adds into the next month's running total.
  const monthDebts = debts.filter((d: any) => {
    const dt = d.date instanceof Date ? d.date : new Date(d.date)
    return dt.getFullYear() === selectedMonth.getFullYear() && dt.getMonth() === selectedMonth.getMonth()
  })

  // Live running balance — ALWAYS all-time, carries unpaid debt across months.
  // This drives "Saldos Activos" and the comparative bar, independent of the
  // month being browsed in the toolbar.
  const myNet        = user ? calcNetBalance(debts, user.uid, crossings) : 0
  const partnerNet   = partnerUid ? calcNetBalance(debts, partnerUid, crossings) : 0
  const myDebts       = debts.filter((d: any) => d.debtor === user?.uid)
  const partnerDebts  = partnerUid ? debts.filter((d: any) => d.debtor === partnerUid) : []

  // A crossing nets two real debts against each other — it only makes sense
  // when the counterpart actually owes something back. Without this, "Cruzar"
  // would let you net a debt against a counterpart who's already al día.
  function pendingDebtsOf(uid: string | null | undefined) {
    if (!uid) return []
    return debts.filter((d: any) => d.debtor === uid && isPendingDebt(d))
  }
  function counterpartOf(d: any): string | null | undefined {
    return d.debtor === user?.uid ? partnerUid : user?.uid
  }
  function counterpartPendingDebts(d: any) {
    return pendingDebtsOf(counterpartOf(d))
  }

  async function handleSettleAllToday() {
    if (!user || !activeId) return
    const partnerId = partnerUid
    const msg = partnerId
      ? `¿Registrar pagos mutuos a la fecha de hoy para saldar todas las cuentas?\n\n• ${myName}: ${formatCOP(Math.max(0, myNet))}\n• ${partnerName}: ${formatCOP(Math.max(0, partnerNet))}\n\nAmbos quedarán al día ($0).`
      : `¿Registrar pago a la fecha de hoy para quedar al día ($0)?`
    if (!(await ask(msg, { title: 'Saldar cuentas', tone: 'default', confirmLabel: 'Registrar pagos' }))) return
    setSaving(true)
    try {
      const todayDate = new Date()

      // 1. Settle me if myNet > 0
      if (myNet > 0) {
        const pendingMe = debts.filter((d: any) => d.debtor === user.uid && isPendingDebt(d))
        const allocs = allocateAbono(myNet, pendingMe)
        for (const a of allocs) {
          const d = pendingMe.find((x: any) => x.id === a.debtId)
          await addHouseholdDebt({
            householdId: activeId,
            concept: `Abono: ${d?.concept ?? 'Liquidación de cuentas'}`,
            tipo: 'Abono',
            amount: a.amount,
            debtor: user.uid,
            category: d?.category ?? 'otros_hogar',
            date: todayDate,
            registeredBy: user.uid,
            estado: '',
            saldaId: a.debtId,
            notas: `Pago mutuo completado a ${partnerName}`,
            cruzado: false,
          })
        }
        const totalAlloc = allocs.reduce((s, a) => s + a.amount, 0)
        if (myNet > totalAlloc) {
          await addHouseholdDebt({
            householdId: activeId,
            concept: `Liquidación saldo pendiente a ${partnerName}`,
            tipo: 'Abono',
            amount: myNet - totalAlloc,
            debtor: user.uid,
            category: 'otros_hogar',
            date: todayDate,
            registeredBy: user.uid,
            estado: '',
            saldaId: null,
            notas: `Pago mutuo completado a ${partnerName}`,
            cruzado: false,
          })
        }
      }

      // 2. Settle Partner if partnerNet > 0 and partnerUid exists
      if (partnerNet > 0 && partnerUid) {
        const pendingPartner = debts.filter((d: any) => d.debtor === partnerUid && isPendingDebt(d))
        const allocs = allocateAbono(partnerNet, pendingPartner)
        for (const a of allocs) {
          const d = pendingPartner.find((x: any) => x.id === a.debtId)
          await addHouseholdDebt({
            householdId: activeId,
            concept: `Abono: ${d?.concept ?? 'Liquidación de cuentas'}`,
            tipo: 'Abono',
            amount: a.amount,
            debtor: partnerUid,
            category: d?.category ?? 'otros_hogar',
            date: todayDate,
            registeredBy: user.uid,
            estado: '',
            saldaId: a.debtId,
            notas: `Pago mutuo completado a ${myName}`,
            cruzado: false,
          })
        }
        const totalAlloc = allocs.reduce((s, a) => s + a.amount, 0)
        if (partnerNet > totalAlloc) {
          await addHouseholdDebt({
            householdId: activeId,
            concept: `Liquidación saldo pendiente a ${myName}`,
            tipo: 'Abono',
            amount: partnerNet - totalAlloc,
            debtor: partnerUid,
            category: 'otros_hogar',
            date: todayDate,
            registeredBy: user.uid,
            estado: '',
            saldaId: null,
            notas: `Pago mutuo completado a ${myName}`,
            cruzado: false,
          })
        }
      }

      await reloadDebts()
      showToast('¡Cuentas mutuas 100% saldadas a la fecha de hoy!', 'success')
      tellHousehold(`${myName} saldó las cuentas`, 'Se registraron pagos mutuos a la fecha de hoy.')
    } catch (err: any) {
      console.error('Error saldando cuentas:', err)
      showToast(err?.message || 'Error al saldar cuentas', 'error')
    } finally {
      setSaving(false)
    }
  }

  // "This cycle" reporting — new activity generated within the selected month only.
  const totalGen     = monthDebts.filter(d => d.tipo === 'Deuda').reduce((s: number, d: any) => s + d.amount, 0)
  const totalCruzado = monthDebts.filter(d => d.tipo === 'Deuda').reduce((s: number, d: any) => s + ((d.crossedAmount as number) || 0), 0)
  const totalAbono   = monthDebts.filter(d => d.tipo === 'Abono').reduce((s: number, d: any) => s + d.amount, 0)
  const pendiente    = totalGen - totalCruzado - totalAbono
  const progress     = totalGen > 0 ? Math.min(100, Math.round(((totalCruzado + totalAbono) / totalGen) * 100)) : 0
  const myMonthGen      = monthDebts.filter((d: any) => d.tipo === 'Deuda' && d.debtor === user?.uid).reduce((s: number, d: any) => s + d.amount, 0)
  const partnerMonthGen = partnerUid ? monthDebts.filter((d: any) => d.tipo === 'Deuda' && d.debtor === partnerUid).reduce((s: number, d: any) => s + d.amount, 0) : 0

  // Abono deleted from a debt's detail
  async function handleDeleteAbono(a: any) {
    if (!(await ask(`¿Eliminar este abono de ${formatCOP(a.amount)}?`, { title: 'Eliminar abono' }))) return
    try {
      await deleteHouseholdDebt(a.id)
      await reloadDebts()
      showToast('Abono eliminado', 'delete')
    } catch (err) {
      console.error('No se pudo eliminar el abono:', err)
      showToast('Error al eliminar el abono', 'error')
    }
  }

  function closeAbono() {
    setOpenDebt(false)
    setSaldaTargetId(null)
    setSelectedTargetDebtId(null)
  }

  // Full ledger since day one; the timeline shows the selected month and carries the earlier balance in
  const ledger = buildLedger(debts, crossings, user?.uid, partnerUid)
  const { monthRows, carryIn } = splitByMonth(ledger.rows, selectedMonth)

  const myBreakdown      = balanceBreakdown(debts, crossings, user?.uid)
  const partnerBreakdown = balanceBreakdown(debts, crossings, partnerUid ?? undefined)

  const debtorOptions = [
    { value: user?.uid ?? '', label: myName },
    ...(partnerUid ? [{ value: partnerUid, label: partnerName }] : []),
  ]

  const expenseMembers = [
    { uid: user?.uid ?? '', name: myName, photoURL: myPhoto },
    ...(partnerUid ? [{ uid: partnerUid, name: partnerName, photoURL: partnerPhoto }] : []),
  ]

  if (loading) {
    return (
      <div className="flex flex-col gap-5 lg:flex-row fade-in">
        <div className="h-64 lg:w-[32%] rounded-3xl skeleton" />
        <div className="h-64 lg:flex-1 rounded-3xl skeleton" />
      </div>
    )
  }

  const monthName = format(selectedMonth, 'MMMM', { locale: es })
  const showMonthControls = !selectedDebt && viewMode === 'clasico'

  function pickView(mode: 'clasico' | 'interactivo') {
    withTransition(() => { setViewMode(mode); setSelectedDebt(null) })
  }

  return (
    <div className="flex flex-col gap-5 fade-in text-[#f3f5f6] lg:flex-row lg:h-full lg:min-h-0">

      {/* Before entering a household: pick one (or create / join) */}
      {!household && (
        <CurvedScrollContainer className={clsx('lg:flex-1 lg:min-w-0 lg:min-h-0', framed)} {...scrollProps}>
          <HouseholdPicker
            households={households}
            currentUserUid={user?.uid ?? ''}
            onSelect={setActiveId}
            onCreateNew={() => setOpenCreate(true)}
            onJoin={() => setOpenJoin(true)}
          />
        </CurvedScrollContainer>
      )}

      {household && (
        <>
          {/* Left pane: who owes whom, the actions, and each person. On phones it gives way to the debt detail. */}
          <CurvedScrollContainer
            className={clsx('lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0', framed, selectedDebt && 'max-lg:hidden')}
            {...scrollProps}
          >
            <div style={{ viewTransitionName: `vt-household-${activeId}` } as React.CSSProperties}>
              <button
                onClick={() => withTransition(() => setActiveId(null))}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#9aa4ac] hover:text-white transition mb-2"
              >
                <ArrowLeft size={13} /> Hogares
              </button>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
                <Home size={11} className="text-brand-400" />
                <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Hogar</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight break-words">{household.name as string}</h1>
              <p className="hidden lg:block text-xs text-[#9aa4ac] mt-1">Cuentas compartidas: gastos que se dividen, abonos y cruces entre ustedes.</p>
            </div>

            {debtsLoading ? (
              <SkeletonList count={3} />
            ) : (
              <>
                <BalanceCard
                  diff={ledger.finalDiff}
                  myName={myName}
                  partnerName={partnerName}
                  myNet={myNet}
                  partnerNet={partnerNet}
                  hasPartner={Boolean(partnerUid)}
                  inviteCode={household.inviteCode as string}
                  saving={saving}
                  onExpense={() => setOpenExpense(true)}
                  onAbonar={() => handleOpenAbonoGeneral(user?.uid)}
                  onSettleAll={handleSettleAllToday}
                />

                <PersonCard
                  name={myName}
                  role="Responsable asignado"
                  photoURL={myPhoto}
                  color="#52b69a"
                  net={myNet}
                  breakdown={myBreakdown}
                  debts={myDebts}
                  canCross={pendingDebtsOf(partnerUid).length > 0}
                  expanded={myExpanded}
                  onToggle={() => setMyExpanded(!myExpanded)}
                  onAbonarAll={() => handleOpenAbonoGeneral(user?.uid)}
                  onCross={(d) => setCrossTarget(d)}
                  onAbonar={handleAbonar}
                  onSelect={(d) => withTransition(() => setSelectedDebt(d))}
                />
                {partnerUid && (
                  <PersonCard
                    name={partnerName}
                    role="Co-titular hogar"
                    photoURL={partnerPhoto}
                    color="#168aad"
                    net={partnerNet}
                    breakdown={partnerBreakdown}
                    debts={partnerDebts}
                    canCross={pendingDebtsOf(user?.uid).length > 0}
                    expanded={partnerExpanded}
                    onToggle={() => setPartnerExpanded(!partnerExpanded)}
                    onAbonarAll={() => handleOpenAbonoGeneral(partnerUid)}
                    onCross={(d) => setCrossTarget(d)}
                    onAbonar={handleAbonar}
                    onSelect={(d) => withTransition(() => setSelectedDebt(d))}
                  />
                )}
              </>
            )}
          </CurvedScrollContainer>

          {/* Right pane: fixed header (month, view, menu) and one card with summary on top, history below */}
          <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
              {showMonthControls ? (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => shiftMonth(-1)} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Mes anterior">
                    <ChevronLeft size={16} />
                  </button>
                  <div className="min-w-[160px] text-center">
                    <p className="text-sm font-semibold capitalize">{format(selectedMonth, 'MMMM yyyy', { locale: es })}</p>
                  </div>
                  <button onClick={() => shiftMonth(1)} className="p-2 rounded-lg bg-[#0d263a] border border-white/10 hover:bg-white/10 transition" aria-label="Mes siguiente">
                    <ChevronRight size={16} />
                  </button>
                  {!isCurrentMonth && (
                    <Button variant="secondary" size="sm" onClick={() => setSelectedMonth(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })}>Hoy</Button>
                  )}
                </div>
              ) : (
                <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">
                  {selectedDebt ? 'Detalle de deuda' : 'Vista interactiva'}
                </p>
              )}

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 bg-[#0d263a] border border-white/10 rounded-lg p-1">
                  <button
                    onClick={() => pickView('clasico')}
                    title="Vista resumen"
                    aria-label="Vista resumen"
                    className={clsx('p-1.5 rounded-md transition', viewMode === 'clasico' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/40' : 'text-[#9aa4ac] hover:text-white hover:bg-white/5 border border-transparent')}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    onClick={() => pickView('interactivo')}
                    title="Vista interactiva"
                    aria-label="Vista interactiva"
                    className={clsx('p-1.5 rounded-md transition', viewMode === 'interactivo' ? 'bg-brand-500/20 text-brand-300 border border-brand-500/40' : 'text-[#9aa4ac] hover:text-white hover:bg-white/5 border border-transparent')}
                  >
                    <Sparkles size={14} />
                  </button>
                </div>
                <HouseholdMenu
                  inviteCode={household.inviteCode as string}
                  copied={copied}
                  onSettings={() => { setRenameVal(household.name as string); setOpenSettings(true) }}
                  onInvite={() => setOpenInvite(true)}
                  onCopyCode={copyCode}
                  onSwitch={() => withTransition(() => setActiveId(null))}
                  onCreate={() => setOpenCreate(true)}
                  onJoin={() => setOpenJoin(true)}
                />
              </div>
            </div>

            <div className={clsx('flex flex-col lg:flex-1 lg:min-h-0', framed)}>
              {selectedDebt ? (
                <CurvedScrollContainer className="lg:flex-1 lg:min-h-0" {...scrollProps}>
                  <HouseholdDebtDetail
                    debt={selectedDebt}
                    debts={debts}
                    crossings={crossings}
                    myName={myName}
                    partnerName={partnerName}
                    userUid={user?.uid}
                    canCross={counterpartPendingDebts(selectedDebt).length > 0}
                    onBack={() => withTransition(() => setSelectedDebt(null))}
                    onCross={() => { setCrossTarget(selectedDebt); setSelectedDebt(null) }}
                    onAbonar={() => { handleAbonar(selectedDebt); setSelectedDebt(null) }}
                    onDelete={async () => { await handleDelete(selectedDebt); setSelectedDebt(null) }}
                    onDeleteAbono={handleDeleteAbono}
                  />
                </CurvedScrollContainer>
              ) : viewMode === 'interactivo' ? (
                <CurvedScrollContainer className="lg:flex-1 lg:min-h-0" {...scrollProps}>
                  {debtsLoading ? (
                    <SkeletonList count={3} />
                  ) : (
                    <FinanceExplorer
                      householdName={household.name as string}
                      members={expenseMembers}
                      currentUserUid={user?.uid ?? ''}
                      debts={debts}
                      crossings={crossings}
                      onOpenDebt={(d) => withTransition(() => setSelectedDebt(d))}
                    />
                  )}
                </CurvedScrollContainer>
              ) : (
                <>
                  <div className="flex-shrink-0 border-b border-white/10 p-5 space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold flex items-center gap-1.5">
                          Generado en {monthName}
                          <Tip text="Solo los gastos registrados en el mes que estás viendo, antes de abonos o cruces. No incluye saldo arrastrado de meses anteriores." />
                        </p>
                        <p className="text-2xl font-bold font-mono tabular-nums text-brand-300">{formatCOP(totalGen)}</p>
                      </div>
                      <span className="text-xs font-mono text-[#8a929a]">{monthRows.length} {monthRows.length === 1 ? 'movimiento' : 'movimientos'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#9aa4ac]">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#52b69a' }} />
                        {myName} <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(myMonthGen)}</span>
                      </span>
                      {partnerUid && (
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#168aad' }} />
                          {partnerName} <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(partnerMonthGen)}</span>
                        </span>
                      )}
                    </div>
                    {totalGen > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px]">
                          <span className="text-[#9aa4ac] flex items-center gap-1.5">
                            {formatCOP(totalAbono + totalCruzado)} cubierto ({progress}%)
                            <Tip text="De lo generado en este mes: lo ya abonado o compensado. No es el saldo total, ese es el de la tarjeta de saldo vigente." />
                          </span>
                          <span className="font-mono font-bold text-amber-300">{formatCOP(Math.max(0, pendiente))} por cubrir</span>
                        </div>
                        <ProgressBar value={progress} size="sm" />
                      </div>
                    )}
                  </div>

                  <CurvedScrollContainer className="lg:flex-1 lg:min-h-0" {...scrollProps} corners="bottom-right">
                    {debtsLoading ? (
                      <SkeletonList count={4} />
                    ) : monthRows.length === 0 && !carryIn ? (
                      <div className="text-center py-12 px-6">
                        <EmptyMark name="housing" />
                        <p className="text-sm font-bold text-[#f0fae8]">Sin movimientos en {monthName}</p>
                        <p className="text-xs text-[#8a929a] mt-1">Presiona "Gasto compartido" para registrar uno.</p>
                      </div>
                    ) : (
                      <HouseholdTimeline
                        rows={monthRows}
                        carryIn={carryIn}
                        myName={myName}
                        partnerName={partnerName}
                        myPhoto={myPhoto}
                        partnerPhoto={partnerPhoto}
                        showToday={isCurrentMonth}
                        onSelectDebt={(d) => withTransition(() => setSelectedDebt(d))}
                      />
                    )}
                  </CurvedScrollContainer>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Create / join stay reachable from the picker (no household yet) and from the menu (one open) */}
      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="Crear hogar">
        <form onSubmit={hhForm.handleSubmit(onCreateHousehold)} className="space-y-4">
          <Input label="Nombre del hogar" placeholder="ej. Casa Carlos y Alexandra" {...hhForm.register('name')} error={hhForm.formState.errors.name?.message} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenCreate(false)}>Cancelar</Button>
            <Button type="submit" notched className="flex-1" disabled={saving}>{saving ? 'Creando…' : 'Crear'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={openJoin} onClose={() => setOpenJoin(false)} title="Unirme a un hogar">
        <form onSubmit={joinForm.handleSubmit(onJoinHousehold)} className="space-y-4">
          <Input label="Código de invitación" placeholder="ABC123" maxLength={6} className="uppercase" {...joinForm.register('code')} error={joinForm.formState.errors.code?.message} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenJoin(false)}>Cancelar</Button>
            <Button type="submit" notched className="flex-1" disabled={saving}>{saving ? 'Uniéndome…' : 'Unirme'}</Button>
          </div>
        </form>
      </Modal>

      {household && (
        <HouseholdSettingsModal
          open={openSettings}
          onClose={() => setOpenSettings(false)}
          name={renameVal}
          onNameChange={setRenameVal}
          saving={saving}
          onRename={handleRename}
          onDelete={handleDeleteHousehold}
        />
      )}

      {household && (
        <InviteModal
          open={openInvite}
          onClose={() => setOpenInvite(false)}
          householdId={household.id as string}
          householdName={household.name as string}
          inviteCode={household.inviteCode as string}
          members={members}
          myUid={user?.uid ?? ''}
          myEmail={user?.email ?? ''}
          myName={myName}
        />
      )}

      {crossTarget && (
        <CrossingModal
          debt={crossTarget}
          counterPersonId={crossTarget.debtor === user?.uid ? (partnerUid ?? '') : (user?.uid ?? '')}
          counterpartDebts={counterpartPendingDebts(crossTarget)}
          myName={myName}
          partnerName={partnerName}
          userUid={user?.uid}
          saving={saving}
          onConfirm={handleCreateCrossing}
          onClose={() => setCrossTarget(null)}
        />
      )}

      <AbonoModal
        open={openDebt}
        onClose={closeAbono}
        form={debtForm}
        onSubmit={onAddDebt}
        debts={debts}
        saldaTargetId={saldaTargetId}
        selectedTargetDebtId={selectedTargetDebtId}
        onPickTarget={setSelectedTargetDebtId}
        userUid={user?.uid}
        myName={myName}
        partnerName={partnerName}
        debtorOptions={debtorOptions}
        saving={saving}
      />

      {activeId && (
        <HouseholdExpenseModal
          open={openExpense}
          onClose={() => setOpenExpense(false)}
          householdId={activeId}
          members={expenseMembers}
          currentUserUid={user?.uid ?? ''}
          onCreated={reloadDebts}
        />
      )}
    </div>
  )
}
