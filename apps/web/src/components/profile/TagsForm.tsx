import { useState } from 'react'
import { clsx } from 'clsx'
import { Check, Pencil, Plus, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { IconActionButton } from '@/components/ui/IconActionButton'
import { useToast } from '@/components/ui/Toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTags } from '@/hooks/useTags'
import { TAG_COLORS } from '@/shared'

const card = 'rounded-2xl bg-[#0a1f2f] border border-white/10 p-5 sm:p-6 space-y-4 shadow-xl'

function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
      {TAG_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onChange(c)}
          className={clsx('h-6 w-6 rounded-full border-2 transition', value === c ? 'border-white scale-110' : 'border-transparent hover:scale-105')}
          style={{ backgroundColor: c }} />
      ))}
    </div>
  )
}

/** Perfil → Etiquetas: create, rename, recolor and delete the marks used to follow expenses across kinds. */
export function TagsForm() {
  const { tags, add, update, remove } = useTags()
  const { showToast } = useToast()
  const ask = useConfirm()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_COLORS[tags.length % TAG_COLORS.length])
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null)

  async function create() {
    const n = name.trim()
    if (!n) return
    if (tags.some((t) => t.name.toLowerCase() === n.toLowerCase())) { showToast('Ya tienes una etiqueta con ese nombre', 'error'); return }
    try { await add(n, color); setName(''); setColor(TAG_COLORS[(tags.length + 1) % TAG_COLORS.length]); showToast('Etiqueta creada', 'success') }
    catch { showToast('No se pudo crear la etiqueta', 'error') }
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-400/30 flex items-center justify-center text-brand-300 flex-shrink-0"><TagIcon size={18} /></span>
          <div>
            <p className="text-sm font-bold text-[#f0fae8]">Etiquetas</p>
            <p className="text-xs text-[#9aa4ac] mt-0.5">
              Una etiqueta marca gastos de cualquier tipo con un mismo propósito. Por ejemplo "Hogar": el arriendo (fijo), el mercado (ocasional) y una
              bombilla (adicional) quedan juntos, y en el reporte ves cuánto se lleva el hogar en total, separando lo ya pagado de lo que falta.
            </p>
          </div>
        </div>
      </div>

      <div className={card}>
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Nueva etiqueta</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <Input label="Nombre" placeholder="ej. Hogar, Gatos, Universidad" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
          <Button size="sm" notched onClick={create} disabled={!name.trim()}><Plus size={14} /> Crear</Button>
        </div>
        <ColorRow value={color} onChange={setColor} />
      </div>

      <div className={card}>
        <p className="font-pixel text-[10px] text-brand-400 uppercase tracking-widest font-bold">Mis etiquetas ({tags.length})</p>
        {tags.length === 0 ? (
          <p className="text-sm text-[#9aa4ac]">Aún no tienes etiquetas. También puedes crearlas al editar un gasto.</p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {tags.map((t) => (
              <li key={t.id} className="py-2.5">
                {editing?.id === t.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={editing.name} maxLength={30} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Nombre de la etiqueta" />
                      <IconActionButton icon={X} tone="warning" label="Cancelar" onClick={() => setEditing(null)} />
                      <IconActionButton icon={Check} tone="success" label="Guardar" onClick={async () => {
                        if (!editing.name.trim()) return
                        try { await update(t.id, { name: editing.name.trim(), color: editing.color }); setEditing(null); showToast('Etiqueta actualizada', 'edit') } catch { showToast('No se pudo guardar', 'error') }
                      }} />
                    </div>
                    <ColorRow value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} aria-hidden="true" />
                    <span className="flex-1 text-sm font-semibold text-[#f0fae8]">{t.name}</span>
                    <IconActionButton icon={Pencil} tone="edit" label={`Editar ${t.name}`} onClick={() => setEditing({ id: t.id, name: t.name, color: t.color })} />
                    <IconActionButton icon={Trash2} tone="danger" label={`Eliminar ${t.name}`} onClick={async () => {
                      if (!(await ask(`¿Eliminar la etiqueta "${t.name}"? Se quita de todos los gastos que la tenían; los gastos no se borran.`, { title: 'Eliminar etiqueta', confirmLabel: 'Eliminar' }))) return
                      try { await remove(t.id); showToast('Etiqueta eliminada', 'delete') } catch { showToast('No se pudo eliminar', 'error') }
                    }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
