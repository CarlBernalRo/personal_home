import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ClipboardList, ChevronLeft, ChevronRight, Coins, HandCoins, Home, Network, ShoppingBag, Users } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { SkeletonList } from '@/components/ui/Skeleton'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { MobileSectionBar, useMobileSections } from '@/components/ui/MobileSections'
import { CurvedScrollContainer } from '@/components/ui/CurvedScrollContainer'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useLayoutStore } from '@/store/layout'
import { saveAttachment } from '@/lib/attachments'
import { useDisplayName } from '@/hooks/useDisplayName'
import {
  createHousehold, joinHousehold, getHouseholds, syncMemberPhotos, deleteHouseholdLoan,
  setSettlementPlan, uncrossHousehold, addHouseholdDebt, getHouseholdDebts, deleteHouseholdDebt, deleteHouseholdPayment, deleteHouseholdExpense,
  renameHousehold, deleteHousehold, getHouseholdIds, setHouseholdArchived,
  addHouseholdCrossing, getHouseholdCrossings, notifyHouseholdMembers, getAccounts,
  addGuestMember, removeGuestMember, addHouseholdDebtsBatch, getHouseholdExpenses, confirmExpenseContribution, declineExpenseContribution,
  subscribeHouseholdDebts, subscribeHouseholdCrossings, subscribeHouseholdExpenses, subscribeHouseholdDocs, backfillPendingContributors,
} from '@/lib/firestore'
import { formatCOP, remainingOf, isPendingDebt, creditorOf, owedByCreditor, othersOf, planAbono, householdBalances } from '@/shared'
import { ConfirmReceiptModal } from '@/components/household/ConfirmReceiptModal'
import { HouseholdExpenseModal } from '@/components/household/HouseholdExpenseModal'
import { HouseholdLoanModal } from '@/components/household/HouseholdLoanModal'
import { HouseholdPicker } from '@/components/household/HouseholdPicker'
import { PersonCard, Tip } from '@/components/household/PersonCard'
import { HouseholdTimeline } from '@/components/household/HouseholdTimeline'
import { HouseholdDebtDetail } from '@/components/household/HouseholdDebtDetail'
import { HouseholdMenu } from '@/components/household/HouseholdMenu'
import { HouseholdSettingsModal } from '@/components/household/HouseholdSettingsModal'
import { HouseholdReportModal } from '@/components/household/HouseholdReportModal'
import { PaymentMap } from '@/components/household/PaymentMap'
import { buildHouseholdReport, type FrozenPlan } from '@/components/household/report'
import { InviteModal } from '@/components/household/InviteModal'
import { AddGuestModal } from '@/components/household/AddGuestModal'
import { PendingContributionsCard } from '@/components/household/PendingContributionsCard'
import { CrossingModal } from '@/components/household/CrossingModal'
import { AbonoModal, debtSchema, type DebtForm, type ExtraAbonoLine } from '@/components/household/AbonoModal'
import { buildLedger, nestByDebt, groupByExpense, statusOf, toDate, type LedgerRow } from '@/components/household/ledger'
import { MovementTimeline, type Movement } from '@/components/finance/MovementTimeline'
import { AppIcon, EmptyMark } from '@/components/ui/AppIcon'

type HogarSection = 'personas' | 'gastos' | 'pagos' | 'mapa'

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
  const leftCollapsed = useLayoutStore((s) => s.leftCollapsed)

  const [households, setHouseholds]   = useState<any[]>([])
  const [activeId, setActiveId]       = useState<string | null>(null)
  // the stored rows, each debt with what its abonos paid; `debts` below adds the balances in favor on top
  const [storedDebts, setDebts]       = useState<any[]>([])
  const [expenses, setExpenses]       = useState<any[]>([])
  /** The saved shared expense being corrected in the form, if any. */
  const [editingExpense, setEditingExpense] = useState<any | null>(null)
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
  const [openAddGuest, setOpenAddGuest] = useState(false)
  const [openSettings, setOpenSettings] = useState(false)
  const [openReport, setOpenReport] = useState(false)
  const [crossTarget, setCrossTarget]     = useState<any | null>(null)
  const [saldaTargetId, setSaldaTargetId] = useState<string | null>(null)
  /** Debts the step-by-step abono is about (one debt, or every creditor of one shared expense); null = a general abono. */
  const [scopeIds, setScopeIds] = useState<string[] | null>(null)
  /** The payments the report says a person has to make; the abono form opens with them filled in. */
  const [planPays, setPlanPays] = useState<{ to: string; name: string; amount: number }[] | null>(null)
  const [selectedTargetDebtId, setSelectedTargetDebtId] = useState<string | null>(null)
  const [saving, setSaving]               = useState(false)
  const [copied, setCopied]               = useState(false)
  const [renameVal, setRenameVal]         = useState('')
  const [expandedPeople, setExpandedPeople] = useState<Record<string, boolean>>({})
  const [selectedDebt, setSelectedDebt]   = useState<any | null>(null)
  const [showPast, setShowPast] = useState(false)
  /** The history has two views: the shared expenses created, and the payments made. */
  const [historyTab, setHistoryTab] = useState<'gastos' | 'pagos' | 'mapa'>('gastos')
  /** On phones only one section shows at a time (people, shared expenses, payments or the map). */
  const sections = useMobileSections<HogarSection>('personas')
  const mobileView = sections.active
  function openSection(id: HogarSection) {
    setSelectedDebt(null)
    if (id !== 'personas') setHistoryTab(id)
    sections.open(id)
  }
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
  // the household engine: every person's balance and what is open on each debt, whatever way people paid
  const balances = useMemo(() => householdBalances(storedDebts, (household?.members as string[] | undefined) ?? []), [storedDebts, household])
  const debts = balances.rows as any[]
  const positionOf = (uid: string | undefined) => (uid ? balances.people.get(uid)?.position ?? 0 : 0)

  /** Lets the other members of the active household know about something that changes their accounts. */
  function tellHousehold(title: string, body: string) {
    if (!user || !household || !activeId) return
    const recipients = ((household.members as string[] | undefined) ?? []).filter((uid) => !((household.guestIds as string[] | undefined) ?? []).includes(uid))
    notifyHouseholdMembers(recipients, {
      fromUid: user.uid, zone: 'hogar', severity: 'info', title, body, link: `/hogar?id=${activeId}`,
    }).catch(() => { /* a failed notice must never undo what was saved */ })
  }

  /**
   * A payment is announced to the person who receives it, with the detail of what it went to, so they can confirm it and
   * say in which account they got it. When nobody can be told apart, the rest of the household just hears about it.
   */
  function tellPayment(to: string | null, amount: number, lines: { concept: string; amount: number }[], paymentId: string, date: Date, payer: string) {
    if (!user || !activeId) return
    // who paid is who handed the money (a guest, say), not whoever typed it in: the notice names them, and says who registered it
    const payerName = payer === user.uid ? myName : nameOf(payer)
    const byOther = payer !== user.uid ? ` Lo registró ${myName}.` : ''
    const detail = lines.map((l) => `${l.concept} (${formatCOP(l.amount)})`).join(' · ')
    if (!to || to === user.uid) {
      tellHousehold(
        payer === user.uid ? `${myName} registró un abono de ${formatCOP(amount)}` : `${myName} registró un pago de ${payerName}`,
        payer === user.uid ? `${detail || formatCOP(amount)}.` : `${payerName} pagó ${formatCOP(amount)}${detail ? `: ${detail}` : ''}.`,
      )
      return
    }
    notifyHouseholdMembers([to], {
      fromUid: user.uid, zone: 'hogar', severity: 'info',
      title: `${payerName} te pagó ${formatCOP(amount)}`,
      body: `${detail}.${byOther} Confirma que lo recibiste y en qué cuenta.`,
      link: '/pendientes',
      receipt: { householdId: activeId, paymentId, amount, fromName: payerName, lines, date: date.toISOString(), ...(payer !== user.uid ? { registeredBy: myName } : {}) },
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

  // Live data for the active household: debts, crossings and expenses are listened to, so what any member does
  // (an abono, a new shared expense, a confirmation) shows on every other open screen by itself. Each stream is
  // independent, so a missing index on one never blocks the others.
  useEffect(() => {
    if (!activeId) return
    setDebtsLoading(true)
    const stops = [
      subscribeHouseholdDebts(activeId, (rows) => { setDebts(rows as any[]); setDebtsLoading(false) }, () => setDebtsLoading(false)),
      subscribeHouseholdCrossings(activeId, (rows) => setCrossings(rows as any[]), () => setCrossings([])),
      subscribeHouseholdExpenses(activeId, (rows) => { setExpenses(rows as any[]); backfillPendingContributors(rows) }, () => setExpenses([])),
    ]
    return () => stops.forEach((stop) => stop())
  }, [activeId])

  // The household documents too: someone joining, a guest added, a rename — no reload needed
  useEffect(() => {
    if (hhIds.length === 0) return
    return subscribeHouseholdDocs(hhIds, (id, data) => {
      setHouseholds((prev) => {
        if (!data) return prev.filter((h) => h.id !== id)
        return prev.some((h) => h.id === id) ? prev.map((h) => (h.id === id ? data : h)) : [...prev, data]
      })
    })
  }, [JSON.stringify(hhIds)])

  useEffect(() => { if (user) debtForm.setValue('debtor', user.uid) }, [user])

  // Nothing to reload by hand: the live listeners above hand over every change (also my own writes) as it happens.
  async function reloadDebts() { /* live */ }

  async function onAddDebt(data: DebtForm, extraLines: ExtraAbonoLine[] = [], mainTargetId?: string | null) {
    if (!user || !activeId) return
    setSaving(true)
    try {
      const effectiveTargetId = mainTargetId !== undefined ? mainTargetId : (saldaTargetId || selectedTargetDebtId)
      // everything this submit writes is ONE payment, even when it is split across several debts — or several
      // debtors, when this payment also covers someone else's share to the same creditor
      const paymentId = crypto.randomUUID()
      // a guest has no login and could never open the confirmation, so a debt paid to one is taken at face value
      const toConfirm = (c: string | null) => (c && c !== user.uid && !isGuest(c) ? 'pending' as const : null)
      const paidAt = new Date(data.date + 'T12:00:00')
      // who is paid and how it is split is decided by the shared planner (also used to confirm an abono prepared in Telegram)
      const plan = planAbono({
        debts, members, debtor: data.debtor, creditor: data.creditor || null, targetDebtId: effectiveTargetId,
        amount: data.amount, concept: data.concept, category: data.category,
      })

      // one picture for the whole payment, also readable by the other members (the person who receives it can check it)
      const attachmentId = abonoFile ? await saveAttachment(user.uid, abonoFile, members.filter((m) => m !== user.uid)) : undefined
      // every row of this payment (primary + extra lines) is collected first and written in ONE batch:
      // a failure halfway must never leave the payment half recorded
      const toWrite: Parameters<typeof addHouseholdDebtsBatch>[0] = []
      function queueRows(rows: typeof plan.rows, debtor: string) {
        for (const r of rows) {
          toWrite.push({
            householdId: activeId!,
            concept: r.concept,
            tipo: 'Abono',
            amount: r.amount,
            debtor,
            creditor: r.creditor,
            paymentId,
            accountId: data.accountId || null,
            receiptStatus: toConfirm(r.creditor),
            category: r.category,
            date: paidAt,
            registeredBy: user!.uid,
            estado: '',
            saldaId: r.saldaId,
            notas: data.notas ?? '',
            cruzado: false,
            ...(attachmentId ? { attachmentId } : {}),
          })
        }
      }
      queueRows(plan.rows, data.debtor)

      // each extra line is someone else's debt — to any creditor, not just this payment's own — settled right
      // away, no confirmation step; just tell them it happened
      const validExtras = extraLines.filter((l) => l.debtor && l.amount > 0)
      const extraPlans: { line: ExtraAbonoLine; plan: ReturnType<typeof planAbono> }[] = []
      for (const line of validExtras) {
        const linePlan = planAbono({
          debts, members, debtor: line.debtor, creditor: line.creditor, targetDebtId: line.targetDebtId ?? null,
          amount: line.amount, concept: data.concept, category: data.category,
        })
        queueRows(linePlan.rows, line.debtor)
        extraPlans.push({ line, plan: linePlan })
      }
      await addHouseholdDebtsBatch(toWrite)
      // the payer covered someone else's debt: that person is told who paid it for them (and who registered it, if not the payer)
      const payer = data.debtor
      const payerName = payer === user.uid ? myName : nameOf(payer)
      for (const { line } of extraPlans.filter((x) => x.line.debtor !== user.uid && x.line.debtor !== payer)) {
        notifyHouseholdMembers([line.debtor], {
          fromUid: user.uid, zone: 'hogar', severity: 'info',
          title: `${payerName} pagó tu deuda con ${nameOf(line.creditor)}`,
          body: `${formatCOP(line.amount)} quedaron cubiertos.${payer !== user.uid ? ` Lo registró ${myName}.` : ''}`, link: `/hogar?id=${activeId}`,
        }).catch(() => {})
      }

      // this whole submit is ONE paymentId, possibly touching several creditors (the primary's, plus whichever
      // extra lines went elsewhere) — each creditor is told once, for their own combined total, not once per
      // debtor who chipped in to what they're owed
      const byCreditor = new Map<string | null, { amount: number; lines: { concept: string; amount: number }[] }>()
      const addToCreditor = (to: string | null, amount: number, lines: { concept: string; amount: number }[]) => {
        const prev = byCreditor.get(to) ?? { amount: 0, lines: [] }
        byCreditor.set(to, { amount: prev.amount + amount, lines: [...prev.lines, ...lines] })
      }
      addToCreditor(plan.paidTo, data.amount, plan.paidLines)
      for (const { line, plan: linePlan } of extraPlans) addToCreditor(linePlan.paidTo, line.amount, linePlan.paidLines)
      for (const [to, merged] of byCreditor) tellPayment(to, merged.amount, merged.lines, paymentId, paidAt, payer)

      if (plan.kind === 'target') {
        if (plan.remainingAfter === 0) showToast(`¡Deuda "${plan.targetConcept}" 100% saldada!`, 'success')
        else showToast(`Abono de ${formatCOP(data.amount)} registrado. Saldo pendiente: ${formatCOP(plan.remainingAfter ?? 0)}`, 'success')
      } else if (plan.kind === 'allocated') {
        showToast(`Abono de ${formatCOP(data.amount)} distribuido en ${plan.allocations} deuda(s)`, 'success')
      } else {
        showToast(`Abono de ${formatCOP(data.amount)} registrado`, 'success')
      }
      const coveredOthers = validExtras.filter((l) => l.debtor !== user.uid)
      if (coveredOthers.length > 0) {
        showToast(`${payer === user.uid ? 'También cubriste' : `${payerName} también cubrió`} la deuda de ${coveredOthers.map((l) => nameOf(l.debtor)).join(', ')}`, 'success')
      }

      setAbonoFile(null)
      debtForm.reset({ date: format(new Date(), 'yyyy-MM-dd'), tipo: 'Abono', category: 'otros_hogar', debtor: user.uid, creditor: '', accountId: defaultAccountId })
      loadAccounts()
      setSaldaTargetId(null)
      setScopeIds(null)
      setPlanPays(null)
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
    if (fromFixed(d.expenseId)) return
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

  /** Opens a saved shared expense in the form to fix wrong values; only whoever registered it can (the old one is replaced). */
  /** A share that comes from a fixed expense's payment follows that payment: it is changed (or removed) there. */
  function fromFixed(expenseId: string | undefined) {
    const exp = expenseId ? expenses.find((e) => e.id === expenseId) : null
    if (!exp?.fixedLink) return false
    showToast(exp.fixedLink.userId === user?.uid
      ? 'Este gasto sale de uno de tus gastos fijos: corrígelo o bórralo desde su pago en Mi dinero'
      : `Este gasto sale de un gasto fijo de ${nameOf(exp.fixedLink.userId)}: lo maneja desde su pago`, 'info')
    return true
  }

  function handleEditExpense(expenseId: string) {
    if (fromFixed(expenseId)) return
    const exp = expenses.find((e) => e.id === expenseId)
    if (!exp) return
    if (exp.registeredBy !== user?.uid) {
      showToast(`Solo ${nameOf(exp.registeredBy as string)} puede corregir este gasto`, 'info')
      return
    }
    setEditingExpense(exp)
    setOpenExpense(true)
  }

  /** A shared expense with no debt yet can be removed whole: nothing has been registered against anyone. */
  async function handleDeleteExpense(expenseId: string, concept: string) {
    if (!activeId || fromFixed(expenseId)) return
    if (!(await ask(`¿Eliminar el gasto "${concept}"? Todavía no tiene movimientos: no se ha creado ninguna deuda.`, { title: 'Eliminar gasto compartido' }))) return
    try {
      await deleteHouseholdExpense(expenseId, activeId)
      await reloadDebts()
      showToast('Gasto eliminado', 'delete')
    } catch (err) {
      console.error('No se pudo eliminar el gasto:', err)
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

  // Putting a household away hides it from the main list and the dashboard for everyone; nothing is deleted.
  async function handleToggleArchive(id: string, archive: boolean) {
    if (!user) return
    const name = (households.find((h) => h.id === id)?.name as string) || 'este hogar'
    const ok = await ask(
      archive
        ? `¿Inactivar "${name}"? Sale de la lista principal y del inicio para todos sus integrantes. No se borra nada y se puede reactivar cuando quieras.`
        : `¿Reactivar "${name}"? Vuelve a la lista principal para todos sus integrantes.`,
      { title: archive ? 'Inactivar hogar' : 'Reactivar hogar', confirmLabel: archive ? 'Inactivar' : 'Reactivar' },
    )
    if (!ok) return
    try {
      await setHouseholdArchived(id, archive, user.uid)
      showToast(archive ? `"${name}" quedó inactivo` : `"${name}" está activo otra vez`, 'success')
    } catch {
      showToast('No se pudo cambiar el estado del hogar', 'error')
    }
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

  async function handleAddGuest(name: string) {
    if (!activeId) throw new Error('Elige un hogar primero')
    const { id: guestId } = await addGuestMember(activeId, name)
    // the live listener on the household may have brought the guest in already: never list them twice
    const withGuest = (ids: string[] | undefined) => [...new Set([...(ids ?? []), guestId])]
    setHouseholds((prev) => prev.map((h) => h.id === activeId ? {
      ...h,
      members:     withGuest(h.members as string[] | undefined),
      guestIds:    withGuest(h.guestIds as string[] | undefined),
      memberNames: { ...((h.memberNames as Record<string, string> | undefined) ?? {}), [guestId]: name },
    } : h))
    return { id: guestId, name }
  }

  async function handleRemoveGuest(guestId: string) {
    if (!activeId) return
    // someone out of the member list vanishes from the cards — so one with money still open, either way, can't leave
    const pos = positionOf(guestId)
    if (pos < 0) throw new Error(`${nameOf(guestId)} todavía debe ${formatCOP(-pos)}: que pague primero y luego lo quitas`)
    if (pos > 0) throw new Error(`A ${nameOf(guestId)} todavía le deben ${formatCOP(pos)}: que le paguen primero y luego lo quitas`)
    await removeGuestMember(activeId, guestId)
    setHouseholds((prev) => prev.map((h) => h.id === activeId ? {
      ...h,
      members:  ((h.members as string[] | undefined) ?? []).filter((id) => id !== guestId),
      guestIds: ((h.guestIds as string[] | undefined) ?? []).filter((id) => id !== guestId),
    } : h))
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
    } catch (e: any) { showToast(e?.message ?? 'Error al eliminar hogar', 'error') }
    finally { setSaving(false) }
  }

  function copyCode() {
    navigator.clipboard.writeText(household?.inviteCode as string ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleAbonar(d: any) {
    // each real member is responsible for their own abonos, from their own account — a guest has neither,
    // so any member can register one on their behalf
    if (d.debtor !== user?.uid && !isGuest(d.debtor)) {
      showToast(`Solo ${nameOf(d.debtor)} puede registrar sus abonos`, 'info')
      return
    }
    setSaldaTargetId(d.id)
    setScopeIds([d.id])
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

  /** A shared expense with several creditors: straight to the step-by-step payment, who gets paid is chosen there. */
  function handleAbonarGroup(edges: any[]) {
    const first = edges[0]
    if (!first) return
    if (first.debtor !== user?.uid && !isGuest(first.debtor)) {
      showToast(`Solo ${nameOf(first.debtor)} puede registrar sus abonos`, 'info')
      return
    }
    setSaldaTargetId(null)
    setScopeIds(edges.map((e) => e.id))
    setSelectedTargetDebtId(null)
    debtForm.reset({
      date: format(new Date(), 'yyyy-MM-dd'),
      tipo: 'Abono',
      concept: '',
      amount: 0,
      debtor: first.debtor,
      creditor: '',
      accountId: defaultAccountId,
      category: first.category || 'otros_hogar',
      notas: '',
    })
    setOpenDebt(true)
  }

  /** Registers what the report says a person has to pay: the form opens with every payment already filled in. */
  function handleRegisterPlan(uid: string) {
    const p = settlement.people.find((x) => x.uid === uid)
    if (!p || p.pays.length === 0) return
    if (uid !== user?.uid && !isGuest(uid)) {
      showToast(`Solo ${nameOf(uid)} puede registrar sus pagos`, 'info')
      return
    }
    setSaldaTargetId(null)
    setScopeIds(null)
    setSelectedTargetDebtId(null)
    setPlanPays(p.pays)
    debtForm.reset({
      date: format(new Date(), 'yyyy-MM-dd'),
      tipo: 'Abono',
      concept: 'Pago según el reporte',
      amount: 0,
      debtor: uid,
      creditor: '',
      accountId: defaultAccountId,
      category: 'otros_hogar',
      notas: '',
    })
    setOpenDebt(true)
  }

  function handleOpenAbonoGeneral(debtorUid?: string) {
    setSaldaTargetId(null)
    setScopeIds(null)
    setPlanPays(null)
    setSelectedTargetDebtId(null)
    const targetUid = debtorUid || user?.uid || ''
    // each real member is responsible for their own abonos, from their own account — a guest has neither,
    // so any member can register one on their behalf
    if (targetUid !== user?.uid && !isGuest(targetUid)) {
      showToast(`Solo ${nameOf(targetUid)} puede registrar sus abonos`, 'info')
      return
    }
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
  const guestIds     = (household?.guestIds as string[] | undefined) ?? []
  const isGuest      = (uid: string) => guestIds.includes(uid)
  const myName = myDisplayName || user?.displayName?.split(' ')[0] || 'Yo'
  const otherUids = othersOf(members, user?.uid)
  // legacy: a household that lost its member list still shows the person who has debts in it
  const partnerUid = otherUids[0] ?? (debts.find((d) => d.debtor !== user?.uid)?.debtor as string | null) ?? null
  const multi = members.length > 2
  // Validated for dark surfaces (dataviz skill, CVD-checked): the previous ad-hoc set failed the
  // dark lightness band on 5 of its 8 hues and collapsed under an all-pairs comparison.
  const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
  const colorOf = (uid: string) => PALETTE[Math.max(0, members.indexOf(uid)) % PALETTE.length]
  const firstNameOf = (uid: string) => memberNames[uid]?.split(' ')[0]
    || (uid.includes('@') ? uid.split('@')[0].replace(/\d+/g, '').replace(/^./, (c: string) => c.toUpperCase()) : 'Integrante')
  const nameOf = (uid?: string | null): string => !uid ? 'la otra persona' : uid === user?.uid ? myName : firstNameOf(uid)
  const photoOf = (uid: string): string | null => uid === user?.uid ? (user?.photoURL ?? null) : (memberPhotos[uid] ?? null)
  const partnerName = partnerUid ? nameOf(partnerUid) : 'Pareja'
  const myPhoto = user?.photoURL ?? null

  // What I still have to pay in this household (0 when I'm even or owed), all-time
  const myOwes  = Math.max(0, -positionOf(user?.uid))
  const myDebts = debts.filter((d: any) => d.debtor === user?.uid)

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
  /** Pending debts where uid is the one owed — otherwise invisible on their own card once they owe nobody themselves. */
  function owedTo(uid: string) {
    return debts.filter((d: any) => d.tipo === 'Deuda' && isPendingDebt(d) && creditorOf(d, members) === uid)
  }

  /** Debts of a shared expense that exist on paper but not yet: they wait for someone's confirmation of what they put in. Not counted in any balance. */
  function awaitingFor(uid: string) {
    const out: { id: string; concept: string; creditor: string; amount: number; waitingFor: string }[] = []
    for (const e of expenses as any[]) {
      for (const c of (e.contributions ?? []) as any[]) {
        if (c.status !== 'pending') continue
        for (const [i, edge] of ((c.edges ?? []) as any[]).entries()) {
          if (edge.created || edge.debtor !== uid) continue
          out.push({ id: `${e.id}-${c.memberId}-${i}`, concept: e.description, creditor: edge.creditor ?? c.memberId, amount: edge.amount, waitingFor: c.memberId })
        }
      }
    }
    return out
  }

  // Everything ever registered, and how much of it is covered — paid, crossed or compensated: the engine's figures
  const totalGen = balances.total
  const covered  = balances.total - balances.remaining
  const progress = totalGen > 0 ? Math.min(100, Math.floor((covered / totalGen) * 100)) : 0

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

  /** Removes a whole payment (every abono it was split into): the money goes back to the account and the debts are owed again. */
  async function handleDeletePayment(pay: any) {
    const kids = (pay.children ?? []) as any[]
    const ids = kids.map((k) => k.debt?.id as string | undefined).filter((x): x is string => !!x)
    if (ids.length === 0 || !activeId) return
    const registrant = kids[0]?.debt?.registeredBy as string | undefined
    const mine = registrant === user?.uid
    const touchesAccount = kids.some((k) => k.debt?.accountId)
    const received = kids.some((k) => k.debt?.receiptStatus === 'confirmed')
    const note = mine
      ? ' El dinero regresa a tu cuenta.'
      : touchesAccount && registrant ? ` Lo registró ${nameOf(registrant)}: se le avisará para que revise su cuenta.` : ''
    if (!(await ask(
      `¿Eliminar este pago de ${formatCOP(Math.abs(pay.delta))}? Las deudas que pagaba vuelven a quedar pendientes.${note}${received ? ' Quien lo recibió ya lo había confirmado: su ingreso no se revierte solo.' : ''}`,
      { title: 'Eliminar pago' },
    ))) return
    try {
      await deleteHouseholdPayment(ids, activeId)
      await reloadDebts()
      loadAccounts()
      showToast('Pago eliminado', 'delete')
    } catch (err) {
      console.error('No se pudo eliminar el pago:', err)
      showToast('Error al eliminar el pago', 'error')
    }
  }

  /** Opens the confirmation of a payment I received. */
  function openReceipt(pay: LedgerRow) {
    const kids = pay.children ?? []
    setReceiptToConfirm({
      householdId: activeId, paymentId: kids[0]?.debt?.paymentId, amount: Math.abs(pay.delta), fromName: nameOf(pay.debtor),
      lines: kids.map((k) => ({ concept: (k.target?.concept as string) ?? (k.debt?.concept as string), amount: Math.abs(k.delta) })),
      date: pay.date.toISOString(),
    })
  }

  function closeAbono() {
    setOpenDebt(false)
    setAbonoFile(null)
    setSaldaTargetId(null)
    setScopeIds(null)
    setPlanPays(null)
    setSelectedTargetDebtId(null)
  }

  // Full ledger since day one, one row per debt with its abonos/crossings inside. The timeline starts at the oldest
  // thing still open (or the last 30 days when everything is settled) and runs forward; what came before is one click away.
  const ledger = buildLedger(debts, crossings, user?.uid, partnerUid, members)
  const allRows = groupByExpense(nestByDebt(ledger.rows), expenses)
  const openFrom = allRows
    .filter((r) => r.kind === 'deuda' && ['overdue', 'due-soon', 'pending'].includes(statusOf(r)))
    .reduce((min, r) => Math.min(min, r.date.getTime()), Infinity)
  const startMs = Number.isFinite(openFrom) ? openFrom : Date.now() - 30 * 86_400_000
  // two views of the same history: what was created (shared expenses, loans, debts) and what was paid (payments, crossings)
  const isPaid = (r: { kind: string }) => r.kind === 'abono' || r.kind === 'cruce'
  const tabRows = allRows.filter((r) => (historyTab === 'pagos' ? isPaid(r) : !isPaid(r)))
  const gastosCount = allRows.filter((r) => !isPaid(r)).length
  const pagosCount = allRows.length - gastosCount
  const olderCount = tabRows.filter((r) => r.date.getTime() < startMs).length
  const monthRows = showPast ? tabRows : tabRows.filter((r) => r.date.getTime() >= startMs)

  // The payments tab is the same vertical timeline the Fijos history uses: one bordered row per payment, newest first
  const payRowById = new Map<string, LedgerRow>()
  const paymentMovements: Movement[] = historyTab !== 'pagos' ? [] : monthRows.map((r, i) => {
    const kids = r.children ?? []
    const id = r.key ?? (r.debt?.id as string | undefined) ?? `row-${i}`
    payRowById.set(id, r)
    if (r.kind === 'cruce') {
      return { id, zone: 'crossing' as const, date: r.date, concept: r.concept, sub: 'Compensación entre deudas', amount: Math.abs(r.delta), neutral: true, canDelete: false }
    }
    const creditor = kids[0]?.debt ? (creditorOf(kids[0].debt, members) ?? undefined) : undefined
    const receipt = kids.every((k) => k.debt?.receiptStatus === 'confirmed') ? 'recibido ✓' : kids.some((k) => k.debt?.receiptStatus === 'pending') ? `por confirmar${creditor ? ` por ${creditor === user?.uid ? 'ti' : nameOf(creditor)}` : ''}` : ''
    const iReceive = kids.some((k) => k.debt?.receiptStatus === 'pending') && creditor === user?.uid
    // what the payment was for: the debts it was tied to, and the part tied to none — which counts in full all the same
    const tiedTo = [...new Set(kids.filter((k) => k.target).map((k) => k.target!.concept as string))]
    const untied = kids.filter((k) => !k.debt?.saldaId).reduce((t, k) => t + Math.abs(k.delta), 0)
    const purpose = [
      tiedTo.length > 0 ? `Para: ${tiedTo.join(', ')}` : '',
      untied > 0 ? (tiedTo.length > 0 ? `${formatCOP(untied)} sin deuda específica` : 'Sin deuda específica: cuenta completo en su saldo') : '',
    ].filter(Boolean).join(' · ')
    return {
      id,
      zone: 'payment' as const,
      date: r.date,
      concept: `${nameOf(r.debtor)} le pagó a ${creditor ? nameOf(creditor) : 'alguien'}`,
      sub: [purpose, receipt].filter(Boolean).join(' · '),
      // from my side: money that comes to me is "+", money I pay is "−", and a payment between other people is neither
      amount: creditor === user?.uid ? Math.abs(r.delta) : -Math.abs(r.delta),
      neutral: creditor !== user?.uid && r.debtor !== user?.uid,
      accountId: kids[0]?.debt?.accountId as string | undefined,
      attachmentId: (r.debt?.attachmentId ?? kids.find((k) => k.debt?.attachmentId)?.debt?.attachmentId) as string | undefined,
      action: iReceive ? (
        <button type="button" onClick={() => openReceipt(r)} className="whitespace-nowrap rounded-md border border-emerald-400/50 bg-emerald-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/25 transition">Confirmar recibido</button>
      ) : undefined,
    }
  })
  const carryIn: number | null = null
  const carryOwed = 0

  // the same settlement the report shows (what really has to move once debts and credits are set against each other)
  const settlement = useMemo(
    () => buildHouseholdReport({ name: (household?.name as string) ?? '', members, guestIds, nameOf, expenses, debts, frozenPlan: (household?.settlementPlan as FrozenPlan | undefined) ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household, expenses, debts],
  )

  // Once the household crosses its accounts, debts stop being paid one by one: only the plan is paid
  const frozenPlan = (household?.settlementPlan as FrozenPlan | undefined) ?? null
  const crossed = !!frozenPlan || household?.payMode === 'plan'
  // the crossing can be undone only while nobody has paid since: after that the two ways would mix
  const canUncross = crossed && !!frozenPlan && !debts.some((d: any) => d.tipo === 'Abono' && toDate(d.createdAt ?? d.date).getTime() >= frozenPlan.atMs)
  const myPlanPays = (settlement.people.find((p) => p.uid === user?.uid)?.pays.length ?? 0) > 0

  async function handleCrossAccounts() {
    if (!activeId || settlement.plan.length === 0) return
    const ok = await ask(
      `Se compensa todo entre todos y quedan ${settlement.plan.length} pagos por ${formatCOP(settlement.toMove)}. Desde ahora ya no se pagan deudas sueltas: cada quien paga solo lo que dice el plan. Si alguien agrega o corrige un gasto, el plan se ajusta solo.`,
      { title: 'Cruzar cuentas' },
    )
    if (!ok) return
    try {
      await setSettlementPlan(activeId, { atMs: Date.now(), payments: settlement.plan.map((p) => ({ from: p.from, to: p.to, amount: p.amount })) })
      showToast('Cuentas cruzadas: ahora se paga según el plan', 'success')
    } catch {
      showToast('No se pudieron cruzar las cuentas', 'error')
    }
  }

  async function handleUncross() {
    if (!activeId) return
    if (!(await ask('Las deudas vuelven a pagarse una por una, a quien se le deba cada una.', { title: 'Deshacer cruce' }))) return
    try {
      await uncrossHousehold(activeId)
      showToast('Cruce deshecho', 'success')
    } catch {
      showToast('No se pudo deshacer el cruce', 'error')
    }
  }

  // an abono is paid by the person who registers it, or — since they can't log in and do it themselves —
  // by any guest of the household, registered on their behalf
  const debtorOptions = [
    { value: user?.uid ?? '', label: myName },
    ...guestIds.map((uid) => ({ value: uid, label: nameOf(uid) })),
  ]

  const expenseMembers = [
    { uid: user?.uid ?? '', name: myName, photoURL: myPhoto, color: colorOf(user?.uid ?? '') },
    ...otherUids.map((uid) => ({ uid, name: nameOf(uid), photoURL: photoOf(uid), color: colorOf(uid) })),
  ]
  const people = [user?.uid ?? '', ...otherUids]

  // Contributions someone else declared on my behalf in a shared expense, still waiting for my OK
  const myPendingContributions = expenses.flatMap((e: any) => {
    const c = ((e.contributions as any[] | undefined) ?? []).find((x) => x.memberId === user?.uid && x.status === 'pending')
    return c ? [{ expenseId: e.id, memberId: c.memberId, description: e.description, amount: c.amount, registeredByName: nameOf(e.registeredBy) }] : []
  })

  if (loading) {
    return (
      <div className="flex flex-col gap-5 lg:flex-row fade-in">
        <div className="h-64 lg:w-[32%] rounded-3xl skeleton" />
        <div className="h-64 lg:flex-1 rounded-3xl skeleton" />
      </div>
    )
  }

  /** The household's name and way back to the list. `vt`: the copy that carries the view transition (only one may). */
  const headerOf = (vt: boolean) => household && (
    <div style={vt ? ({ viewTransitionName: `vt-household-${activeId}` } as React.CSSProperties) : undefined}>
      <button
        onClick={() => withTransition(() => setActiveId(null))}
        className="flex items-center gap-1.5 text-xs font-semibold text-[#9aa4ac] hover:text-white transition mb-2"
      >
        <ArrowLeft size={13} /> Hogares
      </button>
      {household.archivedAt && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-[#c7ccd1]">
          <span>Este hogar está inactivo: no aparece en la lista principal ni en el inicio.</span>
          <button type="button" onClick={() => handleToggleArchive(activeId as string, false)} className="font-semibold text-brand-300 hover:text-brand-200 whitespace-nowrap">Reactivar</button>
        </div>
      )}
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mb-1 notch-sm bg-white/[0.04] border border-white/[0.08]">
        <Home size={11} className="text-brand-400" />
        <span className="font-pixel text-[8px] text-brand-400 uppercase tracking-widest">Hogar</span>
      </div>
      <h1 className="text-2xl font-bold tracking-tight break-words">{household.name as string}</h1>
      <p className="hidden lg:block text-xs text-[#9aa4ac] mt-1">Cuentas compartidas: gastos que se dividen, abonos y cruces entre ustedes.</p>
    </div>
  )

  /** Report and the household menu. `compact`: icon only (the phone header has little room). */
  const toolsOf = (compact: boolean) => household && (
    <>
      <button
        type="button"
        onClick={() => setOpenReport(true)}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0d263a] px-3 py-2 text-xs font-semibold text-[#c7ccd1] transition hover:bg-white/10 hover:text-white"
        title="Cuánto debe cada persona"
        aria-label="Reporte"
      >
        <ClipboardList size={15} />{!compact && ' Reporte'}
      </button>
      <HouseholdMenu
        inviteCode={household.inviteCode as string}
        copied={copied}
        onSettings={() => { setRenameVal(household.name as string); setOpenSettings(true) }}
        onReport={() => setOpenReport(true)}
        onInvite={() => setOpenInvite(true)}
        onAddGuest={() => setOpenAddGuest(true)}
        onCopyCode={copyCode}
        onSwitch={() => withTransition(() => setActiveId(null))}
        onCreate={() => setOpenCreate(true)}
        onJoin={() => setOpenJoin(true)}
      />
    </>
  )

  const actions = household && (
    <div className="flex gap-2 flex-wrap">
      <Button onClick={() => setOpenExpense(true)} notched className="flex-1 min-w-[150px] max-lg:min-w-[30%] max-lg:px-2">
        <ShoppingBag size={15} /> <span className="max-lg:hidden">Gasto compartido</span><span className="lg:hidden">Gasto</span>
      </Button>
      {people.length > 1 && (
        <Button onClick={() => setOpenLoan(true)} variant="secondary" notched className="flex-1 min-w-[150px] max-lg:min-w-[30%] max-lg:px-2" title="Registrar un préstamo entre ustedes: quién prestó, a quién y cómo se paga">
          <HandCoins size={15} className="text-amber-300" /> Préstamo
        </Button>
      )}
      <Button
        onClick={() => (crossed ? handleRegisterPlan(user?.uid ?? '') : handleOpenAbonoGeneral(user?.uid))}
        disabled={crossed ? !myPlanPays : myOwes <= 0}
        variant="secondary"
        notched
        className="flex-1 min-w-[150px] max-lg:min-w-[30%] max-lg:px-2"
        title={crossed
          ? (myPlanPays ? 'Registrar tus pagos según el plan' : 'Según el plan no tienes pagos pendientes')
          : (myOwes > 0 ? 'Abonar a tus deudas del hogar' : 'Cuentas al día: no tienes nada que abonar')}
      >
        <Coins size={15} className="text-brand-400" /> Abonar
      </Button>
    </div>
  )


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
            onToggleArchive={handleToggleArchive}
          />
        </CurvedScrollContainer>
      )}

      {household && (
        <>
          {/* Left pane: who owes whom, the actions, and each person. On phones it gives way to the debt detail. */}
          {/* Phones: the household's header and actions stay compact on top, and a sticky bar switches between sections */}
          <div className={clsx('lg:hidden space-y-3 p-4', framed)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">{headerOf(false)}</div>
              <div className="flex flex-shrink-0 items-center gap-1.5">{toolsOf(true)}</div>
            </div>
            {actions}
          </div>
          <MobileSectionBar
            label="Secciones del hogar"
            anchor={sections.anchor}
            active={selectedDebt ? null : mobileView}
            onOpen={openSection}
            sections={[
              { id: 'personas', label: 'Personas', Icon: Users, badge: people.length },
              { id: 'gastos', label: 'Gastos', Icon: ShoppingBag, badge: gastosCount },
              { id: 'pagos', label: 'Pagos', Icon: Coins, badge: pagosCount },
              { id: 'mapa', label: 'Mapa', Icon: Network },
            ]}
          />

          <CurvedScrollContainer
            className={clsx('lg:w-[32%] lg:min-w-[340px] lg:max-w-[560px] lg:flex-shrink-0 lg:min-h-0', framed, (selectedDebt || mobileView !== 'personas') && 'max-lg:hidden', leftCollapsed && 'lg:hidden')}
            {...scrollProps}
          >
            <div className="max-lg:hidden space-y-5">
              {headerOf(true)}
              {actions}
            </div>

            {debtsLoading ? (
              <SkeletonList count={3} />
            ) : (
              <>
                <PendingContributionsCard items={myPendingContributions} accounts={accounts} onDone={() => { reloadDebts(); loadAccounts() }} />

                {people.length <= 1 && (
                  <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3">
                    <p className="text-sm text-[#f0fae8]">Ningún co-titular unido aún.</p>
                    <p className="text-xs text-brand-300 font-mono mt-1">Código: {household.inviteCode as string}</p>
                  </div>
                )}

                <div className="notch bg-[#0a1f2f] border border-white/10 shadow-xl divide-y divide-white/10 overflow-clip">
                  <PersonCard
                    bare
                    name={myName}
                    role="Responsable asignado"
                    photoURL={myPhoto}
                    color={colorOf(user?.uid ?? '')}
                    position={positionOf(user?.uid)}
                    settle={settlement.people.find((p) => p.uid === user?.uid)}
                    onRegisterPlan={() => handleRegisterPlan(user?.uid ?? '')}
                    planMode={crossed}
                    debts={myDebts}
                    canCross={(d) => counterpartPendingDebts(d).length > 0}
                    creditorName={multi ? (d) => { const c = creditorOf(d, members); return c ? nameOf(c) : null } : undefined}
                    creditorUid={(d) => creditorOf(d, members)}
                    colorOf={colorOf}
                    photoOf={photoOf}
                    expanded={Boolean(expandedPeople[user?.uid ?? ''])}
                    onToggle={() => setExpandedPeople((prev) => ({ [user?.uid ?? '']: !prev[user?.uid ?? ''] }))}
                    canAbonar
                    onAbonarAll={() => handleOpenAbonoGeneral(user?.uid)}
                    onCross={(d) => setCrossTarget(d)}
                    onAbonar={handleAbonar}
                    onAbonarGroup={handleAbonarGroup}
                    onSelect={(d) => withTransition(() => setSelectedDebt(d))}
                    owedToMe={owedTo(user?.uid ?? '')}
                    awaiting={awaitingFor(user?.uid ?? '')}
                    nameOf={nameOf}
                  />
                  {otherUids.map((uid) => (
                    <PersonCard
                      bare
                      key={uid}
                      name={nameOf(uid)}
                      role={isGuest(uid) ? 'Sin cuenta en la app' : multi ? 'Integrante del hogar' : 'Co-titular hogar'}
                      isGuest={isGuest(uid)}
                      photoURL={photoOf(uid)}
                      color={colorOf(uid)}
                      position={positionOf(uid)}
                      settle={settlement.people.find((p) => p.uid === uid)}
                      onRegisterPlan={() => handleRegisterPlan(uid)}
                      planMode={crossed}
                      debts={debts.filter((d: any) => d.debtor === uid)}
                      canCross={(d) => counterpartPendingDebts(d).length > 0}
                      creditorName={multi ? (d) => { const c = creditorOf(d, members); return c ? nameOf(c) : null } : undefined}
                      creditorUid={(d) => creditorOf(d, members)}
                      colorOf={colorOf}
                      photoOf={photoOf}
                      expanded={Boolean(expandedPeople[uid])}
                      onToggle={() => setExpandedPeople((prev) => ({ [uid]: !prev[uid] }))}
                      canAbonar={isGuest(uid)}
                      onAbonarAll={() => handleOpenAbonoGeneral(uid)}
                      onCross={(d) => setCrossTarget(d)}
                      onAbonar={handleAbonar}
                    onAbonarGroup={handleAbonarGroup}
                      onSelect={(d) => withTransition(() => setSelectedDebt(d))}
                      owedToMe={owedTo(uid)}
                      awaiting={awaitingFor(uid)}
                      nameOf={nameOf}
                    />
                  ))}
                </div>
              </>
            )}
          </CurvedScrollContainer>

          {/* Right pane: fixed header (month, view, menu) and one card with summary on top, history below */}
          <div className={clsx('min-w-0 flex flex-col gap-5 lg:flex-1 lg:min-h-0', mobileView === 'personas' && !selectedDebt && 'max-lg:hidden')}>
            <div className="max-lg:hidden flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
              {!selectedDebt ? (
                <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">
                  Historial del hogar
                </p>
              ) : (
                <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">
                  Detalle de deuda
                </p>
              )}

              <div className="flex items-center gap-2">{toolsOf(false)}</div>
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
                    canAbonar={selectedDebt.debtor === user?.uid || isGuest(selectedDebt.debtor as string)}
                    canCross={counterpartPendingDebts(selectedDebt).length > 0}
                    planMode={crossed}
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
                          Actividad total del hogar
                          <Tip text="Todo lo que se ha registrado alguna vez, en bruto, antes de restar abonos o cruces — distinto del Balance del hogar, que ya muestra lo pendiente hoy." />
                        </p>
                        <p className="text-2xl font-bold font-mono tabular-nums text-brand-300">{formatCOP(totalGen)}</p>
                      </div>
                      <span className="text-xs font-mono text-[#8a929a]">{monthRows.length} {monthRows.length === 1 ? 'movimiento' : 'movimientos'}</span>
                    </div>
                    {totalGen > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px]">
                          <span className="text-[#9aa4ac] flex items-center gap-1.5">
                            {formatCOP(covered)} cubierto ({progress}%)
                            <Tip text="De todo lo generado: lo ya pagado, cruzado o compensado (lo que alguien debe se descuenta de lo que le deben)." />
                          </span>
                          <span className="text-right">
                            <button type="button" onClick={() => setOpenReport(true)} className="inline-flex items-center gap-1 font-mono font-bold text-amber-300 hover:underline" title="Ver el reporte de cuentas">
                              {formatCOP(settlement.toMove)} por pagar entre todos
                            </button>
                            <Tip text="Es lo que realmente tiene que cambiar de manos para que todos queden a mano. Ya descuenta lo que unos se deben con otros. El detalle de cada deuda está en la tarjeta de cada persona." />
                          </span>
                        </div>
                        <ProgressBar value={progress} size="sm" />
                      </div>
                    )}
                  </div>

                  <div className="max-lg:hidden flex-shrink-0 flex items-center gap-1.5 border-b border-white/10 px-5 py-2" role="tablist" aria-label="Vista del historial">
                    {([['gastos', 'Gastos compartidos', gastosCount], ['pagos', 'Pagos', pagosCount], ['mapa', 'Mapa de pagos', null]] as const).map(([id, label, n]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={historyTab === id}
                        onClick={() => setHistoryTab(id)}
                        className={clsx(
                          'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                          historyTab === id ? 'bg-brand-500/20 text-brand-300 border border-brand-500/40' : 'text-[#9aa4ac] border border-transparent hover:bg-white/5 hover:text-[#f3f5f6]',
                        )}
                      >
                        {label}
                        {id === 'mapa' ? <Network size={12} className="opacity-70" /> : <span className="font-mono text-[10px] opacity-70">{n}</span>}
                      </button>
                    ))}
                  </div>

                  <CurvedScrollContainer className="lg:flex-1 lg:min-h-0" {...scrollProps} corners="bottom-right">
                    {historyTab === 'mapa' ? (
                      debtsLoading ? <SkeletonList count={4} /> : <PaymentMap report={settlement} debts={debts} members={members} nameOf={nameOf} photoOf={photoOf} colorOf={colorOf} />
                    ) : debtsLoading ? (
                      <SkeletonList count={4} />
                    ) : monthRows.length === 0 && !carryIn ? (
                      <div className="text-center py-12 px-6">
                        <EmptyMark name="housing" />
                        <p className="text-sm font-bold text-[#f0fae8]">{historyTab === 'pagos' ? 'Aún no hay pagos' : 'Aún no hay gastos compartidos'}</p>
                        <p className="text-xs text-[#8a929a] mt-1">{historyTab === 'pagos' ? 'Los abonos y cruces aparecerán aquí.' : 'Presiona "Gasto compartido" para registrar uno.'}</p>
                      </div>
                    ) : historyTab === 'pagos' ? (
                      <>
                        <MovementTimeline
                          items={paymentMovements}
                          accounts={accounts}
                          onDelete={(m) => { const row = payRowById.get(m.id); if (row && row.kind === 'abono') handleDeletePayment(row) }}
                        />
                        {olderCount > 0 && (
                          <div className="flex justify-center pt-3">
                            <Button type="button" variant="secondary" size="sm" notched onClick={() => setShowPast((v) => !v)}>
                              {showPast ? 'Ocultar los anteriores' : `Cargar anteriores (${olderCount})`}
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <HouseholdTimeline
                        rows={monthRows}
                        carryIn={carryIn}
                        carryOwed={carryOwed}
                        olderCount={olderCount}
                        showingOlder={showPast}
                        onToggleOlder={() => setShowPast((v) => !v)}
                        onDeleteExpense={handleDeleteExpense}
                        onEditExpense={handleEditExpense}
                        onDeletePayment={handleDeletePayment}
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
          canDelete={household?.createdBy === user?.uid}
        />
      )}

      {household && (
        <InviteModal
          open={openInvite}
          onClose={() => setOpenInvite(false)}
          householdId={household.id as string}
          householdName={household.name as string}
          inviteCode={household.inviteCode as string}
        />
      )}

      {household && (
        <AddGuestModal
          open={openAddGuest}
          onClose={() => setOpenAddGuest(false)}
          guests={guestIds.map((uid) => ({ id: uid, name: nameOf(uid) }))}
          onAdd={handleAddGuest}
          onRemove={handleRemoveGuest}
        />
      )}

      {household && (
        <HouseholdReportModal
          open={openReport}
          onClose={() => setOpenReport(false)}
          name={household.name as string}
          members={members}
          guestIds={guestIds}
          nameOf={nameOf}
          photoOf={photoOf}
          colorOf={colorOf}
          expenses={expenses}
          debts={debts}
          frozenPlan={(household.settlementPlan as FrozenPlan | undefined) ?? null}
          crossed={crossed}
          onCross={crossed ? undefined : handleCrossAccounts}
          onUncross={canUncross ? handleUncross : undefined}
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
        currentUserId={user?.uid ?? ''}
        open={openDebt}
        onClose={closeAbono}
        form={debtForm}
        onSubmit={onAddDebt}
        debts={debts}
        scopeIds={scopeIds}
        planPays={planPays}
        planActive={crossed}
        selectedTargetDebtId={selectedTargetDebtId}
        onPickTarget={setSelectedTargetDebtId}
        members={members}
        guestIds={guestIds}
        colorOf={colorOf}
        photoOf={photoOf}
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
          guestIds={guestIds}
          currentUserUid={user?.uid ?? ''}
          onCreated={reloadDebts}
        />
      )}

      {activeId && (
        <HouseholdExpenseModal
          open={openExpense}
          editing={editingExpense}
          onClose={() => { setOpenExpense(false); setEditingExpense(null) }}
          householdId={activeId}
          members={expenseMembers}
          guestIds={guestIds}
          currentUserUid={user?.uid ?? ''}
          accounts={accounts}
          onCreated={() => { reloadDebts(); loadAccounts() }}
          onAddGuest={handleAddGuest}
        />
      )}
    </div>
  )
}
