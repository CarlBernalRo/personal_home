import { useEffect, useRef, useState } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
import { compressImage } from '@/lib/attachments'

interface Props {
  file: File | null
  onChange: (file: File | null) => void
  className?: string
}

/**
 * "Adjuntar comprobante" for the forms that register something by hand. It only picks (and previews) the image; the
 * form stores it with `saveAttachment` when it is saved, so nothing is uploaded for a form that is cancelled.
 */
export function AttachmentPicker({ file, onChange, className }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function pick(f?: File) {
    if (!f) return
    setError('')
    setBusy(true)
    try {
      // checked now (not when saving) so a picture that cannot be used is noticed right away
      await compressImage(f)
      onChange(f)
    } catch (e) {
      onChange(null)
      setError(e instanceof Error ? e.message : 'No se pudo adjuntar la imagen')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className={className}>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {file ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-brand-400/30 bg-brand-500/10 px-2.5 py-2">
          {preview && <img src={preview} alt="" className="h-9 w-9 flex-shrink-0 rounded object-cover" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-brand-200">{file.name || 'Comprobante'}</span>
            <span className="block text-[11px] text-[#8a929a]">Se guardará reducido, para que pese poco</span>
          </span>
          <button type="button" onClick={() => onChange(null)} aria-label="Quitar el adjunto" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[#9aa4ac] transition hover:bg-white/10 hover:text-white">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs font-semibold text-[#c7ccd1] transition hover:border-brand-400/50 hover:text-brand-200 disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Adjuntar comprobante <span className="font-normal text-[#6f7a83]">(opcional)</span>
        </button>
      )}
      {error && <p role="alert" className="mt-1 text-[11px] text-rose-300">{error}</p>}
    </div>
  )
}
