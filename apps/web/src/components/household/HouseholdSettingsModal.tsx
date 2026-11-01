import { Pencil, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

interface Props {
  open: boolean
  onClose: () => void
  name: string
  onNameChange: (v: string) => void
  saving: boolean
  onRename: () => void
  onDelete: () => void
}

/** Rename the household or delete it with everything it holds. */
export function HouseholdSettingsModal({ open, onClose, name, onNameChange, saving, onRename, onDelete }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Configurar hogar">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Renombrar</p>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Nombre del hogar" />
            </div>
            <Button onClick={onRename} notched disabled={saving || !name.trim()}>
              <Pencil size={14} /> Guardar
            </Button>
          </div>
        </div>
        <div className="border-t border-white/10 pt-4 space-y-2">
          <p className="font-pixel text-[10px] text-red-400 uppercase tracking-widest font-bold">Zona de peligro</p>
          <Button variant="danger" notched className="w-full" onClick={onDelete} disabled={saving}>
            <Trash2 size={15} /> Eliminar hogar y todos los registros
          </Button>
          <p className="text-[10px] text-[#8a929a]">Esta acción no se puede deshacer.</p>
        </div>
      </div>
    </Modal>
  )
}
