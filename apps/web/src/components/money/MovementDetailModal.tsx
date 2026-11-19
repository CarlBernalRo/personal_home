import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowRight, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { IconActionButton } from '@/components/ui/IconActionButton'
import { NoteSheet } from '@/components/fixed/NotesCard'
import { AttachmentButton } from '@/components/pending/AttachmentButton'
import type { AccountLite } from '@/components/ui/AccountChip'
import { formatCOP } from '@/shared'
import { flowKind, type FlowItem } from './MoneyTimeline'
import { TagChip } from '@/components/ui/TagPicker'
import { useTags } from '@/hooks/useTags'
import { tagsOf } from '@/shared'

interface Props {
  item: FlowItem | null
  onClose: () => void
  accounts: AccountLite[]
}

/**
 * The detail of a movement that isn't a fixed expense, laid out like the fixed expense's own dialog: the kind with
 * its edit/delete actions on top, the amount and date, the details in grey, the observation, the receipt, Cerrar.
 */
export function MovementDetailModal({ item, onClose, accounts }: Props) {
  const { tags } = useTags()
  if (!item) return <Modal open={false} onClose={onClose} title="">{null}</Modal>
  const kind = flowKind(item.kind)
  const Icon = kind.icon
  const acc = accounts.find((a) => a.id === item.accountId)
  const to = item.toAccountId ? accounts.find((a) => a.id === item.toAccountId) : undefined
  const isTransfer = item.kind === 'transfer'
  const incoming = item.amount > 0 && !isTransfer

  const details: { label: string; value: string }[] = [
    ...(item.sub && item.sub !== kind.single ? [{ label: item.kind === 'household' ? 'Hogar' : item.kind === 'income' ? 'Tipo' : isTransfer ? 'Detalle' : 'Categoría', value: item.sub }] : []),
    isTransfer
      ? { label: 'Movimiento', value: `${acc?.name ?? 'Una cuenta'} → ${to?.name ?? 'otra cuenta'}` }
      : { label: incoming ? 'Llegó a' : 'Pagado desde', value: acc ? acc.name : item.cash ? 'Efectivo (sin cuenta)' : item.accountId ? 'Una cuenta que ya no existe' : 'Sin cuenta' },
  ]

  // where a movement that isn't managed here is managed
  const elsewhere = item.kind === 'household'
    ? { text: 'Los abonos se corrigen y eliminan desde el hogar.', to: '/hogar', label: 'Ir a Hogar' }
    : isTransfer
      ? { text: 'Los traslados se hacen desde Finanzas.', to: '/finanzas', label: 'Ir a Finanzas' }
      : null

  const run = (fn?: () => void) => () => { onClose(); fn?.() }
  const title = `${item.concept} · ${format(item.date, 'MMM yyyy', { locale: es })}`

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: item.history ? '#9aa4ac' : kind.color }}>
            <Icon size={16} aria-hidden="true" /> {item.history ? `${kind.single} · anterior, no cuenta` : item.cash ? `${kind.single} · efectivo` : kind.single}
          </div>
          <div className="flex items-center gap-2">
            {item.onEdit && <IconActionButton icon={Pencil} tone="edit" label="Editar: corregir descripción, monto, fecha, categoría o cuenta" onClick={run(item.onEdit)} />}
            {item.onDelete && <IconActionButton icon={Trash2} tone="danger" label={incoming ? 'Eliminar este ingreso: la cuenta deja de contarlo' : 'Eliminar este gasto: la cuenta recupera el dinero'} onClick={run(item.onDelete)} />}
          </div>
        </div>

        <p className="text-sm font-mono">
          {isTransfer ? '' : incoming ? '+' : '−'}{formatCOP(Math.abs(item.amount))} el {format(item.date, "d 'de' MMMM yyyy", { locale: es })}
        </p>

        {details.map((d) => (
          <p key={d.label} className="text-xs text-[#9aa4ac]">
            {d.label}: <span className="font-semibold text-[#f3f5f6]">{d.value}</span>
          </p>
        ))}

        {item.cash && (
          <p className="text-xs text-[#9aa4ac]">Registrado sin cuenta: queda en tu historial, pero no se suma ni se resta de tus cuentas, del resumen ni de la proyección.</p>
        )}
        {item.history && (
          <p className="text-xs text-[#9aa4ac]">Registro de antes de que los gastos se contaran en tu dinero: se muestra como historial.</p>
        )}

        {tagsOf(item.tagIds, tags).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[#9aa4ac]">Etiquetas:</span>
            {tagsOf(item.tagIds, tags).map((t) => <TagChip key={t.id} tag={t} size="sm" />)}
          </div>
        )}
        {item.notes?.trim() && <NoteSheet title="Observación" tone="sky" icon={<MessageSquare size={12} />}>{item.notes.trim()}</NoteSheet>}
        {item.attachmentId && <AttachmentButton attachmentId={item.attachmentId} />}

        {elsewhere && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#9aa4ac]">
            {elsewhere.text}
            <Link to={elsewhere.to} onClick={onClose} className="inline-flex items-center gap-1 font-semibold text-brand-300 hover:text-brand-200">
              {elsewhere.label} <ArrowRight size={12} aria-hidden="true" />
            </Link>
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  )
}
