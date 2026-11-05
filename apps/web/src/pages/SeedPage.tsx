import { useState } from 'react'
import { collection, doc, addDoc, updateDoc, setDoc, Timestamp, serverTimestamp, getDocs, where, query } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/hooks/useAuth'
import { getHousehold, createHousehold, getHouseholdIds } from '@/lib/firestore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { CheckCircle, AlertCircle, Loader, Database, Users } from 'lucide-react'
import {
  CARLOS_EMAIL, ALE_EMAIL,
  CARLOS_FIXED_EXPENSES, CARLOS_EXPENSES, CARLOS_INCOMES, CARLOS_PAYMENTS_OCT,
  ALE_FIXED_EXPENSES, ALE_EXPENSES, ALE_PAYMENTS_OCT,
  HOUSEHOLD_DEBTS, HOUSEHOLD_CROSSINGS,
} from '@/data/seed-data'

type Status = 'idle' | 'running' | 'done' | 'error'

interface SeedLog {
  label: string
  count: number
  status: 'ok' | 'skip' | 'error'
}

function d(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00')
}

export default function SeedPage() {
  const { user, profile } = useAuth()
  const [status, setStatus]   = useState<Status>('idle')
  const [logs, setLogs]       = useState<SeedLog[]>([])
  const [error, setError]     = useState<string | null>(null)

  const email       = user?.email ?? ''
  const isCarlos    = email === CARLOS_EMAIL
  const isAle       = email === ALE_EMAIL
  const hhIds = getHouseholdIds(profile as any)
  const householdId = hhIds[0] ?? null

  function log(label: string, count: number, status: SeedLog['status'] = 'ok') {
    setLogs((prev) => [...prev, { label, count, status }])
  }

  async function checkAlreadySeeded(): Promise<boolean> {
    if (!user) return false
    const snap = await getDocs(query(
      collection(db, 'fixedExpenses'),
      where('userId', '==', user.uid),
    ))
    return !snap.empty
  }

  async function seedFixedExpenses(
    expenses: readonly { concept: string; estimatedAmount: number; paymentDay: number | null; category: string; isVariable: boolean; notes: string; frequency: string }[],
    userId: string,
  ): Promise<Map<string, string>> {
    const conceptToId = new Map<string, string>()
    for (const fe of expenses) {
      const ref = await addDoc(collection(db, 'fixedExpenses'), {
        userId,
        concept:         fe.concept,
        estimatedAmount: fe.estimatedAmount,
        paymentDay:      fe.paymentDay,
        category:        fe.category,
        isVariable:      fe.isVariable,
        notes:           fe.notes,
        frequency:       fe.frequency,
        active:          true,
        createdAt:       serverTimestamp(),
      })
      conceptToId.set(fe.concept, ref.id)
    }
    return conceptToId
  }

  async function seedPayments(
    payments: readonly { concept: string; paidAmount: number; month: string; paymentDate: string; notes: string }[],
    userId: string,
    conceptToId: Map<string, string>,
  ) {
    let count = 0
    for (const p of payments) {
      const fixedExpenseId = conceptToId.get(p.concept) ?? ''
      await addDoc(collection(db, 'fixedExpensePayments'), {
        userId,
        fixedExpenseId,
        concept:     p.concept,
        paidAmount:  p.paidAmount,
        month:       p.month,
        paymentDate: Timestamp.fromDate(d(p.paymentDate)),
        notes:       p.notes,
        createdAt:   serverTimestamp(),
      })
      count++
    }
    return count
  }

  async function seedExpenses(
    expenses: readonly { description: string; amount: number; category: string; date: string }[],
    userId: string,
  ) {
    for (const e of expenses) {
      await addDoc(collection(db, 'expenses'), {
        userId,
        description: e.description,
        amount:      e.amount,
        category:    e.category,
        date:        Timestamp.fromDate(d(e.date)),
        type:        'variable',
        isRecurring: false,
        createdAt:   serverTimestamp(),
      })
    }
  }

  async function seedIncomes(
    incomes: readonly { description: string; amount: number; month: string; date: string }[],
    userId: string,
  ) {
    for (const inc of incomes) {
      await addDoc(collection(db, 'incomes'), {
        userId,
        description: inc.description,
        amount:      inc.amount,
        month:       inc.month,
        date:        Timestamp.fromDate(d(inc.date)),
        createdAt:   serverTimestamp(),
      })
    }
  }

  async function seedHouseholdDebts(householdId: string, carlosUid: string, aleUid: string): Promise<Map<string, string>> {
    const seedIdToRealId = new Map<string, string>()
    for (const debt of HOUSEHOLD_DEBTS) {
      const debtorUid     = debt.debtor === 'carlos' ? carlosUid : aleUid
      const registeredUid = debt.registeredBy === 'carlos' ? carlosUid : aleUid
      const ref = await addDoc(collection(db, 'householdDebts'), {
        householdId,
        concept:       debt.concept,
        tipo:          debt.tipo,
        amount:        debt.amount,
        crossedAmount: 0,
        debtor:        debtorUid,
        category:      debt.category,
        date:          Timestamp.fromDate(d(debt.date)),
        registeredBy:  registeredUid,
        estado:        debt.estado,
        saldaId:       debt.saldaId,
        notas:         debt.notas,
        cruzado:       debt.cruzado,
        createdAt:     serverTimestamp(),
      })
      seedIdToRealId.set(debt.id, ref.id)
    }
    return seedIdToRealId
  }

  // Applies the real crossings (compensación bilateral) on top of the freshly
  // seeded debts: writes a householdCrossings doc AND syncs crossedAmount +
  // cruzado on the crossed debt, same effect as clicking "Cruzar deuda" in the app.
  async function seedHouseholdCrossings(
    householdId: string,
    carlosUid: string,
    aleUid: string,
    seedIdToRealId: Map<string, string>,
  ) {
    let count = 0
    for (const cross of HOUSEHOLD_CROSSINGS) {
      const debt1Id = seedIdToRealId.get(cross.debtId)
      if (!debt1Id) continue
      const debt2PersonId = cross.debt2Person === 'carlos' ? carlosUid : aleUid
      const initiatedBy   = cross.initiatedBy === 'carlos' ? carlosUid : aleUid

      await addDoc(collection(db, 'householdCrossings'), {
        householdId,
        debt1Id,
        debt2Id: null,
        debt2PersonId,
        amount: cross.amount,
        initiatedBy,
        notes: cross.notes,
        createdAt: Timestamp.fromDate(d(cross.date)),
      })
      await updateDoc(doc(db, 'householdDebts', debt1Id), {
        crossedAmount: cross.amount,
        cruzado: true,
      })
      count++
    }
    return count
  }

  async function runRolesSeed() {
    setStatus('running')
    setLogs([])
    setError(null)
    try {
      await setDoc(doc(db, 'roles', 'admin'), {
        name: 'Administrador',
        slug: 'admin',
        description: 'Control total de la plataforma, usuarios, hogares y finanzas',
        permissions: ['all', 'manage_users', 'manage_households', 'manage_finances'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })

      await setDoc(doc(db, 'roles', 'integrante'), {
        name: 'Integrante',
        slug: 'integrante',
        description: 'Miembro del hogar con acceso a gastos, deudas y finanzas compartidas',
        permissions: ['view_households', 'manage_expenses', 'manage_debts', 'view_finances'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })

      log('Roles creados ("admin", "integrante")', 2, 'ok')
      setStatus('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al sembrar roles')
      setStatus('error')
    }
  }

  async function runSeed() {
    if (!user) return
    setStatus('running')
    setLogs([])
    setError(null)

    try {
      const already = await checkAlreadySeeded()
      if (already) {
        setError('Ya hay datos importados para este usuario. Borra los existentes antes de reimportar.')
        setStatus('error')
        return
      }

      if (isCarlos) {
        // Carlos personal data
        const feMap = await seedFixedExpenses(CARLOS_FIXED_EXPENSES, user.uid)
        log('Gastos fijos (Carlos)', CARLOS_FIXED_EXPENSES.length)

        const pCount = await seedPayments(CARLOS_PAYMENTS_OCT, user.uid, feMap)
        log('Pagos oct 2026 (Carlos)', pCount)

        await seedExpenses(CARLOS_EXPENSES, user.uid)
        log('Gastos variables (Carlos)', CARLOS_EXPENSES.length)

        await seedIncomes(CARLOS_INCOMES, user.uid)
        log('Ingresos (Carlos)', CARLOS_INCOMES.length)

        // Household debts — create household if needed, use Ale's email as placeholder
        let hhId = householdId
        if (!hhId) {
          const { id } = await createHousehold(user.uid, 'Casa Carlos y Alexandra')
          hhId = id
        }
        // If Ale has joined, use her real UID; otherwise use her email as placeholder
        const hh      = await getHousehold(hhId)
        const members = (hh?.members as string[] | undefined) ?? []
        const aleUid  = members.find((m) => m !== user.uid) ?? ALE_EMAIL
        const idMap   = await seedHouseholdDebts(hhId, user.uid, aleUid)
        log('Deudas del hogar', HOUSEHOLD_DEBTS.length)
        const crossCount = await seedHouseholdCrossings(hhId, user.uid, aleUid, idMap)
        log('Cruces aplicados', crossCount)
      } else if (isAle) {
        // Ale personal data
        const feMap = await seedFixedExpenses(ALE_FIXED_EXPENSES, user.uid)
        log('Gastos fijos (Ale)', ALE_FIXED_EXPENSES.length)

        const pCount = await seedPayments(ALE_PAYMENTS_OCT, user.uid, feMap)
        log('Pagos oct 2026 (Ale)', pCount)

        await seedExpenses(ALE_EXPENSES, user.uid)
        log('Gastos variables (Ale)', ALE_EXPENSES.length)

        log('Ingresos (Ale)', 0, 'skip')
      }

      setStatus('done')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setStatus('error')
    }
  }

  const isOwner = isCarlos || isAle
  const needsHousehold = isCarlos && !householdId
  const householdReady = isCarlos && householdId

  return (
    <div className="space-y-4 fade-in max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-bold text-[#0f172a]">Importar datos históricos</h1>
        <p className="text-sm text-[#64748b]">Carga los datos de los archivos Excel a Firestore</p>
      </div>

      {!isOwner && (
        <Card className="p-4 flex items-center gap-3 bg-red-50 border-red-200">
          <AlertCircle size={20} className="text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">Este correo no tiene datos para importar.</p>
        </Card>
      )}

      {isOwner && (
        <>
          {/* Summary */}
          <Card className="p-4 space-y-3">
            <p className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">
              Datos a importar para <span className="text-brand-600">{isCarlos ? 'Carlos' : 'Ale'}</span>
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {isCarlos && (
                <>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-400">Gastos fijos</p>
                    <p className="font-bold text-gray-800">{CARLOS_FIXED_EXPENSES.length}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-400">Pagos oct</p>
                    <p className="font-bold text-gray-800">{CARLOS_PAYMENTS_OCT.length}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-400">Gastos variables</p>
                    <p className="font-bold text-gray-800">{CARLOS_EXPENSES.length}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-400">Ingresos</p>
                    <p className="font-bold text-gray-800">{CARLOS_INCOMES.length}</p>
                  </div>
                </>
              )}
              {isAle && (
                <>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-400">Gastos fijos</p>
                    <p className="font-bold text-gray-800">{ALE_FIXED_EXPENSES.length}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-400">Pagos oct</p>
                    <p className="font-bold text-gray-800">{ALE_PAYMENTS_OCT.length}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-xs text-gray-400">Gastos variables</p>
                    <p className="font-bold text-gray-800">{ALE_EXPENSES.length}</p>
                  </div>
                </>
              )}
            </div>

            {isCarlos && (
              <div className={`rounded-xl p-3 flex items-center gap-2 text-sm ${
                householdReady
                  ? 'bg-brand-50 text-brand-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                <Users size={16} className="flex-shrink-0" />
                {householdReady
                  ? `Hogar configurado → se importarán las ${HOUSEHOLD_DEBTS.length} deudas compartidas si Alexandra ya se unió`
                  : 'Sin hogar configurado → las deudas compartidas se omitirán. Crea un hogar primero en la pestaña Hogar.'}
              </div>
            )}
          </Card>

          {/* Action */}
          {status === 'idle' && (
            <div className="space-y-2">
              <Button onClick={runSeed} className="w-full">
                <Database size={16} /> Importar todos los datos
              </Button>
              {isCarlos && (
                <>
                  <Button onClick={runRolesSeed} variant="secondary" className="w-full">
                    <Users size={16} /> Sembrar Colección Roles (admin, integrante)
                  </Button>
                </>
              )}
            </div>
          )}

          {status === 'running' && (
            <Button disabled className="w-full">
              <Loader size={16} className="animate-spin" /> Importando…
            </Button>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <Card className="p-4 space-y-2">
              {logs.map((l, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{l.label}</span>
                  <span className={`font-semibold tabular-nums ${
                    l.status === 'ok'    ? 'text-brand-600' :
                    l.status === 'skip'  ? 'text-gray-400'  : 'text-red-500'
                  }`}>
                    {l.status === 'skip' ? 'Omitido' : `${l.count} docs`}
                  </span>
                </div>
              ))}
            </Card>
          )}

          {status === 'done' && (
            <Card className="p-4 flex items-center gap-3 bg-green-50 border-green-200">
              <CheckCircle size={20} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">¡Importación completada!</p>
                <p className="text-xs text-green-600">Navega a cada sección para ver los datos.</p>
              </div>
            </Card>
          )}

          {status === 'error' && error && (
            <Card className="p-4 flex items-center gap-3 bg-red-50 border-red-200">
              <AlertCircle size={20} className="text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
