import { useState } from 'react'
import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Check, Plus, Tag as TagIcon } from 'lucide-react'
import { useTags } from '@/hooks/useTags'
import type { Tag } from '@/shared'

/** A tag as a small chip in its color (the name stays in text ink; the color is the dot and the border). */
export function TagChip({ tag, size = 'xs' }: { tag: Tag; size?: 'xs' | 'sm' }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1 rounded-full border font-semibold text-[#dcf1eb] whitespace-nowrap', size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[11px]')}
      style={{ borderColor: tag.color + '88', backgroundColor: tag.color + '1f' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
      {tag.name}
    </span>
  )
}

/**
 * Choosing the tags of an expense: each existing tag is a chip to switch on or off, and a new one can be created right
 * here (the full management lives in Perfil → Etiquetas).
 */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { tags, add } = useTags()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  async function create() {
    const n = name.trim()
    if (!n) return
    const existing = tags.find((t) => t.name.toLowerCase() === n.toLowerCase())
    const tag = existing ?? (await add(n))
    if (!value.includes(tag.id)) onChange([...value, tag.id])
    setName(''); setCreating(false)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#9aa4ac] inline-flex items-center gap-1.5"><TagIcon size={12} aria-hidden="true" /> Etiquetas <span className="font-normal text-[#5f6a72]">(opcional)</span></span>
        <Link to="/perfil?tab=etiquetas" className="text-[10px] font-semibold text-brand-300 hover:text-brand-200">Gestionar</Link>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => {
          const on = value.includes(t.id)
          return (
            <button key={t.id} type="button" onClick={() => toggle(t.id)} aria-pressed={on}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition', on ? 'text-white' : 'text-[#9aa4ac] border-white/10 hover:text-white')}
              style={on ? { borderColor: t.color, backgroundColor: t.color + '33' } : undefined}>
              {on ? <Check size={11} aria-hidden="true" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} aria-hidden="true" />}
              {t.name}
            </button>
          )
        })}
        {creating ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } if (e.key === 'Escape') setCreating(false) }}
              placeholder="Nueva etiqueta"
              maxLength={30}
              className="w-32 rounded-full border px-2.5 py-1 text-[11px] outline-none"
            />
            <button type="button" onClick={create} className="rounded-full bg-brand-500/20 px-2 py-1 text-[11px] font-semibold text-brand-200 hover:bg-brand-500/30">Crear</button>
          </span>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/20 px-2.5 py-1 text-[11px] font-semibold text-[#9aa4ac] hover:text-white hover:border-white/40">
            <Plus size={11} aria-hidden="true" /> Nueva
          </button>
        )}
      </div>
      {tags.length === 0 && !creating && <p className="text-[10px] text-[#5f6a72]">Una etiqueta agrupa gastos de distintos tipos, por ejemplo "Hogar" o "Gatos", para verlos juntos en el reporte.</p>}
    </div>
  )
}
