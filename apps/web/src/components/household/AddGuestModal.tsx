import { useState, type FormEvent } from 'react'
import { Trash2, UserPlus2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface Guest { id: string; name: string }

interface Props {
  open: boolean
  onClose: () => void
  guests: Guest[]
  onAdd: (name: string) => Promise<Guest>
  onRemove: (id: string) => Promise<void>
}

/**
 * Adds someone who shares expenses with the household but has no account and never logs in — e.g. a family
 * member along on a trip. Just a name: no e-mail, no invitation, no acceptance step. Also lists the guests
 * already added, so one can be removed from the active member list once the trip (or whatever it was) is over.
 */
export function AddGuestModal({ open, onClose, guests, onAdd, onRemove }: Props) {
  const { showToast } = useToast()
  const ask = useConfirm()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  function reset() { setName(''); setTouched(false) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!name.trim()) return
    setSaving(true)
    try {
      await onAdd(name.trim())
      showToast(`${name.trim()} agregado como invitado`, 'success')
      reset()
    } catch (err: any) {
      showToast(err?.message ?? 'No se pudo agregar el invitado', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(g: Guest) {
    if (!(await ask(`¿Quitar a ${g.name} de la lista de invitados? Sus deudas ya registradas quedan como están.`, { title: 'Quitar invitado', confirmLabel: 'Quitar' }))) return
    setRemovingId(g.id)
    try {
      await onRemove(g.id)
      showToast(`${g.name} ya no es invitado del hogar`, 'delete')
    } catch (err: any) {
      showToast(err?.message ?? 'No se pudo quitar', 'error')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Modal open={open} onClose={() => { onClose(); reset() }} title="Invitados del hogar">
      <form onSubmit={submit} noValidate className="space-y-3">
        <p className="text-xs text-[#9aa4ac] leading-relaxed">
          Para alguien que comparte gastos con el hogar pero no tiene cuenta ni entra a la app — por ejemplo, alguien
          más en un viaje. Puedes registrar y abonar sus deudas por él.
        </p>
        <Input
          label="Nombre del invitado"
          placeholder="ej. Papá"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched && !name.trim() ? 'Escribe un nombre' : undefined}
          aria-invalid={touched && !name.trim()}
        />
        <Button type="submit" notched className="w-full" disabled={saving}>
          <UserPlus2 size={14} /> {saving ? 'Agregando…' : 'Agregar invitado'}
        </Button>
      </form>

      <section aria-label="Invitados de este hogar" className="space-y-2 pt-4 border-t border-white/[0.08] mt-4">
        <h3 className="font-pixel text-[9px] uppercase tracking-widest text-brand-400">Invitados actuales</h3>
        {guests.length === 0 ? (
          <p className="text-xs text-[#8a929a]">Aún no has agregado ningún invitado.</p>
        ) : (
          <ul className="space-y-1.5">
            {guests.map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d263a] px-3 py-2">
                <span className="flex-1 min-w-0 truncate text-xs text-[#e6ebef]">{g.name}</span>
                <button
                  type="button"
                  onClick={() => remove(g)}
                  disabled={removingId === g.id}
                  aria-label={`Quitar a ${g.name}`}
                  className="p-1.5 rounded-lg text-[#6f7a83] hover:text-red-300 hover:bg-red-500/10 transition disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  )
}
