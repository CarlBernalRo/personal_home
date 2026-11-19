import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import { Bell, Check, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { ChipSelect } from '@/components/ui/ChipSelect'
import { IconActionButton } from '@/components/ui/IconActionButton'
import { ObservationField } from '@/components/ui/ObservationField'
import { NoteSheet } from '@/components/fixed/NotesCard'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { useDisplayName } from '@/hooks/useDisplayName'
import { addReminder, deleteReminder, setReminderDone, updateReminder } from '@/lib/reminders'
import { REMINDER_REPEATS, fromDayKey, type Family, type Reminder } from '@/shared'

/** New reminder, or the change of one: what, when, how often, notes, and which family members also see it. */
export function ReminderFormModal({ open, onClose, editing, family }: { open: boolean; onClose: () => void; editing: Reminder | null; family: Family | null }) {
  const { user } = useAuth()
  const myName = useDisplayName() || 'Yo'
  const { showToast } = useToast()
  const others = family && user ? family.members.filter((u) => u !== user.uid) : []
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [every, setEvery] = useState('0')
  const [notes, setNotes] = useState('')
  const [sharedWith, setSharedWith] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(editing?.title ?? '')
    setDate(editing?.date ?? format(new Date(), 'yyyy-MM-dd'))
    setEvery(String(editing?.every ?? 0))
    setNotes(editing?.notes ?? '')
    setSharedWith((editing?.sharedWith ?? []).filter((u) => others.includes(u)))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!title.trim()) return setError('Escribe qué hay que recordar')
    if (!date) return setError('Elige la fecha')
    setSaving(true)
    try {
      const input = { title, date, every: Number(every), notes, sharedWith }
      if (editing) await updateReminder(editing.id, input)
      else await addReminder({ uid: user.uid, name: myName, photo: user.photoURL ?? null }, input)
      onClose()
      showToast(editing ? 'Recordatorio actualizado' : 'Recordatorio creado', editing ? 'edit' : 'success')
    } catch {
      showToast('No se pudo guardar el recordatorio', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggle = (u: string) => setSharedWith((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]))

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Editar recordatorio' : 'Nuevo recordatorio'}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-[#9aa4ac]">Algo que hacer en una fecha, sin dinero de por medio. Te avisamos ese día en la campana y en Telegram.</p>
        <Input label="¿Qué hay que recordar?" placeholder="ej. Desparasitar a los gatos" value={title} onChange={(e) => { setTitle(e.target.value); setError(null) }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-[#9aa4ac] block">Se repite</span>
            <ChipSelect size="sm" label="Se repite" placeholder="No se repite" value={every === '0' ? '' : every} onChange={(v) => setEvery(v || '0')}
              options={REMINDER_REPEATS.filter((r) => r.value > 0).map((r) => ({ value: String(r.value), label: r.label }))} />
          </div>
        </div>
        <ObservationField value={notes} onChange={setNotes} />
        {others.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[#9aa4ac]">¿A quién más le interesa? <span className="font-normal text-[#5f6a72]">(lo ven y pueden marcarlo hecho)</span></p>
            <div className="flex flex-wrap gap-2">
              {others.map((u) => (
                <button key={u} type="button" onClick={() => toggle(u)} aria-pressed={sharedWith.includes(u)}
                  className={clsx('inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition', sharedWith.includes(u) ? 'family-row text-white' : 'border-white/10 bg-[#0d263a] text-[#c7ccd1] hover:text-white')}>
                  <Avatar name={family!.memberNames[u] ?? '?'} photoURL={family!.memberPhotos[u]} size={20} />
                  {family!.memberNames[u] ?? 'Integrante'}
                  {sharedWith.includes(u) && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={saving} notched>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear recordatorio'}</Button>
        </div>
      </form>
    </Modal>
  )
}

/** One date of a reminder: mark it done (anybody who sees it), and edit or delete it (its owner). */
export function ReminderDetailModal({ item, onClose, onEdit, family }: { item: { reminder: Reminder; date: string } | null; onClose: () => void; onEdit: (r: Reminder) => void; family: Family | null }) {
  const { user } = useAuth()
  const myName = useDisplayName() || 'Yo'
  const { showToast } = useToast()
  const ask = useConfirm()
  if (!item || !user) return <Modal open={false} onClose={onClose} title="">{null}</Modal>
  const { reminder: r, date } = item
  const mine = r.userId === user.uid
  const done = r.done[date]
  const repeat = REMINDER_REPEATS.find((x) => x.value === r.every)?.label ?? 'No se repite'
  const viewers = r.sharedWith.map((u) => (u === user.uid ? 'Tú' : family?.memberNames[u] ?? 'Integrante'))

  async function toggleDone() {
    try {
      await setReminderDone(r.id, date, done ? null : { uid: user!.uid, name: myName })
      showToast(done ? 'Marcado como pendiente' : '¡Hecho!', 'success')
      onClose()
    } catch { showToast('No se pudo actualizar', 'error') }
  }
  async function remove() {
    if (!(await ask(`¿Eliminar el recordatorio "${r.title}"${r.every ? ' y todas sus fechas' : ''}?${r.sharedWith.length ? ' También desaparece para quienes lo compartiste.' : ''}`, { title: 'Eliminar recordatorio', confirmLabel: 'Eliminar' }))) return
    try { await deleteReminder(r.id); showToast('Recordatorio eliminado', 'delete'); onClose() } catch { showToast('No se pudo eliminar', 'error') }
  }

  return (
    <Modal open onClose={onClose} title={`${r.title} · ${format(fromDayKey(date), 'MMM yyyy', { locale: es })}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className={clsx('flex items-center gap-2 text-sm font-semibold', done ? 'text-brand-300' : 'text-[#cbd5e1]')}>
            {done ? <Check size={16} /> : <Bell size={16} />} {done ? 'Hecho' : 'Pendiente'}
          </div>
          <div className="flex items-center gap-2">
            {mine && <IconActionButton icon={Pencil} tone="edit" label="Editar: título, fecha, repetición, notas o con quién se comparte" onClick={() => { onClose(); onEdit(r) }} />}
            {mine && <IconActionButton icon={Trash2} tone="danger" label="Eliminar el recordatorio" onClick={remove} />}
          </div>
        </div>
        <p className="text-sm font-mono first-letter:uppercase">{format(fromDayKey(date), "EEEE d 'de' MMMM yyyy", { locale: es })}</p>
        <p className="text-xs text-[#9aa4ac]">Se repite: <span className="font-semibold text-[#f3f5f6]">{repeat}</span></p>
        {!mine && (
          <p className="text-xs text-[#9aa4ac] inline-flex items-center gap-2">De: <Avatar name={r.ownerName} photoURL={r.ownerPhoto} size={18} /> <span className="font-semibold text-[#f3f5f6]">{r.ownerName}</span></p>
        )}
        {viewers.length > 0 && <p className="text-xs text-[#9aa4ac]">Compartido con: <span className="font-semibold text-[#f3f5f6]">{viewers.join(', ')}</span></p>}
        {done && <p className="text-xs text-[#9aa4ac]">Lo marcó hecho {done.by === user.uid ? 'tú' : done.name} el {format(new Date(done.at), "d 'de' MMMM", { locale: es })}.</p>}
        {r.notes && <NoteSheet title="Notas" icon={<Bell size={12} />}>{r.notes}</NoteSheet>}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
          <Button type="button" className="flex-1" notched onClick={toggleDone}>
            {done ? <><RotateCcw size={14} /> Marcar pendiente</> : <><Check size={14} /> Marcar hecho</>}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
