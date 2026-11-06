import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ChevronLeft, ChevronRight, Home } from 'lucide-react'
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
import { saveAttachment } from '@/lib/attachments'
import { useDisplayName } from '@/hooks/useDisplayName'
import {
  createHousehold, joinHousehold, getHouseholds, syncMemberPhotos, deleteHouseholdLoan,
  addHouseholdDebt, getHouseholdDebts, deleteHouseholdDebt, deleteHouseholdExpense,
  calcNetBalance, renameHousehold, deleteHousehold, getHouseholdIds,
  addHouseholdCrossing, getHouseholdCrossings, notifyHouseholdMembers, getAccounts,
} from '@/lib/firestore'
import { formatCOP, remainingOf, allocateAbono, inPaymentOrder, isPendingDebt, creditorOf, owedByCreditor, othersOf, planAbono } from '@/shared'
import { ConfirmReceiptModal } from '@/components/household/ConfirmReceiptModal'
import { HouseholdExpenseModal } from '@/components/household/HouseholdExpenseModal'
import { HouseholdLoanModal } from '@/components/household/HouseholdLoanModal'
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
import { buildLedger, balanceBreakdown, nestByDebt, statusOf } from '@/components/household/ledger'
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
  const [abonoFile, setAbonoFile]     = useState<File | null>(null)
  const [openExpense, setOpenExpense] = useState(false)
  const [openLoan, setOpenLoan] = useState(false)
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
  const [expandedOthers, setExpandedOthers] = useState<Record<string, boolean>>({})
  const [selectedDebt, setSelectedDebt]   = useState<any | null>(null)
  const [showPast, setShowPast] = useState(false)
  // a payment I received and still have to confirm
  const [receiptToConfirm, setReceiptToConfirm] = useState<any | null>(null)
  // my accounts: an abono is paid from one of them
  const [accounts, setAccounts] = useState<{ id: string; name: string; balance: number; isDefault?: boolean }[]>([])
  const loadAccounts = () => { if (user) getAccounts(user.uid).then((a) => setAccounts(a as any)).catch(() => {}) }
  useEffect(loadAccounts, [user?.uid])
  const defaultAccountId = accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? ''

  /** Same morph-on-navigate trick as HouseholdPicker/FinanceExplorer — any
   *  state change wrapped here animates via the native View Transitions API
   *  instead of jump-cutting, falling back to instant on unsupported browsers. */
  function withTransition(fn: () => void) {
    const anyDoc = document as any
    if (typeof anyDoc.startViewTransition === 'function') anyDoc.startViewTransition(fn)
    else fn()
  }

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

  /**
   * A payment is announced to the person who receives it, with the detail of what it went to, so they can confirm it and
   * say in which account they got it. When nobody can be told apart, the rest of the household just hears about it.
   */
  function tellPayment(to: string | null, amount: number, lines: { concept: string; amount: number }[], paymentId: string, date: Date) {
    if (!user || !activeId) return
    if (!to || to === user.uid) { tellHousehold(`${myName} registró un abono`, `${formatCOP(amount)}.`); return }
    notifyHouseholdMembers([to], {
      fromUid: user.uid, zone: 'hogar', severity: 'info',
      title: `${myName} te pagó ${formatCOP(amount)}`,
      body: `${lines.map((l) => `${l.concept} (${formatCOP(l.amount)})`).join(' · ')}. Confirma que lo recibiste y en qué cuenta.`,
      link: `/hogar?id=${activeId}`,
      receipt: { householdId: activeId, paymentId, amount, fromName: myName, lines, date: date.toISOString() },
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
        const hhs = await getHouseholds(hhIds, user!.uid)
        setHouseholds(hhs)
        // make sure my own photo is in every household I belong to (the others see me with it)
        syncMemberPhotos(hhs as any[], user!.uid, user!.photoURL)
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
      // everything this submit writes is ONE payment, even when it is split across several debts
      const paymentId = crypto.randomUUID()
      const toConfirm = (c: string | null) => (c && c !== user.uid ? 'pending' as const : null)
      const paidAt = new Date(data.date + 'T12:00:00')
      // who is paid and how it is split is decided by the shared planner (also used to confirm an abono prepared in Telegram)
      const plan = planAbono({
        debts, members, debtor: data.debtor, creditor: data.creditor || null, targetDebtId: effectiveTargetId,
        amount: data.amount, concept: data.concept, category: data.category,
      })

      // one picture for the whole payment, also readable by the other members (the person who receives it can check it)
      const attachmentId = abonoFile ? await saveAttachment(user.uid, abonoFile, members.filter((m) => m !== user.uid)) : undefined
      for (const r of plan.rows) {
        await addHouseholdDebt({
          householdId: activeId,
          concept: r.concept,
          tipo: 'Abono',
          amount: r.amount,
          debtor: data.debtor,
          creditor: r.creditor,
          paymentId,
          accountId: data.accountId || null,
          receiptStatus: toConfirm(r.creditor),
          category: r.category,
          date: paidAt,
          registeredBy: user.uid,
          estado: '',
          saldaId: r.saldaId,
          notas: data.notas ?? '',
          cruzado: false,
          ...(attachmentId ? { attachmentId } : {}),
        })
      }

      if (plan.kind === 'target') {
        if (plan.remainingAfter === 0) showToast(`¡Deuda "${plan.targetConcept}" 100% saldada!`, 'success')
        else showToast(`Abono de ${formatCOP(data.amount)} registrado. Saldo pendiente: ${formatCOP(plan.remainingAfter ?? 0)}`, 'success')
      } else if (plan.kind === 'allocated') {
        showToast(`Abono de ${formatCOP(data.amount)} distribuido en ${plan.allocations} deuda(s)`, 'success')
      } else {
        showToast(`Abono de ${formatCOP(data.amount)} registrado`, 'success')
      }

      tellPayment(plan.paidTo, data.amount, plan.paidLines, paymentId, paidAt)
      setAbonoFile(null)
      debtForm.reset({ date: format(new Date(), 'yyyy-MM-dd'), tipo: 'Abono', category: 'otros_hogar', debtor: user.uid, creditor: '', accountId: defaultAccountId })
      loadAccounts()
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
    const isLoan = Boolean(d.loanId)
    if (!(await ask(
      isLoan
        ? `¿Eliminar el préstamo completo${d.installments > 1 ? ` (${d.installments} cuotas)` : ''}? Se borran todas sus cuotas y los abonos que se hayan aplicado.`
        : fromExpense
          ? '¿Eliminar este gasto compartido? Se borrará junto con la(s) deuda(s) que generó.'
          : '¿Eliminar este registro?',
      { title: isLoan ? 'Eliminar préstamo' : fromExpense ? 'Eliminar gasto compartido' : 'Eliminar registro' },
    ))) return
    try {
      if (isLoan) await deleteHouseholdLoan(d.loanId, d.householdId ?? activeId)
      else if (fromExpense) await deleteHouseholdExpense(d.expenseId, d.householdId ?? activeId)
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
    // each person is responsible for their own abonos, from their own account
    if (d.debtor !== user?.uid) {
      showToast(`Solo ${nameOf(d.debtor)} puede registrar sus abonos`, 'info')
      return
    }
    setSaldaTargetId(d.id)
    setSelectedTargetDebtId(null)
    const rem = remainingOf(d)
    debtForm.reset({
      date: format(new Date(), 'yyyy-MM-dd'),
      tipo: 'Abono',
      concept: '',
      amount: rem,
      debtor: d.debtor,
      creditor: creditorOf(d, members) ?? '',
      accountId: defaultAccountId,
      category: d.category || 'otros_hogar',
      notas: '',
    })
    setOpenDebt(true)
  }

  function handleOpenAbonoGeneral(debtorUid?: string) {
    setSaldaTargetId(null)
    setSelectedTargetDebtId(null)
    // each person is responsible for their own abonos, from their own account
    if (debtorUid && debtorUid !== user?.uid) {
      showToast(`Solo ${nameOf(debtorUid)} puede registrar sus abonos`, 'info')
      return
    }
    const targetUid = user?.uid || ''
    // with several creditors it starts with the one owed the most; the modal lets the person change it
    const lines = owedByCreditor(debts, targetUid, members)
    const firstCreditor = lines[0]?.creditor ?? ''
    const totalPending = lines[0]?.owed ?? 0
    if (totalPending <= 0) {
      showToast('Cuentas al día: no hay deudas pendientes para abonar', 'info')
      return
    }
    debtForm.reset({
      date: format(new Date(), 'yyyy-MM-dd'),
      tipo: 'Abono',
      concept: '',
      amount: totalPending > 0 ? totalPending : 0,
      debtor: targetUid,
      creditor: firstCreditor,
      accountId: defaultAccountId,
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
  const myName = myDisplayName || user?.displayName?.split(' ')[0] || 'Yo'
  const otherUids = othersOf(members, user?.uid)
  // legacy: a household that lost its member list still shows the person who has debts in it
  const partnerUid = otherUids[0] ?? (debts.find((d) => d.debtor !== user?.uid)?.debtor as string | null) ?? null
  const multi = members.length > 2
  const PALETTE = ['#52b69a', '#168aad', '#f59e0b', '#a855f7', '#ec4899', '#22c55e', '#38bdf8', '#f97316']
  const colorOf = (uid: string) => PALETTE[Math.max(0, members.indexOf(uid)) % PALETTE.length]
  const firstNameOf = (uid: string) => memberNames[uid]?.split(' ')[0]
    || (uid.includes('@') ? uid.split('@')[0].replace(/\d+/g, '').replace(/^./, (c: string) => c.toUpperCase()) : 'Integrante')
  const nameOf = (uid?: string | null): string => !uid ? 'la otra persona' : uid === user?.uid ? myName : firstNameOf(uid)
  const photoOf = (uid: string): string | null => uid === user?.uid ? (user?.photoURL ?? null) : (memberPhotos[uid] ?? null)
  const partnerName = partnerUid ? nameOf(partnerUid) : 'Pareja'
  const myPhoto = user?.photoURL ?? null

  // The history is not cut by month: the summary covers every record of the household.
  const monthDebts = debts

  // Live running balance — ALWAYS all-time, carries unpaid debt across months.
  // This drives "Saldos Activos" and the comparative bar, independent of the
  // month being browsed in the toolbar.
  const myNet        = user ? calcNetBalance(debts, user.uid, crossings) : 0
  const myDebts       = debts.filter((d: any) => d.debtor === user?.uid)

  // A crossing nets two real debts against each other — it only makes sense
  // when the counterpart actually owes something back. Without this, "Cruzar"
  // would let you net a debt against a counterpart who's already al día.
  function pendingDebtsOf(uid: string | null | undefined) {
    if (!uid) return []
    return debts.filter((d: any) => d.debtor === uid && isPendingDebt(d))
  }
  // A crossing is between the debt's debtor and the person it is owed to, and I have to be one of them
  function counterpartOf(d: any): string | null {
    const creditor = creditorOf(d, members)
    return creditor && (d.debtor === user?.uid || creditor === user?.uid) ? creditor : null
  }
  /** What the creditor owes back to this debt's debtor: the debts it can be crossed against. */
  function counterpartPendingDebts(d: any) {
    const c = counterpartOf(d)
    return c ? debts.filter((x: any) => x.debtor === c && isPendingDebt(x) && creditorOf(x, members) === d.debtor) : []
  }

  // "This cycle" reporting — new activity generated within the selected month only.
  const totalGen     = monthDebts.filter(d => d.tipo === 'Deuda').reduce((s: number, d: any) => s + d.amount, 0)
  const totalCruzado = monthDebts.filter(d => d.tipo === 'Deuda').reduce((s: number, d: any) => s + ((d.crossedAmount as number) || 0), 0)
  const totalAbono   = monthDebts.filter(d => d.tipo === 'Abono').reduce((s: number, d: any) => s + d.amount, 0)
  const pendiente    = totalGen - totalCruzado - totalAbono
  const progress     = totalGen > 0 ? Math.min(100, Math.round(((totalCruzado + totalAbono) / totalGen) * 100)) : 0
  const myMonthGen      = monthDebts.filter((d: any) => d.tipo === 'Deuda' && d.debtor === user?.uid).reduce((s: number, d: any) => s + d.amount, 0)
  const monthGenOf = (uid: string) => monthDebts.filter((d: any) => d.tipo === 'Deuda' && d.debtor === uid).reduce((s: number, d: any) => s + d.amount, 0)

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
    setAbonoFile(null)
    setSaldaTargetId(null)
    setSelectedTargetDebtId(null)
  }

  // Full ledger since day one, one row per debt with its abonos/crossings inside. The timeline starts at the oldest
  // thing still open (or the last 30 days when everything is settled) and runs forward; what came before is one click away.
  const ledger = buildLedger(debts, crossings, user?.uid, partnerUid)
  const allRows = nestByDebt(ledger.rows)
  const openFrom = allRows
    .filter((r) => r.kind === 'deuda' && ['overdue', 'due-soon', 'pending'].includes(statusOf(r)))
    .reduce((min, r) => Math.min(min, r.date.getTime()), Infinity)
  const startMs = Number.isFinite(openFrom) ? openFrom : Date.now() - 30 * 86_400_000
  const olderCount = allRows.filter((r) => r.date.getTime() < startMs).length
  const monthRows = showPast ? allRows : allRows.filter((r) => r.date.getTime() >= startMs)
  const carryIn: number | null = null
  const carryOwed = 0

  const myBreakdown      = balanceBreakdown(debts, crossings, user?.uid)

  // an abono is always paid by the person who registers it
  const debtorOptions = [{ value: user?.uid ?? '', label: myName }]

  const expenseMembers = [
    { uid: user?.uid ?? '', name: myName, photoURL: myPhoto },
    ...otherUids.map((uid) => ({ uid, name: nameOf(uid), photoURL: photoOf(uid) })),
  ]
  const people = [
    { uid: user?.uid ?? '', name: myName, net: myNet, color: colorOf(user?.uid ?? '') },
    ...otherUids.map((uid) => ({ uid, name: nameOf(uid), net: calcNetBalance(debts, uid, crossings), color: colorOf(uid) })),
  ]
  const myCreditors = owedByCreditor(debts, user?.uid ?? '', members).map((l) => ({ name: nameOf(l.creditor), owed: l.owed }))

  if (loading) {
    return (
      <div className="flex flex-col gap-5 lg:flex-row fade-in">
        <div className="h-64 lg:w-[32%] rounded-3xl skeleton" />
        <div className="h-64 lg:flex-1 rounded-3xl skeleton" />
      </div>
    )
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
                  people={people}
                  myUid={user?.uid ?? ''}
                  myCreditors={myCreditors}
                  inviteCode={household.inviteCode as string}
                  saving={saving}
                  onExpense={() => setOpenExpense(true)}
                  onLoan={() => setOpenLoan(true)}
                  onAbonar={() => handleOpenAbonoGeneral(user?.uid)}
                />

                <PersonCard
                  name={myName}
                  role="Responsable asignado"
                  photoURL={myPhoto}
                  color={colorOf(user?.uid ?? '')}
                  net={myNet}
                  breakdown={myBreakdown}
                  debts={myDebts}
                  canCross={(d) => counterpartPendingDebts(d).length > 0}
                  creditorName={multi ? (d) => { const c = creditorOf(d, members); return c ? nameOf(c) : null } : undefined}
                  expanded={myExpanded}
                  onToggle={() => setMyExpanded(!myExpanded)}
                  canAbonar
                  onAbonarAll={() => handleOpenAbonoGeneral(user?.uid)}
                  onCross={(d) => setCrossTarget(d)}
                  onAbonar={handleAbonar}
                  onSelect={(d) => withTransition(() => setSelectedDebt(d))}
                />
                {otherUids.map((uid) => (
                  <PersonCard
                    key={uid}
                    name={nameOf(uid)}
                    role={multi ? 'Integrante del hogar' : 'Co-titular hogar'}
                    photoURL={photoOf(uid)}
                    color={colorOf(uid)}
                    net={people.find((p) => p.uid === uid)?.net ?? 0}
                    breakdown={balanceBreakdown(debts, crossings, uid)}
                    debts={debts.filter((d: any) => d.debtor === uid)}
                    canCross={(d) => counterpartPendingDebts(d).length > 0}
                    creditorName={multi ? (d) => { const c = creditorOf(d, members); return c ? nameOf(c) : null } : undefined}
                    expanded={Boolean(expandedOthers[uid])}
                    onToggle={() => setExpandedOthers((prev) => ({ ...prev, [uid]: !prev[uid] }))}
                    canAbonar={false}
                    onAbonarAll={() => handleOpenAbonoGeneral(uid)}
                    onCross={(d) => setCrossTarget(d)}
                    onAbonar={handleAbonar}
                    onSelect={(d) => withTransition(() => setSelectedDebt(d))}
                  />
                ))}
              </>
            )}
          </CurvedScrollContainer>

          {/* Right pane: fixed header (month, view, menu) and one card with summary on top, history below */}
          <div className="min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
              {!selectedDebt ? (
                <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">
                  Historial del hogar
                </p>
              ) : (
                <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">
                  Detalle de deuda
                </p>
              )}

              <div className="flex items-center gap-2">
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
                    nameOf={nameOf}
                    creditorId={creditorOf(selectedDebt, members)}
                    userUid={user?.uid}
                    canCross={counterpartPendingDebts(selectedDebt).length > 0}
                    onBack={() => withTransition(() => setSelectedDebt(null))}
                    onCross={() => { setCrossTarget(selectedDebt); setSelectedDebt(null) }}
                    onAbonar={() => { handleAbonar(selectedDebt); setSelectedDebt(null) }}
                    onDelete={async () => { await handleDelete(selectedDebt); setSelectedDebt(null) }}
                    onDeleteAbono={handleDeleteAbono}
                  />
                </CurvedScrollContainer>
              ) : (
                <>
                  <div className="flex-shrink-0 border-b border-white/10 p-5 space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold flex items-center gap-1.5">
                          Generado en el hogar
                          <Tip text="Todo lo registrado en el hogar, antes de abonos o cruces." />
                        </p>
                        <p className="text-2xl font-bold font-mono tabular-nums text-brand-300">{formatCOP(totalGen)}</p>
                      </div>
                      <span className="text-xs font-mono text-[#8a929a]">{monthRows.length} {monthRows.length === 1 ? 'movimiento' : 'movimientos'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#9aa4ac]">
                      {[user?.uid ?? '', ...otherUids].map((uid) => (
                        <span key={uid} className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(uid) }} />
                          {nameOf(uid)} <span className="font-mono font-semibold text-[#f0fae8]">{formatCOP(monthGenOf(uid))}</span>
                        </span>
                      ))}
                    </div>
                    {totalGen > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px]">
                          <span className="text-[#9aa4ac] flex items-center gap-1.5">
                            {formatCOP(totalAbono + totalCruzado)} cubierto ({progress}%)
                            <Tip text="De todo lo generado: lo ya abonado o compensado." />
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
                        <p className="text-sm font-bold text-[#f0fae8]">Aún no hay movimientos</p>
                        <p className="text-xs text-[#8a929a] mt-1">Presiona "Gasto compartido" para registrar uno.</p>
                      </div>
                    ) : (
                      <HouseholdTimeline
                        rows={monthRows}
                        carryIn={carryIn}
                        carryOwed={carryOwed}
                        olderCount={olderCount}
                        showingOlder={showPast}
                        onToggleOlder={() => setShowPast((v) => !v)}
                        multi={multi}
                        myName={myName}
                        partnerName={partnerName}
                        nameOf={nameOf}
                        accountName={(id) => accounts.find((a) => a.id === id)?.name ?? null}
                        myUid={user?.uid}
                        onConfirmReceipt={(pay) => {
                          const kids = pay.children ?? []
                          setReceiptToConfirm({
                            householdId: activeId, paymentId: kids[0]?.debt?.paymentId, amount: Math.abs(pay.delta), fromName: nameOf(pay.debtor),
                            lines: kids.map((k) => ({ concept: (k.target?.concept as string) ?? (k.debt?.concept as string), amount: Math.abs(k.delta) })),
                            date: pay.date.toISOString(),
                          })
                        }}
                        photoOf={photoOf}
                        colorOf={colorOf}
                        showToday
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
          <Input label="Nombre del hogar" placeholder="ej. Mi casa, Apartamento, Familia…" {...hhForm.register('name')} error={hhForm.formState.errors.name?.message} />
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
          counterPersonId={counterpartOf(crossTarget) ?? ''}
          counterpartDebts={counterpartPendingDebts(crossTarget)}
          nameOf={nameOf}
          saving={saving}
          onConfirm={handleCreateCrossing}
          onClose={() => setCrossTarget(null)}
        />
      )}

      <ConfirmReceiptModal
        open={!!receiptToConfirm}
        onClose={() => setReceiptToConfirm(null)}
        receipt={receiptToConfirm}
        onConfirmed={() => { reloadDebts(); loadAccounts() }}
      />

      <AbonoModal
        open={openDebt}
        onClose={closeAbono}
        form={debtForm}
        onSubmit={onAddDebt}
        debts={debts}
        saldaTargetId={saldaTargetId}
        selectedTargetDebtId={selectedTargetDebtId}
        onPickTarget={setSelectedTargetDebtId}
        members={members}
        nameOf={nameOf}
        accounts={accounts}
        debtorOptions={debtorOptions}
        saving={saving}
        file={abonoFile}
        onFile={setAbonoFile}
      />

      {activeId && (
        <HouseholdLoanModal
          open={openLoan}
          onClose={() => setOpenLoan(false)}
          householdId={activeId}
          members={expenseMembers}
          currentUserUid={user?.uid ?? ''}
          onCreated={reloadDebts}
        />
      )}

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
