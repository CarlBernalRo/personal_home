import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'

interface Props {
  open: boolean
  /** Name of the expense being switched. */
  name: string
  action: 'deactivate' | 'activate'
  /** yyyy-MM suggested as the first month of the change. */
  defaultMonth: string
  onClose: () => void
  onConfirm: (month: string) => Promise<void>
}

/** Asks from which month an expense stops (or starts again) being due. Months before it don't change. */
export function ActiveToggleModal({ open, name, action, defaultMonth, onClose, onConfirm }: Props) {
  const [month, setMonth] = useState(defaultMonth)
  const [saving, setSaving] = useState(false)
  const deactivating = action === 'deactivate'

  useEffect(() => { if (open) setMonth(defaultMonth) }, [open, defaultMonth])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{4}-\d{2}$/.test(month)) return
    setSaving(true)
    try {
      await onConfirm(month)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${deactivating ? 'Desactivar' : 'Activar'}: ${name}`}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-[#9aa4ac] leading-relaxed">
          {deactivating
            ? 'Dejará de aparecer, de contar como pendiente y de reservar saldo desde el mes que elijas en adelante. Los meses anteriores y sus pagos no cambian.'
            : 'Volverá a aparecer y a contar desde el mes que elijas en adelante. Los meses en que estuvo desactivado no cambian.'}
        </p>
        <Input label={deactivating ? 'Desactivar desde el mes' : 'Activar desde el mes'} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>
            {saving ? 'Guardando…' : deactivating ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
