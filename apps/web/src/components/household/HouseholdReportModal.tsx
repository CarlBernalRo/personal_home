import { LedgerTable } from './LedgerTable'
import { useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ClipboardCopy, FileDown, MessageCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { formatCOP } from '@/shared'
import { buildHouseholdReportPdf } from '@/lib/householdReportPdf'
import { buildHouseholdReport, groupMessage, personMessage, type FrozenPlan, type PersonReport } from './report'
import type { Rec } from './ledger'

interface Props {
  open: boolean
  onClose: () => void
  name: string
  members: string[]
  guestIds: string[]
  nameOf: (uid?: string | null) => string
  photoOf: (uid: string) => string | null
  colorOf: (uid: string) => string
  expenses: Rec[]
  /** The household's debt rows: the abonos in them are the money that already changed hands. */
  debts: Rec[]
  /** The plan already shared with everybody (kept as it was), and how to save or clear it. */
  frozenPlan?: FrozenPlan | null
  /** The household already crossed its accounts: payments only follow the plan. */
  crossed?: boolean
  /** Crosses the accounts (the page asks first). Absent once crossed. */
  onCross?: () => void
  /** Undoes the crossing — only while nobody has paid since. */
  onUncross?: () => void
}

/** A person's state in one phrase, with its colour: the first thing someone asking "how much do I owe?" looks for. */
function standing(p: PersonReport) {
  if (p.position < 0) return { label: `Debe pagar ${formatCOP(-p.position)}`, tone: 'text-amber-300 bg-amber-500/15 border-amber-500/35' }
  if (p.position > 0) return { label: `Le deben ${formatCOP(p.position)}`, tone: 'text-sky-300 bg-sky-500/15 border-sky-500/35' }
  return { label: 'Al día', tone: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/35' }
}

/**
 * "How much do I owe?" in one screen, worked out as ONE settlement: each person's part, what they put in, what they already
 * paid or received, where that leaves them — and exactly who they have to pay (or who pays them) so that everybody ends even
 * with the fewest payments. Each can be copied as a message (or sent by WhatsApp), or the whole thing downloaded as a PDF.
 */
export function HouseholdReportModal({ open, onClose, name, members, guestIds, nameOf, photoOf, colorOf, expenses, debts, frozenPlan, crossed, onCross, onUncross }: Props) {
  const { showToast } = useToast()
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const report = useMemo(
    () => buildHouseholdReport({ name, members, guestIds, nameOf, expenses, debts, frozenPlan }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, members, guestIds, expenses, debts, frozenPlan],
  )

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copiado`, 'success') } catch { showToast('No se pudo copiar', 'error') }
  }
  const whatsapp = (text: string) => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')

  async function download() {
    setBusy(true)
    try {
      const putBy = (e: Rec) => ((e.contributions as Rec[] | undefined) ?? []).filter((c) => c.status === 'confirmed').map((c) => nameOf(c.memberId as string)).join(', ') || '—'
      const blob = await buildHouseholdReportPdf(report, [...expenses].sort((a, b) => +new Date(a.date) - +new Date(b.date)).map((e) => ({
        id: e.id as string, date: e.date instanceof Date ? e.date : new Date(e.date), description: e.description as string, amount: e.amount as number, putBy: putBy(e),
      })))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Cuentas ${name}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch { showToast('No se pudo crear el PDF', 'error') } finally { setBusy(false) }
  }

  const payers = report.people.filter((p) => p.position < 0).length

  return (
    <Modal open={open} onClose={onClose} title="Reporte de cuentas">
      <div className="space-y-5">
        {/* the three numbers */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Total gastado</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-[#f3f5f6] sm:text-base">{formatCOP(report.total)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Falta por pagar</p>
            <p className={clsx('mt-0.5 font-mono text-sm font-bold sm:text-base', report.toMove > 0 ? 'text-amber-300' : 'text-emerald-300')}>{formatCOP(report.toMove)}</p>
            {report.plan.length > 0 && <p className="text-[9px] leading-tight text-[#8a929a]">en {report.plan.length} {report.plan.length === 1 ? 'pago' : 'pagos'}, compensando entre todos</p>}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0d263a] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[#8a929a]">Les toca pagar</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-[#f3f5f6] sm:text-base">{payers} <span className="text-[10px] font-normal text-[#8a929a]">de {report.people.length}</span></p>
          </div>
        </div>

        {report.unconfirmed > 0 && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200">
            Hay {report.unconfirmed} aporte{report.unconfirmed === 1 ? '' : 's'} por confirmar: cuando se confirmen, estas cuentas pueden cambiar.
          </p>
        )}
        {!report.balanced && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200">
            Hay pagos registrados sin destinatario: las cuentas pueden no cuadrar al peso.
          </p>
        )}

        {crossed ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-[11px] leading-snug text-sky-200">
            <span>
              <b>Cuentas cruzadas{report.frozenAt ? ` el ${report.frozenAt.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : ''}.</b> Ya no se pagan deudas sueltas: cada quien paga lo que dice este plan, y cada pago solo baja a medida que se registra.
              {report.adjusted > 0 && <> Desde entonces cambió algo (un gasto nuevo o corregido), así que se ajustaron {formatCOP(report.adjusted)} para que todos sigan quedando a mano.</>}
            </span>
            {onUncross && (
              <button type="button" onClick={onUncross} className="font-semibold text-sky-100 underline hover:text-white">Deshacer cruce</button>
            )}
          </div>
        ) : onCross && report.plan.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0d263a] px-3 py-2 text-[11px] leading-snug text-[#c7ccd1]">
            <span>Por ahora cada deuda se paga por separado. Si cruzan las cuentas, todo se compensa y cada quien hace solo los pagos de este plan.</span>
            <Button type="button" size="sm" notched onClick={onCross}>Cruzar cuentas</Button>
          </div>
        )}

        {/* share everything */}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => copy(groupMessage(report), 'Resumen')}><ClipboardCopy size={14} /> Copiar resumen</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => whatsapp(groupMessage(report))}><MessageCircle size={14} /> WhatsApp</Button>
          <Button type="button" size="sm" notched disabled={busy} onClick={download}><FileDown size={14} /> {busy ? 'Creando…' : 'Descargar PDF'}</Button>
        </div>

        {/* one card per person: where they stand, WHY, and exactly who to pay */}
        <section className="space-y-2">
          <h3 className="font-pixel text-[10px] font-bold uppercase tracking-widest text-brand-400">Cómo se paga entre todos</h3>
          {report.plan.length === 0 && (
            <p className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-300">✅ Todas las cuentas están al día.</p>
          )}
          <p className="text-[11px] leading-snug text-[#8a929a]">
            Cada quien termina a mano con los menos pagos posibles. <b className="text-[#c7ccd1]">Puso</b> = lo que adelantó de su bolsillo · <b className="text-[#c7ccd1]">Le tocó</b> = su parte de los gastos.
          </p>
          <div className="space-y-3">
            {report.people.map((p) => {
              const st = standing(p)
              const isOpen = openPerson === p.uid
              const tone = p.position < 0 ? 'border-amber-400/25 bg-amber-500/[0.07] text-amber-50' : p.position > 0 ? 'border-sky-400/25 bg-sky-500/[0.07] text-sky-50' : 'border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-50'
              const lines = p.position < 0
                ? p.pays.map((l) => ({ uid: l.to, name: l.name, amount: l.amount }))
                : p.receives.map((l) => ({ uid: l.from, name: l.name, amount: l.amount }))
              return (
                <div key={p.uid} className="rounded-xl border border-white/10 bg-[#0d263a]">
                  <div className="flex items-center gap-2.5 p-3">
                    <Avatar name={p.name} photoURL={photoOf(p.uid)} color={colorOf(p.uid)} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#f3f5f6]">{p.name}{p.isGuest && <span className="ml-1.5 text-[9px] font-bold text-[#8a929a]">INVITADO</span>}</span>
                      <span className={clsx('mt-0.5 inline-block rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold', st.tone)}>{st.label}</span>
                    </span>
                  </div>

                  {/* the summary cell: why */}
                  <div className={clsx('mx-3 mb-3 rounded-lg border p-2.5', tone)}>
                    <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">La cuenta</p>
                    <LedgerTable p={p} className="mt-1.5" />
                  </div>

                  {/* exactly who to pay, or who pays them */}
                  {lines.length > 0 && (
                    <ul className="mx-3 mb-3 space-y-1 rounded-lg border border-white/[0.06] bg-[#0a1f2f] px-2.5 py-2">
                      <li className="text-[9px] font-bold uppercase tracking-wider text-[#8a929a]">{p.position < 0 ? 'Tiene que pagar' : 'Se lo pagan'}</li>
                      {lines.map((l) => (
                        <li key={l.uid} className="flex items-center gap-2">
                          <ArrowRight size={12} className={clsx('flex-shrink-0 text-[#8a929a]', p.position > 0 && 'rotate-180')} aria-label={p.position < 0 ? 'a' : 'de'} />
                          <Avatar name={l.name} photoURL={photoOf(l.uid)} color={colorOf(l.uid)} size={20} />
                          <span className="min-w-0 flex-1 truncate text-xs text-[#dcf1eb]">{l.name}</span>
                          <span className={clsx('flex-shrink-0 font-mono text-xs font-bold', p.position < 0 ? 'text-amber-300' : 'text-sky-300')}>{formatCOP(l.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* how the saldo a favor crossed */}
                  {p.credit.total > 0 && (
                    <div className="mx-3 mb-3 space-y-1 rounded-lg border border-violet-400/25 bg-violet-500/[0.07] px-2.5 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-violet-300">Saldo a favor · {formatCOP(p.credit.total)}</p>
                      <p className="text-[11px] leading-snug text-[#c7ccd1]">
                        Pagó de más {p.paidTo.filter((x) => x.credit > 0).map((x) => `${formatCOP(x.credit)} a ${x.name}`).join(' y ')}. Ese dinero no se pierde: se aplica a lo que debe a cualquier persona.
                      </p>
                      {p.credit.uses.map((u) => (
                        <div key={u.to} className="flex items-center gap-2">
                          <ArrowRight size={12} className="flex-shrink-0 text-violet-300" />
                          <Avatar name={u.name} photoURL={photoOf(u.to)} color={colorOf(u.to)} size={18} />
                          <span className="min-w-0 flex-1 truncate text-xs text-[#dcf1eb]">Cubrió deuda con {u.name}</span>
                          <span className="flex-shrink-0 font-mono text-xs font-bold text-violet-300">{formatCOP(u.amount)}</span>
                        </div>
                      ))}
                      {p.credit.left > 0 && <p className="text-[10px] text-[#8a929a]">Sin aplicar todavía: {formatCOP(p.credit.left)} (no tiene más deudas abiertas).</p>}
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-px border-t border-white/10 bg-white/10 text-center">
                    {[
                      { label: 'Puso', value: p.put, sub: p.putPending > 0 ? `+${formatCOP(p.putPending)} sin confirmar` : '' },
                      { label: 'Le tocó', value: p.share, sub: '' },
                      { label: 'Ya pagó', value: p.paid, sub: '' },
                      { label: 'Recibió', value: p.received, sub: '' },
                    ].map((c) => (
                      <div key={c.label} className="bg-[#0d263a] px-2 py-2">
                        <p className="text-[9px] uppercase tracking-wider text-[#8a929a]">{c.label}</p>
                        <p className="font-mono text-xs font-semibold text-[#f0fae8]">{c.value > 0 ? formatCOP(c.value) : '—'}</p>
                        {c.sub && <p className="text-[9px] text-amber-300/80">{c.sub}</p>}
                      </div>
                    ))}
                  </div>

                  <button type="button" onClick={() => setOpenPerson(isOpen ? null : p.uid)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-left text-[11px] font-semibold text-brand-300 hover:bg-white/[0.03]">
                    <span>{isOpen ? 'Ocultar el detalle' : 'Ver el detalle gasto por gasto'}</span>
                    <ChevronDown size={14} className={clsx('transition-transform', isOpen && 'rotate-180')} />
                  </button>

                  {isOpen && (
                    <div className="space-y-3 border-t border-white/10 p-3">
                      <ul className="space-y-1">
                        {p.lines.filter((l) => l.share > 0 || l.put > 0 || l.putPending > 0).map((l) => (
                          <li key={l.expenseId} className="flex items-baseline justify-between gap-3 text-[11px]">
                            <span className="min-w-0 truncate text-[#c7ccd1]">{l.description}</span>
                            <span className="flex-shrink-0 font-mono text-[#f0fae8]">
                              {l.share > 0 ? `le tocó ${formatCOP(l.share)}` : 'no le tocó parte'}{l.put > 0 && <span className="text-emerald-300"> · puso {formatCOP(l.put)}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => copy(personMessage(report, p), 'Mensaje')}><ClipboardCopy size={13} /> Copiar mensaje</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => whatsapp(personMessage(report, p))}><MessageCircle size={13} /> WhatsApp</Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </Modal>
  )
}
