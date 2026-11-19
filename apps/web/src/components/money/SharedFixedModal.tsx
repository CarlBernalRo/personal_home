import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Avatar } from '@/components/ui/Avatar'
import { STATUS_META, entryStatusKey } from '@/components/fixed/status'
import { FIXED_EXPENSE_CATEGORIES, amountFor, formatCOP } from '@/shared'
import type { TimelineEntry } from './MoneyTimeline'

/**
 * A fixed expense a family member shared, read only and laid out like the user's own fixed expense dialog: its state,
 * what was paid and when (or what is due), the estimate and the category. It is theirs to pay and manage.
 */
export function SharedFixedModal({ entry, onClose }: { entry: TimelineEntry | null; onClose: () => void }) {
  if (!entry?.owner) return <Modal open={false} onClose={onClose} title="">{null}</Modal>
  const owner = entry.owner
  const sk = entryStatusKey(entry)
  const cat = FIXED_EXPENSE_CATEGORIES.find((c) => c.id === entry.fe.category)
  const pay = entry.owed.length === 0 ? entry.payment : null
  const [y, m] = entry.hostMonth.split('-').map(Number)
  const title = `${entry.fe.concept} · ${format(new Date(y, m - 1, 1), 'MMM yyyy', { locale: es })}`

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className={clsx('inline-block rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider border', STATUS_META[sk].chip)}>{STATUS_META[sk].label}</span>
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-rose-300">
            <Avatar name={owner.name} photoURL={owner.photo} size={22} /> Gasto de {owner.name}
          </span>
        </div>
        <p className="text-sm font-mono">
          {pay
            ? <>{formatCOP(pay.paidAmount)} el {format(pay.paymentDate instanceof Date ? pay.paymentDate : new Date(pay.paymentDate as any), "d 'de' MMMM yyyy", { locale: es })}</>
            : <>{formatCOP(entry.total)}{entry.due ? ` · vence el ${format(entry.due, "d 'de' MMMM", { locale: es })}` : ''}</>}
        </p>
        <p className="text-xs text-[#9aa4ac]">Estimado: <span className="font-mono">{formatCOP(amountFor(entry.fe, entry.hostMonth))}</span></p>
        {cat && <p className="text-xs text-[#9aa4ac]">Categoría: <span className="font-semibold text-[#f3f5f6]">{cat.label}</span></p>}
        <p className="text-xs text-[#9aa4ac]">{owner.name} te lo comparte desde su familia: lo paga y lo administra en su app, y no se cuenta en tu dinero.</p>
        <div className="flex gap-2 pt-2"><Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button></div>
      </div>
    </Modal>
  )
}
