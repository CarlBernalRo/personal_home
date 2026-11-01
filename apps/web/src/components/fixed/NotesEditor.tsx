import { useState } from 'react'

interface Props {
  /** Saved note; the editor restarts from it when remounted (key it by expense). */
  value: string
  onSave: (text: string) => Promise<void>
}

/** Free-text annotations for a fixed expense (account numbers, agreements, reminders…). */
export function NotesEditor({ value, onSave }: Props) {
  const [text, setText] = useState(value)
  const [saving, setSaving] = useState(false)
  const dirty = text.trim() !== value.trim()

  async function save() {
    setSaving(true)
    try {
      await onSave(text.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-[#9aa4ac] block">Anotaciones</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="ej. número de cuenta, acuerdo de pago, recordatorio…"
        className="w-full bg-[#0d263a] border border-white/10 rounded-xl px-3 py-2 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none focus:border-brand-400 transition resize-y"
      />
      {dirty && (
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white border border-brand-400/40 transition disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar anotación'}
        </button>
      )}
    </div>
  )
}
