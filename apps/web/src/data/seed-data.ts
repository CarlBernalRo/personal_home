// Seed data extracted from Excel files (October 2026)
// Carlos: carl752009@gmail.com | Ale: alefr86@gmail.com

export const CARLOS_EMAIL = 'carl752009@gmail.com'
export const ALE_EMAIL    = 'alefr86@gmail.com'

// ── Fixed Expenses ────────────────────────────────────────────────────────────

export const CARLOS_FIXED_EXPENSES = [
  { concept: 'Pago arriendo mamá',       estimatedAmount: 450000, paymentDay: 30, category: 'arriendo',        isVariable: false, notes: '',                                                   frequency: 'fijo'      },
  { concept: 'Pago deuda Ale',           estimatedAmount: 0,      paymentDay: 30, category: 'deudas',          isVariable: true,  notes: 'Varía según lo que deba a Ale',                      frequency: 'ocasional' },
  { concept: 'Pago moto',                estimatedAmount: 400000, paymentDay: 30, category: 'transporte',      isVariable: false, notes: '',                                                   frequency: 'fijo'      },
  { concept: 'Pago internet',            estimatedAmount: 75000,  paymentDay: 9,  category: 'suscripciones',   isVariable: false, notes: 'Número de cuenta: 40575325',                        frequency: 'fijo'      },
  { concept: 'Pago plan de datos',       estimatedAmount: 48000,  paymentDay: 15, category: 'suscripciones',   isVariable: false, notes: 'Número de cuenta: 3195037635',                      frequency: 'fijo'      },
  { concept: 'Pago Claude',              estimatedAmount: 32200,  paymentDay: 30, category: 'suscripciones',   isVariable: false, notes: '',                                                   frequency: 'fijo'      },
  { concept: 'Pago gasolina',            estimatedAmount: 80000,  paymentDay: null, category: 'transporte',    isVariable: false, notes: '',                                                   frequency: 'ocasional' },
  { concept: 'Pago aporte apartamento',  estimatedAmount: 500000, paymentDay: 30, category: 'arriendo',        isVariable: false, notes: '',                                                   frequency: 'fijo'      },
  { concept: 'Pago parqueadero',         estimatedAmount: 55000,  paymentDay: 30, category: 'transporte',      isVariable: false, notes: '',                                                   frequency: 'fijo'      },
  { concept: 'Pago tarjeta de crédito',  estimatedAmount: 150000, paymentDay: 19, category: 'deudas',          isVariable: true,  notes: 'Monto aproximado, confirmar valor exacto cada mes', frequency: 'ocasional' },
  { concept: 'Pago YouTube Premium',     estimatedAmount: 16000,  paymentDay: 30, category: 'entretenimiento', isVariable: false, notes: '',                                                   frequency: 'fijo'      },
  { concept: 'Ahorro programado',        estimatedAmount: 150000, paymentDay: 2,  category: 'ahorro',          isVariable: false, notes: 'Ahorro programado',                                  frequency: 'fijo'      },
] as const

export const ALE_FIXED_EXPENSES = [
  { concept: 'Administración',      estimatedAmount: 162000, paymentDay: 5,  category: 'servicios',  isVariable: false, notes: '',                 frequency: 'fijo' },
  { concept: 'Plan de datos',       estimatedAmount: 39000,  paymentDay: 15, category: 'suscripciones', isVariable: false, notes: '',              frequency: 'fijo' },
  { concept: 'Servicio luz',        estimatedAmount: 102000, paymentDay: 5,  category: 'servicios',  isVariable: false, notes: '',                 frequency: 'fijo' },
  { concept: 'Servicio agua',       estimatedAmount: 60000,  paymentDay: 15, category: 'servicios',  isVariable: false, notes: '',                 frequency: 'fijo' },
  { concept: 'Servicio gas',        estimatedAmount: 17000,  paymentDay: 1,  category: 'servicios',  isVariable: false, notes: '',                 frequency: 'fijo' },
  { concept: 'Seguro funerario',    estimatedAmount: 20000,  paymentDay: 15, category: 'otros',      isVariable: false, notes: '',                 frequency: 'fijo' },
  { concept: 'Seguro vivienda',     estimatedAmount: 45000,  paymentDay: 15, category: 'otros',      isVariable: false, notes: 'Débito automático', frequency: 'fijo' },
  { concept: 'Medicina prepagada',  estimatedAmount: 60000,  paymentDay: 15, category: 'salud',      isVariable: false, notes: '',                 frequency: 'fijo' },
] as const

// ── Fixed Expense Payments (October 2026) ─────────────────────────────────────
// Keyed by concept to be matched with created FixedExpense ids

export const CARLOS_PAYMENTS_OCT = [
  { concept: 'Pago arriendo mamá',      paidAmount: 450000, month: '2026-10', paymentDate: '2026-10-13', notes: '' },
  { concept: 'Pago moto',               paidAmount: 400000, month: '2026-10', paymentDate: '2026-10-13', notes: '' },
  { concept: 'Pago internet',           paidAmount: 75000,  month: '2026-10', paymentDate: '2026-10-13', notes: '' },
  { concept: 'Pago plan de datos',      paidAmount: 48000,  month: '2026-10', paymentDate: '2026-10-13', notes: '' },
  { concept: 'Pago aporte apartamento', paidAmount: 500000, month: '2026-10', paymentDate: '2026-10-13', notes: '' },
  { concept: 'Pago parqueadero',        paidAmount: 55000,  month: '2026-10', paymentDate: '2026-10-13', notes: '' },
  { concept: 'Pago gasolina',           paidAmount: 37000,  month: '2026-10', paymentDate: '2026-10-13', notes: '' },
  { concept: 'Pago YouTube Premium',    paidAmount: 16000,  month: '2026-10', paymentDate: '2026-10-14', notes: '' },
  { concept: 'Ahorro programado',       paidAmount: 150000, month: '2026-10', paymentDate: '2026-10-02', notes: '' },
  { concept: 'Pago tarjeta de crédito', paidAmount: 163859, month: '2026-10', paymentDate: '2026-10-20', notes: '' },
] as const

export const ALE_PAYMENTS_OCT = [
  { concept: 'Plan de datos',  paidAmount: 39000,  month: '2026-10', paymentDate: '2026-10-14', notes: '' },
  { concept: 'Administración', paidAmount: 162000, month: '2026-10', paymentDate: '2026-10-14', notes: '' },
  { concept: 'Servicio luz',   paidAmount: 102000, month: '2026-10', paymentDate: '2026-10-14', notes: '' },
  { concept: 'Servicio agua',  paidAmount: 60000,  month: '2026-10', paymentDate: '2026-10-14', notes: '' },
  { concept: 'Servicio gas',   paidAmount: 17000,  month: '2026-10', paymentDate: '2026-10-14', notes: '' },
  { concept: 'Seguro vivienda',paidAmount: 45000,  month: '2026-10', paymentDate: '2026-10-14', notes: '' },
] as const

// ── Variable Expenses ─────────────────────────────────────────────────────────

export const CARLOS_EXPENSES = [
  { description: 'CloverPit (eShop)',           amount: 15600,   category: 'entretenimiento', date: '2026-10-14' },
  { description: 'Howartz Legacy (eShop)',       amount: 22000,   category: 'entretenimiento', date: '2026-10-14' },
  { description: 'Mario + Rabbids (eShop)',      amount: 34380,   category: 'entretenimiento', date: '2026-10-14' },
  { description: 'Retiro cajero',                amount: 100000,  category: 'otros',           date: '2026-10-03' },
  { description: 'Almuerzo cumpleaños Jhon',     amount: 30000,   category: 'entretenimiento', date: '2026-10-03' },
  { description: 'Uber',                         amount: 14531,   category: 'transporte',      date: '2026-10-12' },
  { description: 'Uber',                         amount: 14190,   category: 'transporte',      date: '2026-10-04' },
  { description: 'Compra con llave breb',        amount: 18000,   category: 'otros',           date: '2026-09-30' },
  { description: 'Transferencia a llave',        amount: 13000,   category: 'otros',           date: '2026-09-30' },
  { description: 'Transferencia a llave',        amount: 14500,   category: 'otros',           date: '2026-10-02' },
  { description: 'Transferencia a llave',        amount: 20000,   category: 'otros',           date: '2026-10-03' },
  { description: 'Transferencia a llave',        amount: 135000,  category: 'otros',           date: '2026-10-03' },
  { description: 'Transferencia a llave',        amount: 10000,   category: 'otros',           date: '2026-10-03' },
  { description: 'Boleta de Laura',              amount: 20000,   category: 'entretenimiento', date: '2026-10-03' },
  { description: 'EDS Incocentro (gasolina)',    amount: 37073,   category: 'transporte',      date: '2026-10-08' },
  { description: 'Transferencia a llave',        amount: 20000,   category: 'otros',           date: '2026-10-04' },
  { description: 'Almuerzo',                     amount: 37000,   category: 'alimentacion',    date: '2026-10-18' },
  { description: 'Restaurante Coctel del Mar',   amount: 50000,   category: 'alimentacion',    date: '2026-10-17' },
  { description: 'Lavada moto',                  amount: 12500,   category: 'transporte',      date: '2026-10-17' },
] as const

export const ALE_EXPENSES = [
  { description: 'Almuerzo (pagado a Carlos)', amount: 34000, category: 'alimentacion', date: '2026-10-14' },
  { description: 'Compra de aguacate',          amount: 6000,  category: 'alimentacion', date: '2026-10-15' },
  { description: 'Compra de carne',             amount: 11000, category: 'alimentacion', date: '2026-10-15' },
  { description: 'Compra de huevos',            amount: 15500, category: 'alimentacion', date: '2026-10-15' },
] as const

// ── Incomes ───────────────────────────────────────────────────────────────────

export const CARLOS_INCOMES = [
  { description: 'Sueldo', amount: 2895169, month: '2026-10', date: '2026-10-14' },
] as const

// ── Household Debts ───────────────────────────────────────────────────────────
// debtor / registeredBy use 'carlos' | 'ale' — seeder replaces with real UIDs

export type HouseholdDebtSeed = {
  id: string
  concept: string
  tipo: 'Deuda' | 'Abono'
  amount: number
  debtor: 'carlos' | 'ale'
  category: string
  date: string
  registeredBy: 'carlos' | 'ale'
  estado: string
  saldaId: string | null
  notas: string
  cruzado: boolean
}

// NOTE on `cruzado`: in the source Excel this flag only meant "reviewed in a
// monthly closing", NOT "paid" — it does not reduce the balance, so it's false
// here for everything except the debts that have a REAL bilateral crossing (see
// HOUSEHOLD_CROSSINGS below, which the seeder applies after creating the debts,
// properly syncing crossedAmount + cruzado together instead of just copying a
// textual flag that was never backed by an actual amount).
export const HOUSEHOLD_DEBTS: HouseholdDebtSeed[] = [
  { id: 'ed9b9712fd', concept: 'Préstamo computador',                   tipo: 'Deuda', amount: 1500000, debtor: 'carlos', category: 'otros_hogar', date: '2026-07-08', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra',               cruzado: false },
  { id: 'f2fdcf4dcc', concept: 'Parqueadero moto julio',                 tipo: 'Deuda', amount: 55000,   debtor: 'carlos', category: 'otros_hogar', date: '2026-07-08', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra',               cruzado: false },
  { id: 'd7d6f92d47', concept: 'Uñas Alexa',                             tipo: 'Deuda', amount: 30000,   debtor: 'carlos', category: 'otros_hogar', date: '2026-08-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra',               cruzado: false },
  { id: '2261b00cf5', concept: 'Arena gatos (agosto)',                   tipo: 'Deuda', amount: 35000,   debtor: 'carlos', category: 'mascotas',    date: '2026-08-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra - mascotas',    cruzado: false },
  { id: '8e5e69abde', concept: 'Comida gatos (agosto)',                  tipo: 'Deuda', amount: 80000,   debtor: 'carlos', category: 'mascotas',    date: '2026-08-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra - mascotas',    cruzado: false },
  { id: '86068cd14a', concept: 'Abono deuda Alexandra (agosto)',         tipo: 'Abono', amount: 800000,  debtor: 'carlos', category: 'otros_hogar', date: '2026-08-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Abono a deuda con Alexandra',       cruzado: false },
  { id: '91d2141ac3', concept: 'Abono deuda Alexandra (agosto 2)',       tipo: 'Abono', amount: 400000,  debtor: 'carlos', category: 'otros_hogar', date: '2026-08-15', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Segundo abono a deuda con Alexandra', cruzado: false },
  { id: '1311c0ba11', concept: 'Regalos Jhon cumple (crédito)',          tipo: 'Deuda', amount: 78000,   debtor: 'ale',    category: 'salidas',     date: '2026-09-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Crédito a favor - deuda Alexandra',  cruzado: false },
  { id: 'b82fdd625a', concept: 'Arena gatos (septiembre)',               tipo: 'Deuda', amount: 62000,   debtor: 'carlos', category: 'mascotas',    date: '2026-09-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra - mascotas',    cruzado: false },
  { id: '27b09de483', concept: 'Guantes Bosi',                           tipo: 'Deuda', amount: 90000,   debtor: 'carlos', category: 'otros_hogar', date: '2026-09-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra',               cruzado: false },
  { id: '93d3d31847', concept: 'Comida gatos Nutriss (septiembre)',      tipo: 'Deuda', amount: 50000,   debtor: 'carlos', category: 'mascotas',    date: '2026-09-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra - mascotas',    cruzado: false },
  { id: 'a6bbd62547', concept: 'Odontología Carlos',                     tipo: 'Deuda', amount: 100000,  debtor: 'carlos', category: 'otros_hogar', date: '2026-09-01', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Deuda con Alexandra',               cruzado: false },
  { id: '8a157b2075', concept: 'Abono deuda Alexandra (septiembre)',     tipo: 'Abono', amount: 500000,  debtor: 'carlos', category: 'otros_hogar', date: '2026-09-15', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: 'Abono a deuda con Alexandra',       cruzado: false },
  { id: '70ee0cfb7e', concept: 'Almuerzo pagado por Carlos',             tipo: 'Deuda', amount: 34000,   debtor: 'ale',    category: 'salidas',     date: '2026-10-14', registeredBy: 'ale',    estado: 'Saldado', saldaId: null,         notas: 'Almuerzo fuera 34000, pago Carlos',  cruzado: false },
  { id: 'c7576c61d1', concept: 'Abono deuda Carlos (almuerzo)',          tipo: 'Abono', amount: 34000,   debtor: 'ale',    category: 'salidas',     date: '2026-10-14', registeredBy: 'ale',    estado: '',        saldaId: '70ee0cfb7e', notas: 'Almuerzo',                           cruzado: false },
  { id: '6b13e8197e', concept: 'Lavada moto (mitad Ale)',                tipo: 'Deuda', amount: 12500,   debtor: 'ale',    category: 'otros_hogar', date: '2026-10-17', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: '',                                   cruzado: false },
  { id: '270dca481c', concept: 'Maleta Totto',                           tipo: 'Deuda', amount: 69000,   debtor: 'carlos', category: 'otros_hogar', date: '2026-10-22', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: '',                                   cruzado: false },
  { id: 'bd1fc459b9', concept: 'Juego Nintendo eShop Crash Bandicoot',   tipo: 'Deuda', amount: 90000,   debtor: 'ale',    category: 'otros_hogar', date: '2026-10-22', registeredBy: 'carlos', estado: '',        saldaId: null,         notas: '',                                   cruzado: false },
]

// Real crossings (compensación bilateral) to apply after the debts above exist.
// Only the September crossing of Regalos Jhon ($78.000) was crossed in the Excel.
// Crash Bandicoot ($90.000) was NOT crossed (M: NO), keeping Ale's debt at $102.500 ($12.500 + $90.000).
export type HouseholdCrossingSeed = {
  debtId: string
  amount: number
  debt2Person: 'carlos' | 'ale'
  initiatedBy: 'carlos' | 'ale'
  notes: string
  date: string
}

export const HOUSEHOLD_CROSSINGS: HouseholdCrossingSeed[] = [
  { debtId: '1311c0ba11', amount: 78000, debt2Person: 'carlos', initiatedBy: 'ale', notes: 'Cruce de cuentas (Regalos Jhon)', date: '2026-09-01' },
]
