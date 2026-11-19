/** An optional free-text note left on a payment or spend (same look wherever it is asked). */
export function ObservationField({ value, onChange, label = 'Observación', placeholder = 'ej. para qué fue, con quién, referencia del recibo…' }: {
  value: string
  onChange: (v: string) => void
  label?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-[#9aa4ac]">{label} <span className="font-normal text-[#5f6a72]">(opcional)</span></label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border border-white/10 bg-[#0d263a] px-3 py-2 text-sm text-[#f3f5f6] placeholder-[#5f6a72] outline-none transition focus:border-brand-400"
      />
    </div>
  )
}
