import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Copy, Users, LogIn, PlusCircle, ChevronDown, ChevronLeft, Settings, Trash2, Pencil, GitMerge, TrendingUp, ChevronRight, ArrowLeft, Info } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useDisplayName } from '@/hooks/useDisplayName'
import {
  createHousehold, joinHousehold, getHouseholds,
  addHouseholdDebt, getHouseholdDebts, deleteHouseholdDebt,
  calcNetBalance, renameHousehold, deleteHousehold, getHouseholdIds,
  addHouseholdCrossing, getHouseholdCrossings,
} from '@/lib/firestore'
import { formatCOP, HOUSEHOLD_DEBT_CATEGORIES } from '@/shared'
import { clsx } from 'clsx'

const CAT_OPTIONS = HOUSEHOLD_DEBT_CATEGORIES.map((c) => ({
  value: c.id,
  label: `${c.icon} ${c.label}`,
}))
const TIPO_OPTIONS = [
  { value: 'Deuda', label: '💸 Deuda' },
  { value: 'Abono', label: '✅ Abono' },
]

const debtSchema = z.object({
  concept:  z.string().min(1, 'Concepto requerido'),
  tipo:     z.enum(['Deuda', 'Abono']),
  amount:   z.coerce.number().positive('Monto mayor a 0'),
  debtor:   z.string().min(1),
  category: z.string().min(1),
  date:     z.string().min(1),
  notas:    z.string().optional(),
})
const householdSchema = z.object({ name: z.string().min(1, 'Ingresa un nombre') })
const joinSchema      = z.object({ code: z.string().min(6).max(6) })

type DebtForm = z.infer<typeof debtSchema>
type HHForm   = z.infer<typeof householdSchema>
type JoinForm = z.infer<typeof joinSchema>

export default function HouseholdPage() {
  const { user, profile }     = useAuth()
  const setProfile             = useAuthStore((s) => s.setProfile)
  const myDisplayName          = useDisplayName()
  const { showToast }          = useToast()

  const [households, setHouseholds]   = useState<any[]>([])
  const [activeId, setActiveId]       = useState<string | null>(null)
  const [debts, setDebts]             = useState<any[]>([])
  const [loading, setLoading]         = useState(true)
  const [debtsLoading, setDebtsLoading] = useState(false)

  const [crossings, setCrossings]     = useState<any[]>([])
  const [openDebt, setOpenDebt]       = useState(false)
  const [openCreate, setOpenCreate]   = useState(false)
  const [openJoin, setOpenJoin]       = useState(false)
  const [openSettings, setOpenSettings] = useState(false)
  const [crossTarget, setCrossTarget]     = useState<any | null>(null)
  const [saving, setSaving]               = useState(false)
  const [copied, setCopied]               = useState(false)
  const [renameVal, setRenameVal]         = useState('')
  const [myExpanded, setMyExpanded]       = useState(false)
  const [partnerExpanded, setPartnerExpanded] = useState(false)
  const [selectedDebt, setSelectedDebt]   = useState<any | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d })
  const [hhMenuOpen, setHhMenuOpen]       = useState(false)
  const hhMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hhMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (hhMenuRef.current && !hhMenuRef.current.contains(e.target as Node)) setHhMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [hhMenuOpen])

  function shiftMonth(delta: number) {
    setSelectedMonth((prev) => { const d = new Date(prev); d.setMonth(d.getMonth() + delta); return d })
  }
  const now = new Date()
  const isCurrentMonth = selectedMonth.getFullYear() === now.getFullYear() && selectedMonth.getMonth() === now.getMonth()

  const hhIds    = getHouseholdIds(profile as any)
  const household = households.find((h) => h.id === activeId) ?? null

  const debtForm = useForm<DebtForm>({
    resolver: zodResolver(debtSchema),
    defaultValues: { date: format(new Date(), 'yyyy-MM-dd'), tipo: 'Deuda', category: 'otros_hogar', debtor: user?.uid ?? '' },
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
        if (hhs.length > 0 && !activeId) setActiveId(hhs[0].id as string)
      } catch (err) {
        console.error('Error cargando hogares:', err)
        showToast('No se pudieron cargar los hogares', 'error')
      } finally {
        setLoading(false)
      }
    }
    loadHouseholds()
  }, [user, JSON.stringify(hhIds)])

  // Load debts + crossings when active household changes
  useEffect(() => {
    if (!activeId) return
    setDebtsLoading(true)
    // Load debts first — always show them even if crossings fail
    getHouseholdDebts(activeId)
      .then((d) => {
        setDebts(d as any[])
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
    setDebts(d as any[])
    getHouseholdCrossings(activeId).then(c => setCrossings(c as any[])).catch(() => {})
  }

  async function onAddDebt(data: DebtForm) {
    if (!user || !activeId) return
    setSaving(true)
    try {
      await addHouseholdDebt({
        householdId: activeId, concept: data.concept, tipo: data.tipo,
        amount: data.amount, debtor: data.debtor, category: data.category,
        date: new Date(data.date + 'T12:00:00'), registeredBy: user.uid,
        estado: '', saldaId: null, notas: data.notas ?? '', cruzado: false,
      })
      debtForm.reset({ date: format(new Date(), 'yyyy-MM-dd'), tipo: 'Deuda', category: 'otros_hogar', debtor: user.uid })
      setOpenDebt(false)
      await reloadDebts()
      showToast(data.tipo === 'Deuda' ? 'Deuda registrada' : 'Abono registrado', 'success')
    } catch { showToast('Error al registrar', 'error') }
    finally { setSaving(false) }
  }

  async function onCreateHousehold(data: HHForm) {
    if (!user) return
    setSaving(true)
    let id: string
    try {
      id = (await createHousehold(user.uid, data.name, myDisplayName)).id
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
      id = (await joinHousehold(user.uid, data.code, myDisplayName)).id
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

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este registro?')) return
    await deleteHouseholdDebt(id)
    setDebts((prev) => prev.filter((d) => d.id !== id))
    showToast('Registro eliminado', 'info')
  }

  async function handleCreateCrossing(
    counterDebt: any | null,
    counterPersonId: string,
    amount: number,
    notes: string,
  ) {
    if (!user || !activeId || !crossTarget) return
    setSaving(true)
    try {
      await addHouseholdCrossing({
        householdId:  activeId,
        debt1Id:      crossTarget.id,
        debt2Id:      counterDebt?.id ?? null,
        debt2PersonId: counterPersonId,
        amount,
        initiatedBy:  user.uid,
        notes,
      })
      setCrossTarget(null)
      await reloadDebts()
      showToast('Cruce registrado', 'success')
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
      showToast('Hogar renombrado', 'success')
    } catch { showToast('Error al renombrar', 'error') }
    finally { setSaving(false) }
  }

  async function handleDeleteHousehold() {
    if (!user || !activeId) return
    if (!confirm('¿Eliminar el hogar? Esto borrará TODOS los registros de deudas compartidas y no se puede deshacer.')) return
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
      showToast('Hogar eliminado', 'info')
    } catch { showToast('Error al eliminar hogar', 'error') }
    finally { setSaving(false) }
  }

  function copyCode() {
    navigator.clipboard.writeText(household?.inviteCode as string ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleSaldar(d: any) {
    const remaining = d.amount - ((d.crossedAmount as number) || 0)
    debtForm.reset({
      date: format(new Date(), 'yyyy-MM-dd'),
      tipo: 'Abono',
      concept: d.concept,
      amount: remaining,
      debtor: d.debtor,
      category: d.category,
      notas: `Saldo de: ${d.concept}`,
    })
    setOpenDebt(true)
  }

  // Names
  const members     = (household?.members as string[] | undefined) ?? []
  const memberNames = (household?.memberNames as Record<string, string> | undefined) ?? {}
  const partnerUid  = members.find((m: string) => m !== user?.uid)
    ?? (debts.find((d) => d.debtor !== user?.uid)?.debtor as string | null)
    ?? null

  const myName = myDisplayName || user?.displayName?.split(' ')[0] || 'Yo'
  const partnerName = partnerUid
    ? (memberNames[partnerUid]?.split(' ')[0]
        || (partnerUid.includes('@') ? partnerUid.split('@')[0].replace(/\d+/g, '').replace(/^./, (c: string) => c.toUpperCase()) : 'Pareja'))
    : 'Pareja'

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

  // "This cycle" reporting — new activity generated within the selected month only.
  const totalGen     = monthDebts.filter(d => d.tipo === 'Deuda').reduce((s: number, d: any) => s + d.amount, 0)
  const totalCruzado = monthDebts.filter(d => d.tipo === 'Deuda').reduce((s: number, d: any) => s + ((d.crossedAmount as number) || 0), 0)
  const totalAbono   = monthDebts.filter(d => d.tipo === 'Abono').reduce((s: number, d: any) => s + d.amount, 0)
  const pendiente    = totalGen - totalCruzado - totalAbono
  const progress     = totalGen > 0 ? Math.min(100, Math.round(((totalCruzado + totalAbono) / totalGen) * 100)) : 0
  const myMonthGen      = monthDebts.filter((d: any) => d.tipo === 'Deuda' && d.debtor === user?.uid).reduce((s: number, d: any) => s + d.amount, 0)
  const partnerMonthGen = partnerUid ? monthDebts.filter((d: any) => d.tipo === 'Deuda' && d.debtor === partnerUid).reduce((s: number, d: any) => s + d.amount, 0) : 0

  // Full step-by-step breakdown of each person's all-time balance, so "Carlos debe
  // $281.000" is never a black box — the UI always shows: deudas − abonos − cruzado.
  function balanceBreakdown(uid: string | undefined) {
    if (!uid) return { deuda: 0, abono: 0, cruzado: 0, saldo: 0 }
    const ownDebts = debts.filter((d: any) => d.debtor === uid)
    const deuda   = ownDebts.filter((d: any) => d.tipo === 'Deuda').reduce((s: number, d: any) => s + d.amount, 0)
    const abono   = ownDebts.filter((d: any) => d.tipo === 'Abono').reduce((s: number, d: any) => s + d.amount, 0)
    const crossedOwn    = ownDebts.filter((d: any) => d.tipo === 'Deuda').reduce((s: number, d: any) => s + ((d.crossedAmount as number) || 0), 0)
    const crossedInFavor = crossings.filter((c: any) => c.debt2PersonId === uid && !c.debt2Id).reduce((s: number, c: any) => s + (c.amount as number), 0)
    const cruzado = crossedOwn + crossedInFavor
    return { deuda, abono, cruzado, saldo: deuda - abono - cruzado }
  }
  const myBreakdown      = balanceBreakdown(user?.uid)
  const partnerBreakdown = balanceBreakdown(partnerUid ?? undefined)

  // Debt ledger for the selected month — a bank-statement style view: what was
  // inherited (not settled) from the previous month, each movement that happened
  // THIS month in order, and the resulting balance after each one. Uses the same
  // per-person-then-diff math as the "¿Quién debe más?" bar, event-sourced so it
  // never depends on the mutable crossedAmount snapshot.
  // Full timeline, not scoped to the toolbar's month — every movement from day
  // one, attributed to whoever it belongs to, with each person's own running
  // total tracked separately (not just the combined diff) so you can see how
  // each person's balance moved over time.
  const fullLedger = (() => {
    type Ev = { date: Date; debtor: string; delta: number; concept: string; kind: 'deuda' | 'abono' | 'cruce' }
    const events: Ev[] = []
    for (const d of debts) {
      const dt = d.date instanceof Date ? d.date : new Date(d.date)
      events.push({
        date: dt, debtor: d.debtor as string, concept: d.concept as string,
        delta: d.tipo === 'Deuda' ? (d.amount as number) : -(d.amount as number),
        kind: d.tipo === 'Deuda' ? 'deuda' : 'abono',
      })
    }
    for (const c of crossings) {
      // A crossing reduces what debt1's debtor owes, same effect as an abono.
      const debt1 = debts.find((d: any) => d.id === c.debt1Id)
      if (!debt1) continue
      const dt = c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt)
      events.push({ date: dt, debtor: debt1.debtor as string, concept: debt1.concept as string, delta: -(c.amount as number), kind: 'cruce' })
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime())

    let runningMe = 0
    let runningPartner = 0
    const rows = events.map((ev) => {
      const isMe = ev.debtor === user?.uid
      if (isMe) runningMe += ev.delta
      else if (partnerUid && ev.debtor === partnerUid) runningPartner += ev.delta
      return { ...ev, isMe, myTotal: runningMe, partnerTotal: runningPartner, diffAfter: runningMe - runningPartner }
    })

    return { rows: [...rows].reverse(), finalDiff: runningMe - runningPartner }
  })()

  const debtorOptions = [
    { value: user?.uid ?? '', label: myName },
    ...(partnerUid ? [{ value: partnerUid, label: partnerName }] : []),
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr_220px] gap-4 fade-in">
        {[1,2,3].map(i => <div key={i} className="h-64 bg-gray-100 rounded-2xl skeleton" />)}
      </div>
    )
  }

  return (
    <div className="fade-in space-y-4 md:h-full md:flex md:flex-col">

      {/* Mobile: household chips */}
      <div className="md:hidden space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#0f172a]">Hogar</h1>
            <p className="text-sm text-[#64748b]">Cuentas compartidas</p>
          </div>
          <div className="flex gap-2">
            {household && (
              <>
                <Button onClick={() => setOpenDebt(true)} size="sm"><Plus size={15} /> Registrar</Button>
                <Button onClick={() => { setRenameVal(household.name as string); setOpenSettings(true) }} variant="ghost" size="sm"><Settings size={15} /></Button>
              </>
            )}
            {!household && (
              <>
                <Button onClick={() => setOpenCreate(true)} variant="secondary" size="sm"><PlusCircle size={15} /></Button>
                <Button onClick={() => setOpenJoin(true)} variant="ghost" size="sm"><LogIn size={15} /></Button>
              </>
            )}
          </div>
        </div>
        {households.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {households.map((hh: any) => (
              <button key={hh.id} onClick={() => setActiveId(hh.id)} className={clsx(
                'flex-shrink-0 px-4 py-2 rounded-2xl text-sm font-semibold transition-all',
                activeId === hh.id ? 'bg-brand-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
              )}>
                {hh.name as string}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* No households */}
      {households.length === 0 && (
        <Card className="text-center py-14 space-y-4">
          <Users size={48} className="mx-auto text-gray-200" />
          <div>
            <p className="text-sm font-semibold text-gray-700">Sin hogares configurados</p>
            <p className="text-xs text-gray-400 mt-1">Crea un hogar o únete con un código</p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => setOpenCreate(true)} size="sm"><PlusCircle size={15} /> Crear hogar</Button>
            <Button onClick={() => setOpenJoin(true)} variant="secondary" size="sm"><LogIn size={15} /> Unirme</Button>
          </div>
        </Card>
      )}

      {household && (
        <>
          {/* Toolbar: filtro de mes + acciones del hogar, todo en un solo componente */}
          <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-100 rounded-2xl px-3 py-2.5">
            <div className="flex items-center gap-0.5 bg-gray-50 rounded-xl px-1 py-1">
              <button onClick={() => shiftMonth(-1)} title="Mes anterior"
                className="p-1.5 rounded-lg hover:bg-white text-gray-400 hover:text-gray-700 transition">
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-semibold text-gray-700 capitalize px-1 min-w-[88px] text-center select-none">
                {format(selectedMonth, 'MMMM yyyy', { locale: es })}
              </span>
              <button onClick={() => shiftMonth(1)} title="Mes siguiente"
                className="p-1.5 rounded-lg hover:bg-white text-gray-400 hover:text-gray-700 transition">
                <ChevronRight size={14} />
              </button>
            </div>
            {!isCurrentMonth && (
              <button
                onClick={() => setSelectedMonth(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })}
                className="text-[10px] font-semibold text-brand-600 hover:underline"
              >
                Hoy
              </button>
            )}
            <span className="text-[10px] text-gray-400 hidden sm:inline">· {monthDebts.length} registros</span>

            <div className="flex-1" />

            <div className="relative" ref={hhMenuRef}>
              <button
                onClick={() => setHhMenuOpen((v) => !v)}
                title="Hogar y ajustes"
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition"
              >
                <Settings size={16} />
              </button>
              {hhMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 z-50">
                  {households.length > 1 && (
                    <div className="px-3 pb-2 mb-1 border-b border-gray-100 flex flex-wrap gap-1.5">
                      {households.map((hh: any) => (
                        <button key={hh.id} onClick={() => { setActiveId(hh.id); setHhMenuOpen(false) }} className={clsx(
                          'px-2.5 py-1 rounded-lg text-[10px] font-semibold transition',
                          activeId === hh.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                        )}>
                          {hh.name as string}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => { setRenameVal(household.name as string); setOpenSettings(true); setHhMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    <Settings size={14} className="text-gray-400" /> Configurar hogar
                  </button>
                  <button
                    onClick={copyCode}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    <span className="flex items-center gap-2.5"><Copy size={14} className="text-gray-400" /> Código: {household.inviteCode as string}</span>
                    <span className={clsx('text-[10px]', copied ? 'text-brand-500 font-semibold' : 'text-gray-400')}>
                      {copied ? 'Copiado' : 'Copiar'}
                    </span>
                  </button>
                  <button
                    onClick={() => { setOpenCreate(true); setHhMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    <PlusCircle size={14} className="text-gray-400" /> Nuevo hogar
                  </button>
                  <button
                    onClick={() => { setOpenJoin(true); setHhMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    <LogIn size={14} className="text-gray-400" /> Unirme a hogar
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => setOpenDebt(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-xs font-semibold rounded-xl hover:bg-gray-800 transition flex-shrink-0"
            >
              <Plus size={14} /> Registrar gasto
            </button>
          </div>

          {/* Detail view for selected debt */}
          {selectedDebt && (
            <div className="space-y-4 slide-up">
              <button
                onClick={() => setSelectedDebt(null)}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition"
              >
                <ArrowLeft size={15} /> Volver a saldos activos
              </button>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                <Card className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Deuda seleccionada</p>
                      <p className="text-base font-bold text-gray-900">{selectedDebt.concept}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {selectedDebt.debtor === user?.uid ? myName : partnerName} debe ·{' '}
                        {format(selectedDebt.date instanceof Date ? selectedDebt.date : new Date(selectedDebt.date), 'dd MMM yyyy', { locale: es })}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {(selectedDebt.crossedAmount as number) > 0 && (
                        <p className="text-xs text-gray-300 line-through tabular-nums">{formatCOP(selectedDebt.amount)}</p>
                      )}
                      <p className="text-xl font-black text-gray-900 tabular-nums">
                        {formatCOP(selectedDebt.amount - ((selectedDebt.crossedAmount as number) || 0))}
                      </p>
                    </div>
                  </div>
                  {selectedDebt.notas && (
                    <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">{selectedDebt.notas}</p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => { setCrossTarget(selectedDebt); setSelectedDebt(null) }}
                      className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:border-purple-300 hover:text-purple-700 hover:bg-purple-50 transition flex items-center justify-center gap-2">
                      <GitMerge size={14} /> Cruzar deuda
                    </button>
                    <button onClick={() => { handleSaldar(selectedDebt); setSelectedDebt(null) }}
                      className="flex-1 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition">
                      Saldar
                    </button>
                  </div>
                </Card>
                <Card className="p-5 space-y-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cruces registrados</p>
                  {crossings.filter((c: any) => c.debt1Id === selectedDebt.id || c.debt2Id === selectedDebt.id).length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">Sin cruces para esta deuda</p>
                  ) : crossings.filter((c: any) => c.debt1Id === selectedDebt.id || c.debt2Id === selectedDebt.id).map((c: any) => (
                    <div key={c.id} className="pb-3 border-b border-gray-50 last:border-0 last:pb-0">
                      <div className="flex justify-between items-start">
                        <p className="text-xs font-semibold text-purple-700">{formatCOP(c.amount)} cruzado</p>
                        <p className="text-[10px] text-gray-400">
                          {format(c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt), 'dd MMM yyyy', { locale: es })}
                        </p>
                      </div>
                      {c.notes && <p className="text-[10px] text-gray-500 mt-0.5">{c.notes}</p>}
                      <p className="text-[10px] text-gray-400 mt-0.5">Por {c.initiatedBy === user?.uid ? myName : partnerName}</p>
                    </div>
                  ))}
                </Card>
              </div>
            </div>
          )}

          {/* Main grid: panel combinado + historial */}
          {!selectedDebt && (
            <div className="grid gap-4 items-start grid-cols-1 xl:grid-cols-[1fr_280px] md:flex-1 md:min-h-0">

              {/* Panel combinado: Resumen + Saldos activos */}
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden flex flex-col md:h-full">
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
                      <TrendingUp size={13} className="text-brand-600" />
                    </div>
                    <span className="text-sm font-semibold text-gray-700">Resumen y Saldos</span>
                  </div>
                  <span className={clsx(
                    'text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize',
                    isCurrentMonth ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-100',
                  )}>
                    {isCurrentMonth ? 'En curso' : format(selectedMonth, 'MMMM yyyy', { locale: es })}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto">
                {debtsLoading ? (
                  <div className="p-5"><SkeletonList count={3} /></div>
                ) : (
                  <>
                    {/* Resumen simplificado */}
                    <div className="p-5 space-y-4 border-b border-gray-100">
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                          Total generado en {format(selectedMonth, 'MMMM', { locale: es })}
                          <InfoTip text="Solo los gastos registrados en el mes que estás viendo arriba, antes de abonos o cruces. No incluye saldo arrastrado de meses anteriores." />
                        </p>
                        <p className="text-3xl font-black text-gray-900 tabular-nums tracking-tight leading-none">
                          {formatCOP(totalGen)}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-900 inline-block flex-shrink-0" />
                            {myName} <span className="font-semibold text-gray-700 tabular-nums">{formatCOP(myMonthGen)}</span>
                          </span>
                          <span className="text-gray-300">+</span>
                          <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-600 inline-block flex-shrink-0" />
                            {partnerName} <span className="font-semibold text-gray-700 tabular-nums">{formatCOP(partnerMonthGen)}</span>
                          </span>
                        </div>
                      </div>

                      {/* Barra comparativa de deuda */}
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                          ¿Quién debe más? · saldo vigente
                          <InfoTip text="Saldo real acumulado hasta hoy, no cambia al navegar entre meses: lo que no se saldó en un mes se arrastra al siguiente." />
                        </p>
                        {(myNet + partnerNet) <= 0 ? (
                          <div className="bg-brand-50 rounded-xl py-3 text-center">
                            <p className="text-sm font-bold text-brand-600">Nadie debe nada — cuentas al día</p>
                          </div>
                        ) : (
                          <>
                            <div className="flex h-9 rounded-xl overflow-hidden gap-0.5">
                              {myNet > 0 && (
                                <div
                                  className="bg-gray-900 flex items-center justify-center transition-all duration-700 px-1"
                                  style={{ width: `${(myNet / (myNet + partnerNet)) * 100}%` }}
                                >
                                  {(myNet / (myNet + partnerNet)) * 100 > 18 && (
                                    <span className="text-[11px] text-white font-bold truncate">{formatCOP(myNet)}</span>
                                  )}
                                </div>
                              )}
                              {partnerNet > 0 && (
                                <div
                                  className="bg-purple-600 flex items-center justify-center transition-all duration-700 px-1"
                                  style={{ width: `${(partnerNet / (myNet + partnerNet)) * 100}%` }}
                                >
                                  {(partnerNet / (myNet + partnerNet)) * 100 > 18 && (
                                    <span className="text-[11px] text-white font-bold truncate">{formatCOP(partnerNet)}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex justify-between mt-1.5 text-[10px] text-gray-500 font-medium">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-gray-900 inline-block flex-shrink-0" /> {myName} {myNet === 0 && '(al día)'}
                              </span>
                              <span className="flex items-center gap-1">
                                {partnerName} {partnerNet === 0 && '(al día)'} <span className="w-2 h-2 rounded-full bg-purple-600 inline-block flex-shrink-0" />
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Cubierto vs por liquidar */}
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-1.5">
                          <span className="text-gray-500 flex items-center gap-1">
                            {formatCOP(totalAbono + totalCruzado)} cubierto ({progress}%)
                            <InfoTip text="De lo generado en este mes: lo ya abonado o compensado. No es el saldo total — ese es el de la barra de arriba." />
                          </span>
                          <span className="font-bold text-amber-600">{formatCOP(Math.max(0, pendiente))} de {format(selectedMonth, 'MMMM', { locale: es })}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* Mi sección */}
                    <div className="border-b border-gray-100">
                      <button
                        onClick={() => setMyExpanded(!myExpanded)}
                        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/80 transition text-left"
                      >
                        <div className="w-9 h-9 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">{myName.slice(0,2).toUpperCase()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{myName}</p>
                          <p className="text-[10px] text-gray-400">Responsable asignado</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {myNet > 0
                            ? <span className="text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full whitespace-nowrap">Debe {formatCOP(myNet)}</span>
                            : <span className="text-xs font-bold text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full">Al día</span>
                          }
                          <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200 flex-shrink-0', myExpanded && 'rotate-180')} />
                        </div>
                      </button>
                      <ExpandSection open={myExpanded}>
                        <div className="px-5 pb-2">
                          <BalanceBreakdown name={myName} {...myBreakdown} />
                          <PersonDebtGroups
                            personDebts={myDebts}
                            onCross={(d) => setCrossTarget(d)}
                            onSaldar={(d) => handleSaldar(d)}
                            onSelect={(d) => setSelectedDebt(d)}
                          />
                        </div>
                      </ExpandSection>
                    </div>

                    {/* Separador */}
                    <div className="flex items-center gap-3 px-5 py-2.5 bg-gray-50/60">
                      <div className="flex-1 h-px bg-gray-100" />
                      <span className="text-[10px] font-bold text-gray-300 tracking-widest uppercase whitespace-nowrap flex items-center gap-1">
                        Compensación bilateral
                        <InfoTip text="Debajo se cruzan gastos entre ambos para saldar sin mover dinero de uno a otro." />
                      </span>
                      <div className="flex-1 h-px bg-gray-100" />
                    </div>

                    {/* Sección pareja */}
                    {partnerUid ? (
                      <div>
                        <button
                          onClick={() => setPartnerExpanded(!partnerExpanded)}
                          className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/80 transition text-left"
                        >
                          <div className="w-9 h-9 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-bold">{partnerName.slice(0,2).toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{partnerName}</p>
                            <p className="text-[10px] text-gray-400">Co-titular hogar</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {partnerNet > 0
                              ? <span className="text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full whitespace-nowrap">Debe {formatCOP(partnerNet)}</span>
                              : <span className="text-xs font-bold text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full">Al día</span>
                            }
                            <ChevronDown size={14} className={clsx('text-gray-400 transition-transform duration-200 flex-shrink-0', partnerExpanded && 'rotate-180')} />
                          </div>
                        </button>
                        <ExpandSection open={partnerExpanded}>
                          <div className="px-5 pb-2">
                            <BalanceBreakdown name={partnerName} {...partnerBreakdown} />
                            <PersonDebtGroups
                              personDebts={partnerDebts}
                              onCross={(d) => setCrossTarget(d)}
                              onSaldar={(d) => handleSaldar(d)}
                              onSelect={(d) => setSelectedDebt(d)}
                            />
                          </div>
                        </ExpandSection>
                      </div>
                    ) : (
                      <div className="px-5 py-6 text-center">
                        <p className="text-xs text-gray-400">Ningún co-titular unido aún.</p>
                        <p className="text-xs text-brand-600 font-semibold mt-1">
                          Código: {household.inviteCode as string}
                        </p>
                      </div>
                    )}


                  </>
                )}
                </div>
              </div>

              {/* Panel 3: Historial completo, línea de tiempo por persona (solo xl) */}
              <div className="hidden xl:flex flex-col bg-white border border-gray-100 rounded-2xl overflow-hidden xl:h-full">
                <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={13} className="text-gray-400" />
                    <span className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                      Historial
                      <InfoTip text="Todos los movimientos desde el inicio, de ambas personas, en orden cronológico. Cada uno muestra quién lo hizo y el saldo resultante." />
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-gray-400">{fullLedger.rows.length}</span>
                </div>

                {/* Saldo actual, siempre arriba */}
                <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0 bg-gray-50/60">
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Saldo actual</p>
                  {fullLedger.finalDiff === 0 ? (
                    <p className="text-[13px] font-bold text-brand-600">Cuentas al día</p>
                  ) : (
                    <p className="text-[13px] font-black text-gray-900 tabular-nums">
                      {fullLedger.finalDiff > 0 ? myName : partnerName} debe {formatCOP(Math.abs(fullLedger.finalDiff))}
                    </p>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3">
                  {fullLedger.rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                      <div className="w-8 h-8 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center">
                        <TrendingUp size={14} className="text-gray-300" />
                      </div>
                      <p className="text-[11px] text-gray-400 text-center">Sin movimientos registrados aún</p>
                    </div>
                  ) : (
                    <div className="relative">
                      {/* Línea de tiempo */}
                      <div className="absolute left-[11px] top-1 bottom-1 w-px bg-gray-100" />

                      {fullLedger.rows.map((ev, idx) => {
                        const who  = ev.isMe ? myName : partnerName
                        const nodeColor = ev.isMe ? '#111827' : '#7c3aed'
                        const kindLabel = ev.kind === 'deuda' ? 'debe' : ev.kind === 'abono' ? 'abonó' : 'cruzó'
                        const owesNow = ev.diffAfter > 0 ? myName : ev.diffAfter < 0 ? partnerName : null
                        const statusLabel = ev.kind === 'deuda' ? 'pendiente' : ev.kind === 'abono' ? 'abonado' : 'cruzado'
                        const statusCls   = ev.kind === 'deuda'
                          ? 'bg-amber-100 text-amber-700'
                          : ev.kind === 'abono'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        return (
                          <div key={idx} className="relative flex gap-3 pb-3 last:pb-0">
                            <div className="relative z-10 flex-shrink-0 mt-0.5">
                              <div
                                className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-white text-[9px] font-bold shadow-sm ring-2 ring-white"
                                style={{ backgroundColor: nodeColor }}
                              >
                                {who.slice(0, 2).toUpperCase()}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] font-medium text-gray-700 truncate">{ev.concept}</p>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                  <span className={clsx(
                                    'text-[11px] font-semibold tabular-nums',
                                    ev.delta > 0 ? 'text-red-500' : 'text-brand-600',
                                  )}>
                                    {ev.delta > 0 ? '+' : '−'}{formatCOP(Math.abs(ev.delta))}
                                  </span>
                                  <span className={clsx('text-[8px] font-bold px-1.5 py-0.5 rounded font-mono leading-none', statusCls)}>
                                    {statusLabel}
                                  </span>
                                </div>
                              </div>
                              <p className="text-[9px] text-gray-400 mt-0.5">
                                {who} {kindLabel} · {format(ev.date, 'dd MMM yy', { locale: es })}
                              </p>
                              <p className="text-[9px] text-gray-400 mt-0.5">
                                {owesNow ? `${owesNow} debe ${formatCOP(Math.abs(ev.diffAfter))}` : 'Cuentas al día'}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}
        </>
      )}

      {/* Modals */}
      {crossTarget && (
        <CrossingModal
          debt={crossTarget}
          counterPersonId={crossTarget.debtor === user?.uid ? (partnerUid ?? '') : (user?.uid ?? '')}
          partnerNet={crossTarget.debtor === user?.uid ? partnerNet : myNet}
          myName={myName}
          partnerName={partnerName}
          userUid={user?.uid}
          saving={saving}
          onConfirm={handleCreateCrossing}
          onClose={() => setCrossTarget(null)}
        />
      )}

      <Modal open={openSettings} onClose={() => setOpenSettings(false)} title="Configurar hogar">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Renombrar</p>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                placeholder="Nombre del hogar"
              />
              <Button onClick={handleRename} size="sm" disabled={saving || !renameVal.trim()}>
                <Pencil size={14} /> Guardar
              </Button>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Zona de peligro</p>
            <button onClick={handleDeleteHousehold} disabled={saving}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition disabled:opacity-50">
              <Trash2 size={15} /> Eliminar hogar y todos los registros
            </button>
            <p className="text-[10px] text-gray-400">Esta acción no se puede deshacer.</p>
          </div>
        </div>
      </Modal>

      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="Crear hogar">
        <form onSubmit={hhForm.handleSubmit(onCreateHousehold)} className="space-y-4">
          <Input label="Nombre del hogar" placeholder="ej. Casa Carlos y Alexandra" {...hhForm.register('name')} error={hhForm.formState.errors.name?.message} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenCreate(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Creando…' : 'Crear'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={openJoin} onClose={() => setOpenJoin(false)} title="Unirme a un hogar">
        <form onSubmit={joinForm.handleSubmit(onJoinHousehold)} className="space-y-4">
          <Input label="Código de invitación" placeholder="ABC123" maxLength={6} className="uppercase" {...joinForm.register('code')} error={joinForm.formState.errors.code?.message} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenJoin(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Uniéndome…' : 'Unirme'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={openDebt} onClose={() => setOpenDebt(false)} title="Registrar deuda / abono">
        <form onSubmit={debtForm.handleSubmit(onAddDebt)} className="space-y-4">
          <Select label="Tipo" options={TIPO_OPTIONS} {...debtForm.register('tipo')} />
          <Input label="Concepto" placeholder="ej. Veterinario, Mercado…" {...debtForm.register('concept')} error={debtForm.formState.errors.concept?.message} />
          <Input label="Monto (COP)" type="number" placeholder="0" {...debtForm.register('amount')} error={debtForm.formState.errors.amount?.message} />
          <Select label="¿Quién debe?" options={debtorOptions} {...debtForm.register('debtor')} />
          <Select label="Categoría" options={CAT_OPTIONS} {...debtForm.register('category')} />
          <Input label="Fecha" type="date" {...debtForm.register('date')} />
          <Input label="Notas (opcional)" placeholder="ej. Medicamentos" {...debtForm.register('notas')} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpenDebt(false)}>Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}


// ── Expand / collapse section (CSS grid animation) ───────────────────────────
// ── Small hover tooltip, portaled to <body> so it's never clipped by a
// scrolling or animated ancestor (overflow-y-auto panels, ExpandSection) ─────
function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const iconRef = useRef<HTMLSpanElement>(null)

  function show() {
    const rect = iconRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 })
  }
  function hide() { setPos(null) }

  return (
    <span
      ref={iconRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={(e) => e.stopPropagation()}
    >
      <Info size={11} className="text-gray-300 hover:text-gray-400 cursor-help" />
      {pos && createPortal(
        <span
          className="fixed -translate-x-1/2 -translate-y-full w-44 rounded-lg bg-gray-900 text-white text-[10px] font-normal normal-case tracking-normal leading-snug px-2 py-1.5 z-[1000] text-center pointer-events-none shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  )
}

function ExpandSection({ open, children, maxHeight }: { open: boolean; children: React.ReactNode; maxHeight?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>{children}</div>
      </div>
    </div>
  )
}

// ── Groups a person's debts by status: Pendiente / Cruzado / Abonado ─────────
// ── Step-by-step breakdown of how a person's balance was calculated ──────────
function BalanceBreakdown({ name, deuda, abono, cruzado, saldo }: {
  name: string; deuda: number; abono: number; cruzado: number; saldo: number
}) {
  return (
    <div className="bg-gray-50 rounded-xl px-3 py-2.5 mb-3 space-y-1">
      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
        Cómo se calcula
        <InfoTip text="Suma de todas sus deudas históricas, menos lo que ha abonado y lo que se le ha cruzado — nunca se resetea por mes." />
      </p>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-500">Deudas totales</span>
        <span className="font-semibold text-gray-700 tabular-nums">{formatCOP(deuda)}</span>
      </div>
      {abono > 0 && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-gray-500">− Abonos</span>
          <span className="font-semibold text-brand-600 tabular-nums">−{formatCOP(abono)}</span>
        </div>
      )}
      {cruzado > 0 && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-gray-500">− Cruzado</span>
          <span className="font-semibold text-purple-600 tabular-nums">−{formatCOP(cruzado)}</span>
        </div>
      )}
      <div className="flex items-center justify-between text-[10px] pt-1.5 mt-1 border-t border-gray-200">
        <span className="font-bold text-gray-700">= {name} debe</span>
        <span className="font-black text-gray-900 tabular-nums">{formatCOP(Math.max(0, saldo))}</span>
      </div>
    </div>
  )
}

function PersonDebtGroups({ personDebts, onCross, onSaldar, onSelect }: {
  personDebts: any[]
  onCross: (d: any) => void
  onSaldar: (d: any) => void
  onSelect: (d: any) => void
}) {
  const pendientes = personDebts.filter((d: any) => d.tipo === 'Deuda' && !d.cruzado)
  const cruzados    = personDebts.filter((d: any) => d.tipo === 'Deuda' && d.cruzado)
  const abonos      = personDebts.filter((d: any) => d.tipo === 'Abono')

  if (pendientes.length === 0 && cruzados.length === 0 && abonos.length === 0) {
    return <p className="text-xs text-gray-400 py-3">Sin registros.</p>
  }

  return (
    <div>
      {pendientes.length > 0 && (
        <div>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider pt-1 pb-0.5 flex items-center gap-1">
            Pendiente
            <InfoTip text="Gastos sin cubrir todavía: ni abonados ni cruzados." />
          </p>
          {pendientes.map((d: any) => (
            <DebtItem key={d.id} d={d}
              onCross={() => onCross(d)}
              onSaldar={() => onSaldar(d)}
              onSelect={() => onSelect(d)}
            />
          ))}
        </div>
      )}
      {cruzados.length > 0 && (
        <div>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider pt-2 pb-0.5 flex items-center gap-1">
            Cruzado
            <InfoTip text="Se compensó contra un gasto de la otra persona, sin mover dinero entre ambos." />
          </p>
          {cruzados.map((d: any) => (
            <StatusItem key={d.id} d={d}
              label="Cruzado" labelCls="bg-purple-100 text-purple-700"
              onSelect={() => onSelect(d)}
            />
          ))}
        </div>
      )}
      {abonos.length > 0 && (
        <div>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider pt-2 pb-0.5 flex items-center gap-1">
            Abonado
            <InfoTip text="Se pagó directamente, en efectivo o transferencia." />
          </p>
          {abonos.map((d: any) => (
            <StatusItem key={d.id} d={d}
              label="Abonado" labelCls="bg-blue-100 text-blue-700"
              onSelect={() => onSelect(d)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Read-only compact row for already-settled debts/abonos ───────────────────
function StatusItem({ d, label, labelCls, onSelect }: {
  d: any; label: string; labelCls: string; onSelect: () => void
}) {
  return (
    <button onClick={onSelect} className="w-full text-left py-2 border-b border-gray-50 last:border-0 group">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-600 truncate group-hover:text-gray-800 transition">{d.concept}</p>
          <p className="text-[9px] text-gray-400 mt-0.5">
            {format(d.date instanceof Date ? d.date : new Date(d.date), 'dd MMM yyyy', { locale: es })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded', labelCls)}>{label}</span>
          <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{formatCOP(d.amount)}</span>
        </div>
      </div>
    </button>
  )
}

// ── Compact debt item for the new panel layout ────────────────────────────────
function DebtItem({ d, onCross, onSaldar, onSelect }: {
  d: any
  onCross: () => void
  onSaldar: () => void
  onSelect: () => void
}) {
  const crossed   = (d.crossedAmount as number) || 0
  const remaining = d.amount - crossed

  return (
    <div className="py-3 border-b border-gray-50 last:border-0">
      <button onClick={onSelect} className="w-full text-left group">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-gray-600 transition">{d.concept}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {format(d.date instanceof Date ? d.date : new Date(d.date), 'dd MMM yyyy', { locale: es })}
              {crossed > 0 && <span className="ml-1.5 text-purple-500">· {formatCOP(crossed)} cruzado</span>}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            {crossed > 0 && (
              <p className="text-[10px] text-gray-300 line-through tabular-nums">{formatCOP(d.amount)}</p>
            )}
            <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCOP(remaining)}</p>
          </div>
        </div>
      </button>
      <div className="flex gap-1.5">
        <button onClick={onCross}
          className="flex-1 py-1.5 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:border-purple-300 hover:text-purple-700 hover:bg-purple-50 transition flex items-center justify-center gap-1">
          <GitMerge size={11} /> Cruzar
        </button>
        <button onClick={onSaldar}
          className="flex-1 py-1.5 rounded-lg bg-gray-900 text-white text-[11px] font-semibold hover:bg-gray-800 transition">
          Saldar
        </button>
      </div>
    </div>
  )
}


// ── Crossing modal ────────────────────────────────────────────────────────────
function CrossingModal({ debt, counterPersonId, partnerNet, myName, partnerName, userUid, saving, onConfirm, onClose }: {
  debt: any; counterPersonId: string; partnerNet: number
  myName: string; partnerName: string; userUid?: string; saving: boolean
  onConfirm: (counterDebt: null, counterPersonId: string, amount: number, notes: string) => void
  onClose: () => void
}) {
  const isMe        = debt.debtor === userUid
  const who         = isMe ? myName : partnerName
  const counterName = isMe ? partnerName : myName
  const remaining   = debt.amount - ((debt.crossedAmount as number) || 0)
  const maxAmount   = Math.min(remaining, Math.max(0, partnerNet))

  const [amount, setAmount] = useState(maxAmount)
  const [notes, setNotes]   = useState('')
  const [err, setErr]       = useState('')

  function handleConfirm() {
    if (amount <= 0)          { setErr('El monto debe ser mayor a 0'); return }
    if (amount > remaining)   { setErr(`Máximo ${formatCOP(remaining)} (saldo de esta deuda)`); return }
    if (amount > partnerNet)  { setErr(`Máximo ${formatCOP(partnerNet)} (saldo neto de ${counterName})`); return }
    setErr('')
    onConfirm(null, counterPersonId, amount, notes)
  }

  return (
    <Modal open onClose={onClose} title="Cruzar deuda">
      <div className="space-y-4">
        {/* Deuda origen */}
        <div className="bg-purple-50 rounded-2xl p-3.5 space-y-0.5">
          <p className="text-xs text-purple-500 font-semibold">Deuda a cruzar</p>
          <p className="text-sm font-bold text-gray-800">{debt.concept}</p>
          <p className="text-xs text-gray-500">
            {who} debe · <span className="font-semibold text-purple-700">{formatCOP(remaining)} pendiente</span>
          </p>
        </div>

        {/* Saldo contraparte */}
        <div className="bg-amber-50 rounded-2xl p-3.5 space-y-0.5">
          <p className="text-xs text-amber-600 font-semibold">Saldo neto de {counterName}</p>
          <p className="text-sm font-bold text-gray-800">{formatCOP(Math.max(0, partnerNet))}</p>
          <p className="text-[10px] text-gray-400">Total de todas sus deudas pendientes</p>
        </div>

        {/* Monto */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Monto a cruzar (COP)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <p className="text-[10px] text-gray-400">Máx. {formatCOP(maxAmount)}</p>
        </div>

        {/* Notas */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">Notas (opcional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ej. Acuerdo del 15 oct"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <GitMerge size={14} /> {saving ? 'Cruzando…' : 'Confirmar cruce'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
